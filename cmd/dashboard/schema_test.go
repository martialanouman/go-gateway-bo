package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
)

// schemaWorld porte ce que le scénario du schéma doit connaître pour lire le message de refus : la
// version que la base porte. La version attendue, elle, est celle de la suite — le binaire du
// scénario et les migrations du harnais sortent du même arbre.
type schemaWorld struct {
	process  *process
	occupied net.Listener
	applied  int64
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

	env["DASHBOARD_DATABASE_URL"] = dsn
	w.process.env = env

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
func (w *schemaWorld) messageNamesBothVersions() error {
	output := w.process.output.String()

	for label, version := range map[string]int64{
		"la version trouvée":  w.applied,
		"la version attendue": suiteSchemaVersion,
	} {
		if !strings.Contains(output, strconv.FormatInt(version, 10)) {
			return fmt.Errorf("le message ne nomme pas %s (%d) :\n%s", label, version, output)
		}
	}

	if w.applied == suiteSchemaVersion {
		return fmt.Errorf("les deux versions valent %d : le contrôle ci-dessus passerait sur un "+
			"message qui n'en nomme qu'une", w.applied)
	}

	return nil
}
