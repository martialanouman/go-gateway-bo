package config_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/cucumber/godog"
	"github.com/martialanouman/go-gateway-bo/internal/config"
)

// Les `.feature` vivent à côté du package qu'ils décrivent, d'où `Paths: {"."}`.
// `Strict` fait échouer une step non définie : ignorée par défaut, une feature
// oubliée serait pire qu'absente puisqu'elle se lirait comme une garantie.
func TestFeatures(t *testing.T) {
	suite := godog.TestSuite{
		ScenarioInitializer: initializeScenarios,
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"."},
			Strict:   true,
			TestingT: t,
		},
	}

	if suite.Run() != 0 {
		t.Fatal("des scénarios ont échoué")
	}
}

type world struct {
	env    map[string]string
	loaded *config.Config
	err    error
}

func initializeScenarios(sc *godog.ScenarioContext) {
	w := &world{}

	sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
		*w = world{env: map[string]string{}}
		return ctx, nil
	})

	sc.Step(`^un environnement complet$`, w.completeEnvironment)
	sc.Step(`^"([^"]*)" est absent$`, w.removeVariable)
	sc.Step(`^"([^"]*)" vaut "([^"]*)"$`, w.setVariable)
	sc.Step(`^la configuration est chargée$`, w.loadConfiguration)
	sc.Step(`^le chargement échoue$`, w.loadingFails)
	sc.Step(`^le chargement réussit$`, w.loadingSucceeds)
	sc.Step(`^le message nomme "([^"]*)"$`, w.messageNames)
	sc.Step(`^le message dit que "([^"]*)" est obligatoire$`, w.messageSaysRequired)
	sc.Step(`^le message ne la dit pas obligatoire$`, w.messageAvoidsRequired)
}

// Le diagnostic « absente » et le diagnostic « invalide » doivent rester
// distincts : sans cette assertion, retirer la garde d'obligation laissait la
// suite verte, l'adresse vide échouant de toute façon à la validation de format.
func (w *world) messageSaysRequired(name string) error {
	line, err := w.problemNaming(name)
	if err != nil {
		return err
	}
	if !strings.Contains(line, "obligatoire") {
		return fmt.Errorf("le message ne dit pas %q obligatoire : %s", name, line)
	}
	return nil
}

func (w *world) messageAvoidsRequired() error {
	if w.err != nil && strings.Contains(w.err.Error(), "obligatoire") {
		return fmt.Errorf("une valeur invalide est diagnostiquée comme absente : %s", w.err)
	}
	return nil
}

// errors.Join sépare les problèmes par des sauts de ligne : on cherche la ligne
// qui porte la variable, pas le message entier, sinon deux variables fautives
// se confondraient.
func (w *world) problemNaming(name string) (string, error) {
	if w.err == nil {
		return "", fmt.Errorf("aucune erreur, donc aucun message où chercher %q", name)
	}
	for line := range strings.SplitSeq(w.err.Error(), "\n") {
		if strings.Contains(line, name) {
			return line, nil
		}
	}
	return "", fmt.Errorf("aucune ligne ne nomme %q : %s", name, w.err)
}

func (w *world) completeEnvironment() error {
	for _, variable := range config.Variables {
		w.env[variable.Name] = variable.Example
	}
	return nil
}

func (w *world) removeVariable(name string) error {
	delete(w.env, name)
	return nil
}

func (w *world) setVariable(name, value string) error {
	w.env[name] = value
	return nil
}

func (w *world) loadConfiguration() error {
	w.loaded, w.err = config.Load(func(name string) string { return w.env[name] })
	return nil
}

func (w *world) loadingFails() error {
	if w.err == nil {
		return fmt.Errorf("le chargement a réussi alors qu'il devait échouer")
	}
	return nil
}

func (w *world) loadingSucceeds() error {
	if w.err != nil {
		return fmt.Errorf("le chargement a échoué : %w", w.err)
	}
	return nil
}

func (w *world) messageNames(name string) error {
	if w.err == nil {
		return fmt.Errorf("aucune erreur, donc aucun message où chercher %q", name)
	}
	if !strings.Contains(w.err.Error(), name) {
		return fmt.Errorf("le message ne nomme pas %q : %s", name, w.err)
	}
	return nil
}
