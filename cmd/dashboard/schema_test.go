package main

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"net"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// schemaWorld porte ce que le scénario du schéma doit connaître pour lire le message de refus : la
// version que la base porte. La version attendue, elle, est celle de la suite — le binaire du
// scénario et les migrations du harnais sortent du même arbre.
type schemaWorld struct {
	process  *process
	occupied net.Listener
	applied  int64
	// dsn est celui de la base que ce scénario s'est taillée. Les cas de version n'en avaient pas
	// besoin — ils lisent le refus dans la sortie du process ; celui des partitions relit la base
	// après que le serveur l'a touchée.
	dsn string
}

// release rend l'adresse occupée. Sans elle, le port resterait pris pour toute la suite — et le
// scénario suivant qui demanderait la même adresse échouerait sans rapport avec ce qu'il décrit.
func (w *schemaWorld) release() {
	if w.occupied != nil {
		_ = w.occupied.Close()
		w.occupied = nil
	}
}

func (w *schemaWorld) outdatedSchema(ctx context.Context) error {
	dsn, remaining, err := outdatedDatabase(ctx)
	if err != nil {
		return err
	}

	w.applied = remaining

	return w.pointTheServerAt(dsn)
}

func (w *schemaWorld) freshSchema(ctx context.Context) error {
	dsn, err := freshDatabase(ctx)
	if err != nil {
		return err
	}

	w.applied = 0

	return w.pointTheServerAt(dsn)
}

// pointTheServerAt part de la configuration complète et n'en change que le DSN : ce que ces
// scénarios font varier est la base, et rien d'autre.
func (w *schemaWorld) pointTheServerAt(dsn string) error {
	env := completeConfiguration()

	if _, exists := env["DASHBOARD_DATABASE_URL"]; !exists {
		return errors.New("la configuration complète ne porte plus de DSN : ce scénario ne ferait " +
			"plus varier ce qu'il annonce")
	}

	// Ce que les pas précédents ont déjà posé est conservé — l'adresse d'écoute occupée, par exemple.
	maps.Copy(env, w.process.env)
	env["DASHBOARD_DATABASE_URL"] = dsn
	w.process.env = env
	w.dsn = dsn

	return nil
}

// occupyListenAddress lie l'adresse d'écoute **avant** le serveur, et la garde liée pour la durée du
// scénario. Le port 0 de la configuration complète ne conviendrait pas : il désigne « n'importe
// lequel de libre », donc il n'y a rien à occuper d'avance.
func (w *schemaWorld) occupyListenAddress() error {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("occuper l'adresse d'écoute : %w", err)
	}

	w.occupied = listener

	// L'environnement est complété plutôt que supposé présent : `pointTheServerAt` le **remplace**
	// en entier, donc écrire ici dans une map que ce pas-là recréerait ensuite perdrait l'adresse en
	// silence si l'ordre des `Étant donné` changeait. Une map nil paniquerait, en plus.
	if w.process.env == nil {
		w.process.env = completeConfiguration()
	}

	w.process.env["DASHBOARD_ADDR"] = listener.Addr().String()

	return nil
}

// messageNamesTheSchemaNotTheAddress observe **l'ordre du démarrage**. Le serveur a ici deux raisons
// de refuser — un schéma en version 0 et une adresse déjà prise — et celle qu'il nomme dit laquelle
// il a examinée en premier.
//
// C'est le seul moyen trouvé de rendre cet ordre visible de l'extérieur, et il compte : une instance
// qui lie son port avant de refuser est déjà dans le pool du load balancer, le temps d'un
// aller-retour de sonde. Sans ce scénario, déplacer le contrôle après `net.Listen` laissait la suite
// entière verte — mesuré.
func (w *schemaWorld) messageNamesTheSchemaNotTheAddress() error {
	output := w.process.output.String()

	if !strings.Contains(output, "schéma") {
		return fmt.Errorf("le message ne parle pas du schéma :\n%s", output)
	}

	if strings.Contains(output, "écoute sur") {
		return fmt.Errorf("le serveur a lié son port avant de contrôler le schéma : il est entré "+
			"dans le pool du load balancer pour le refuser ensuite.\n%s", output)
	}

	return nil
}

