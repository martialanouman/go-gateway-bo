package store_test

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"testing"

	"github.com/cucumber/godog"
	"github.com/jackc/pgx/v5"

	"github.com/martialanouman/go-gateway-bo/internal/bddtest"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Le plancher du corpus de ce paquet. Le registre qui le tient vit dans `internal/bddtest` : cette
// suite portait jusqu'ici un simple compteur, sans couverture par fichier ni exemption sous `-run` —
// mesuré, `go test -run 'TestScenarios/le_schéma' ./internal/store/` faisait tomber le plancher sur
// un flux de travail parfaitement normal, celui qui consiste à déboguer un scénario seul.
const minimumScenarios = 8

func TestScenarios(t *testing.T) {
	ran := &bddtest.Ledger{}

	suite := godog.TestSuite{
		Name: "store",
		ScenarioInitializer: func(ctx *godog.ScenarioContext) {
			ran.Watch(ctx)
			initializeScenario(ctx)
			initializeSeedScenario(ctx)
		},
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"."},
			TestingT: t,
			// Une step non définie est un échec : sans ça, un scénario dont personne n'a écrit
			// l'implémentation passe pour vert.
			Strict: true,
		},
	}

	if suite.Run() != 0 {
		t.Fatal("des scénarios ont échoué")
	}

	ran.RequireCorpusExercised(t, ".", minimumScenarios)
}

func initializeScenario(ctx *godog.ScenarioContext) {
	schema := &schemaWorld{}

	ctx.Given(`^une base PostgreSQL vierge$`, schema.freshDatabase)
	ctx.Given(`^les migrations déjà jouées$`, schema.migrateThenRecordSchema)
	ctx.When(`^les migrations sont jouées$`, schema.migrate)
	ctx.When(`^les migrations sont rejouées$`, schema.migrate)
	ctx.Then(`^les quatre migrations du schéma sont rapportées appliquées$`, schema.everyMigrationWasReported)
	ctx.Then(`^les onze tables du schéma existent$`, schema.everyTableExists)
	ctx.Then(`^le journal d'audit accepte un événement daté du (mois courant|mois suivant)$`,
		schema.auditLogAcceptsEventDated)
	ctx.Then(`^la seconde exécution n'a rien appliqué$`, schema.lastRunAppliedNothing)
	ctx.Then(`^le schéma est inchangé$`, schema.schemaIsUnchanged)
}

// schemaWorld porte l'état d'un scénario — la base qu'il s'est taillée et ce que la dernière
// exécution des migrations a rapporté. Une struct par scénario : godog en construit une neuve à
// chaque fois, donc rien ne fuit de l'un à l'autre.
type schemaWorld struct {
	dsn          string
	lastOutcome  store.MigrationOutcome
	schemaBefore string
}

func (w *schemaWorld) freshDatabase(ctx context.Context) error {
	dsn, err := createDatabase(ctx)
	if err != nil {
		return err
	}

	w.dsn = dsn

	return nil
}

func (w *schemaWorld) migrate(ctx context.Context) error {
	outcome, err := store.Migrate(ctx, w.dsn)
	if err != nil {
		return fmt.Errorf("jouer les migrations : %w", err)
	}

	w.lastOutcome = outcome

	return nil
}

func (w *schemaWorld) migrateThenRecordSchema(ctx context.Context) error {
	if err := w.migrate(ctx); err != nil {
		return err
	}

	fingerprint, err := w.schemaFingerprint(ctx)
	if err != nil {
		return err
	}

	w.schemaBefore = fingerprint

	return nil
}

// initialMigrations est ce qu'une base vierge doit voir appliquer, dans l'ordre, et la version que
// le schéma atteint alors.
//
// Sans cette assertion, `MigrationOutcome.Applied` n'était tenu qu'**en négatif** — « la seconde
// exécution n'a rien appliqué » — et la boucle qui remplit la liste pouvait disparaître sans qu'une
// suite rougisse : `make migrate` aurait alors annoncé « schéma déjà à jour » sur une base qu'il
// venait d'ériger. Mesuré le 02/08/2026.
var initialMigrations = []string{
	"00001_operators_roles_permissions.sql",
	"00002_audit_log.sql",
	"00003_alerts_notifications_saved_views.sql",
	"00004_login_challenges_and_throttling.sql",
}

const latestSchemaVersion = 4

func (w *schemaWorld) everyMigrationWasReported() error {
	if !slices.Equal(w.lastOutcome.Applied, initialMigrations) {
		return fmt.Errorf("la première exécution rapporte %v et non %v : ce que `make migrate` "+
			"imprime à l'exploitant ne décrit pas ce qu'il vient de faire", w.lastOutcome.Applied,
			initialMigrations)
	}

	if w.lastOutcome.Version != latestSchemaVersion {
		return fmt.Errorf("le schéma est rapporté en version %d et non %d", w.lastOutcome.Version,
			latestSchemaVersion)
	}

	return nil
}

// dashboardTables est l'inventaire du §3.1 — neuf tables, ni plus ni moins. Il est écrit ici en
// toutes lettres plutôt que dérivé des fichiers de migration : une liste dérivée du SQL dirait
// seulement que le SQL fait ce que le SQL dit.
var dashboardTables = []string{
	"operators",
	"permissions",
	"roles",
	"role_permissions",
	"operator_roles",
	"audit_log",
	"alert_rules",
	"notifications",
	"saved_views",
	"mfa_challenges",
	"login_attempt_counters",
}

// dashboardTableCount est le plancher de l'inventaire ci-dessus. Il n'est pas décoratif : mesuré le
// 02/08/2026, `dashboardTables = []string{}` laissait cette suite **verte** — le scénario « les neuf
// tables existent » passait en n'ayant cherché aucune table.
const dashboardTableCount = 11

func (w *schemaWorld) everyTableExists(ctx context.Context) error {
	if len(dashboardTables) != dashboardTableCount {
		return fmt.Errorf("l'inventaire du §3.1 porte %d table(s) pour %d attendues : ce contrôle ne "+
			"regarde plus le schéma que le §3.1 décrit", len(dashboardTables), dashboardTableCount)
	}

	conn, err := w.connect(ctx)
	if err != nil {
		return err
	}

	defer func() { _ = conn.Close(ctx) }()

	var missing []string

	for _, table := range dashboardTables {
		var exists bool

		// `to_regclass` rend NULL plutôt que d'échouer sur une table absente, et voit aussi bien une
		// table ordinaire qu'une table partitionnée — ce que `information_schema.tables` fait aussi,
		// mais en trois jointures.
		err = conn.QueryRow(ctx, "SELECT to_regclass($1) IS NOT NULL", "public."+table).Scan(&exists)
		if err != nil {
			return fmt.Errorf("chercher la table %s : %w", table, err)
		}

		if !exists {
			missing = append(missing, table)
		}
	}

	if len(missing) > 0 {
		return fmt.Errorf("le schéma du tableau de bord n'a pas %v : une installation neuve n'aurait "+
			"nulle part où écrire", missing)
	}

	return nil
}

// auditLogAcceptsEventDated écrit un événement daté du mois demandé, et observe **où il atterrit**.
//
// C'est la forme retenue pour la partition, contre l'inventaire des partitions dans le catalogue :
// ce qu'une partition sert à faire est d'accueillir une écriture, et c'est cela que la mutation
// « ne pas créer la partition du mois suivant » casse — PostgreSQL rend alors
// `no partition of relation "audit_log" found for row`. Un inventaire de `pg_class`, lui, aurait
// décrit une structure sans jamais tenter l'écriture qui compte.
//
// La date de la sonde se calcule **en `timestamp`**, comme les bornes de
// `ensure_audit_log_partitions()`, et ne devient un instant qu'à la sortie : la version précédente
// ajoutait les mois à un `timestamptz`, donc dans le fuseau de la session, et ce scénario aurait
// visé lui-même la mauvaise date sur un schéma décalé.
//
// **Aucun test ne rougit si cette correction disparaît, et c'est mesuré** (02/08/2026, la sonde
// remise sur `timestamptz` : suite verte) : la session de ce scénario tourne en UTC, où les deux
// formes coïncident. Ce qui tient le fuseau est `partitions_test.go`, qui le pose lui-même et ancre
// son mois ; ici, il s'agit de ne pas rejouer la faute qu'on vient de corriger, pour le jour où un
// runner tournera sous un autre fuseau.
func (w *schemaWorld) auditLogAcceptsEventDated(ctx context.Context, month string) error {
	months := map[string]int{"mois courant": 0, "mois suivant": 1}

	offset, known := months[month]
	if !known {
		return fmt.Errorf("mois inconnu : %q", month)
	}

	conn, err := w.connect(ctx)
	if err != nil {
		return err
	}

	defer func() { _ = conn.Close(ctx) }()

	const insertDatedEvent = `
		INSERT INTO audit_log (action, created_at)
		VALUES ('test.partition', (date_trunc('month', now() AT TIME ZONE 'UTC')
			+ make_interval(months => $1)) AT TIME ZONE 'UTC')
		RETURNING tableoid::regclass::text,
			to_char(created_at AT TIME ZONE 'UTC', 'YYYY_MM')`

	var landedIn, eventMonth string

	err = conn.QueryRow(ctx, insertDatedEvent, offset).Scan(&landedIn, &eventMonth)
	if err != nil {
		return fmt.Errorf("écrire un événement d'audit daté du %s : %w", month, err)
	}

	// L'écriture a réussi : reste à vérifier qu'elle n'a pas atterri n'importe où. Une partition
	// `DEFAULT` ajoutée un jour accepterait tout et laisserait le contrôle ci-dessus vert en ayant
	// perdu l'élagage par période que §6.14 attend.
	if expected := "audit_log_" + eventMonth; landedIn != expected {
		return fmt.Errorf("l'événement du %s est rangé dans %q et non dans %q : la partition du mois "+
			"n'a pas reçu son écriture", month, landedIn, expected)
	}

	return nil
}