// messageNamesBothVersions lit le message **tel que le binaire l'imprime**, et non la structure
// d'erreur qui le porte : c'est ce texte qui atterrit dans les journaux de déploiement, et c'est de
// lui seul qu'un exploitant tire quoi faire.
//
// Il cherche les **phrases** que le message compose, jamais les nombres nus. La version précédente
// faisait l'inverse et ne prouvait rien : la sortie du process est du JSON `slog` horodaté, où « 0 »
// et « 2 » figurent tous deux dans « 2026 » — un message vidé de ses deux versions restait vert.
func (w *schemaWorld) messageNamesBothVersions() error {
	output := w.process.output.String()

	for label, phrase := range map[string]string{
		"la version trouvée":  store.AppliedVersionPhrase(w.applied),
		"la version attendue": store.ExpectedVersionPhrase(suiteSchemaVersion),
	} {
		if !strings.Contains(output, phrase) {
			return fmt.Errorf("le message ne nomme pas %s (%q) :\n%s", label, phrase, output)
		}
	}

	if w.applied == suiteSchemaVersion {
		return fmt.Errorf("les deux versions valent %d : le contrôle ci-dessus passerait sur un "+
			"message qui n'en nomme qu'une", w.applied)
	}

	return nil
}

// migratedSchemaWithoutAuditPartitions taille une base migrée, puis **retire** les partitions
// d'`audit_log` que la migration vient d'y poser.
//
// C'est le seul moyen de rendre l'appel de démarrage observable : la migration a déjà créé celles que
// `now()` réclame, donc un appel de plus ne changerait rien qu'on puisse voir. Les retirer place la
// base dans l'état où elle sera le 1er octobre — celui où l'écriture d'audit est refusée, et avec
// elle l'action qu'elle trace.
func (w *schemaWorld) migratedSchemaWithoutAuditPartitions(ctx context.Context) error {
	dsn, err := migratedDatabase(ctx)
	if err != nil {
		return err
	}

	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	const partitions = `
		SELECT child.relname
		FROM pg_inherits
		JOIN pg_class AS parent ON parent.oid = pg_inherits.inhparent
		JOIN pg_class AS child ON child.oid = pg_inherits.inhrelid
		WHERE parent.relname = 'audit_log'`

	rows, err := conn.Query(ctx, partitions)
	if err != nil {
		return fmt.Errorf("lire les partitions d'audit : %w", err)
	}

	var names []string

	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			rows.Close()

			return fmt.Errorf("lire un nom de partition : %w", err)
		}

		names = append(names, name)
	}

	rows.Close()

	if err = rows.Err(); err != nil {
		return fmt.Errorf("parcourir les partitions d'audit : %w", err)
	}

	if len(names) == 0 {
		return errors.New("aucune partition d'audit à retirer : ce scénario n'exercerait rien")
	}

	for _, name := range names {
		// Le nom vient du catalogue de cette base même, jamais d'une donnée reçue : PostgreSQL
		// n'accepte de toute façon aucun paramètre lié à cet endroit d'une commande de schéma.
		if _, err = conn.Exec(ctx, "DROP TABLE "+name); err != nil {
			return fmt.Errorf("retirer la partition %s : %w", name, err)
		}
	}

	return w.pointTheServerAt(dsn)
}

// auditLogAcceptsWriteDated écrit un événement daté du mois demandé et observe **où il atterrit** —
// la même forme que dans `internal/store`, et pour la même raison : ce qu'une partition sert à faire
// est d'accueillir une écriture, et c'est cela que son absence casse. Un inventaire de `pg_class`
// décrirait une structure sans jamais tenter l'écriture qui compte.
//
// Le calcul se fait en `timestamp` et ne devient un instant qu'à la sortie, comme les bornes de
// `ensure_audit_log_partitions()` : l'arithmétique de `timestamptz` suit le fuseau de la session.
func (w *schemaWorld) auditLogAcceptsWriteDated(ctx context.Context, month string) error {
	months := map[string]int{"mois courant": 0, "mois suivant": 1}

	offset, known := months[month]
	if !known {
		return fmt.Errorf("mois inconnu : %q", month)
	}

	conn, err := pgx.Connect(ctx, w.dsn)
	if err != nil {
		return fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	const insertDatedEvent = `
		INSERT INTO audit_log (action, created_at)
		VALUES ('test.partition', (date_trunc('month', now() AT TIME ZONE 'UTC')
			+ make_interval(months => $1)) AT TIME ZONE 'UTC')
		RETURNING tableoid::regclass::text,
			to_char(created_at AT TIME ZONE 'UTC', 'YYYY_MM')`

	var landedIn, eventMonth string

	err = conn.QueryRow(ctx, insertDatedEvent, offset).Scan(&landedIn, &eventMonth)
	if err != nil {
		return fmt.Errorf("écrire un événement d'audit daté du %s : %w\n"+
			"le démarrage n'a pas recréé la partition qui manquait", month, err)
	}

	if expected := "audit_log_" + eventMonth; landedIn != expected {
		return fmt.Errorf("l'événement du %s est rangé dans %q et non dans %q : une partition "+
			"fourre-tout accepterait tout en ayant perdu l'élagage par période", month, landedIn,
			expected)
	}

	return nil
}