// lastRunAppliedNothing observe ce que `make migrate` **imprime** à l'exploitant : la liste des
// migrations appliquées, vide quand le schéma était déjà à jour. C'est le seul endroit où la
// rejouabilité est visible depuis l'extérieur — le schéma, lui, est contrôlé par l'empreinte.
func (w *schemaWorld) lastRunAppliedNothing() error {
	if len(w.lastOutcome.Applied) > 0 {
		return fmt.Errorf("la seconde exécution a appliqué %v : une migration déjà jouée l'a été deux "+
			"fois", w.lastOutcome.Applied)
	}

	return nil
}

func (w *schemaWorld) schemaIsUnchanged(ctx context.Context) error {
	if w.schemaBefore == "" {
		return errors.New("aucune empreinte de schéma n'a été relevée avant la seconde exécution : le " +
			"scénario ne compare rien")
	}

	after, err := w.schemaFingerprint(ctx)
	if err != nil {
		return err
	}

	if after != w.schemaBefore {
		return fmt.Errorf("le schéma a changé en rejouant les migrations.\navant :\n%s\naprès :\n%s",
			w.schemaBefore, after)
	}

	return nil
}

// schemaCatalog rend une empreinte textuelle et ordonnée de tout ce que les migrations posent :
// colonnes avec leur type et leur nullabilité, index avec leur définition, et l'attachement de
// chaque partition à sa mère avec ses bornes.
//
// L'ordre est imposé dans le `string_agg` : PostgreSQL ne promet aucun ordre de lecture, et une
// empreinte qui dépendrait de l'ordre physique des lignes changerait toute seule.
//
// **Ce qu'elle ne prouve pas, et ne peut pas prouver** : elle se compare à elle-même, avant et après
// rejeu. Elle tient donc l'idempotence et rien d'autre — y ajouter `pg_constraint` ne ferait pas
// rougir un `CHECK` retiré, puisque les deux côtés de la comparaison bougeraient ensemble. Le
// contenu du schéma est tenu ailleurs : `constraints_test.go` observe chaque refus et chaque
// `ON DELETE` sur leur effet. Restent hors de portée de tout test le type et la nullabilité de
// chaque colonne — aucune suite ne rougit si `notifications.message` devient nullable, ce qui a été
// vérifié le 02/08/2026 plutôt que supposé. Les tenir demanderait une empreinte de référence
// commitée, donc un fichier à mettre à jour à chaque migration ; ce qu'elle attraperait — un type
// changé sans qu'on le veuille — n'est pas encore arrivé une fois.
const schemaCatalog = `
	SELECT coalesce(string_agg(entry, E'\n' ORDER BY entry), '')
	FROM (
		SELECT format('colonne %s.%s %s %s', table_name, column_name, data_type, is_nullable) AS entry
		FROM information_schema.columns
		WHERE table_schema = 'public'
		UNION ALL
		SELECT format('index %s %s', indexname, indexdef)
		FROM pg_indexes
		WHERE schemaname = 'public'
		UNION ALL
		SELECT format('partition %s DE %s %s', child.relname, parent.relname,
			pg_get_expr(child.relpartbound, child.oid))
		FROM pg_inherits
		JOIN pg_class AS child ON child.oid = pg_inherits.inhrelid
		JOIN pg_class AS parent ON parent.oid = pg_inherits.inhparent
	) AS catalogue`

func (w *schemaWorld) schemaFingerprint(ctx context.Context) (string, error) {
	conn, err := w.connect(ctx)
	if err != nil {
		return "", err
	}

	defer func() { _ = conn.Close(ctx) }()

	var fingerprint string

	if err = conn.QueryRow(ctx, schemaCatalog).Scan(&fingerprint); err != nil {
		return "", fmt.Errorf("relever l'empreinte du schéma : %w", err)
	}

	if fingerprint == "" {
		return "", errors.New("l'empreinte du schéma est vide : la base n'a aucune colonne, donc la " +
			"comparaison « avant/après » serait vraie sans rien observer")
	}

	return fingerprint, nil
}

// connect ouvre une connexion nue sur la base du scénario — jamais le pool du produit : ce que ces
// scénarios observent est ce que les migrations ont posé, et une connexion de contrôle indépendante
// est ce qui le rend lisible même quand le pool est fermé.
func (w *schemaWorld) connect(ctx context.Context) (*pgx.Conn, error) {
	if w.dsn == "" {
		return nil, errors.New("aucune base n'a été taillée pour ce scénario")
	}

	conn, err := pgx.Connect(ctx, w.dsn)
	if err != nil {
		return nil, fmt.Errorf("se connecter à la base du scénario : %w", err)
	}

	return conn, nil
}
