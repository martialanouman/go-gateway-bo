// Package bddtest porte ce que les suites `godog` du dépôt avaient chacune recopié.
//
// C'est un package **ordinaire** et non un `_test`, et ce n'est pas un choix : Go n'a pas de package
// de test partageable — un `foo_test` n'est importable de nulle part. Le langage ne l'empêche donc
// pas d'entrer dans le binaire, et c'est une garde d'imports qui s'en charge.
//
// Le précédent est `net/http/httptest` : un paquet **ordinaire** de la bibliothèque standard qui n'a
// de sens que sous un test. Le précédent s'arrête là et ne dispense pas de la garde : `go list -f
// '{{join .Imports " "}}' net/http/httptest` ne montre pas `testing` — il n'emporte donc rien de plus
// dans un binaire qui l'importerait, là où ce paquet-ci emporte `testing`, `godog` et `testify`.
package bddtest

import (
	"context"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"strings"
	"sync"

	"github.com/cucumber/godog"
)

// testingTB est ce que les deux registres appellent sur le `*testing.T` qu'une suite leur passe, et
// rien de plus. `testing.TB` ne conviendrait pas : sa méthode privée interdit toute implémentation
// hors du paquet `testing`, donc aucun test ne pourrait observer ce que le registre rapporte. Le fil
// entre le calcul et `t.Error` resterait alors le seul morceau que rien ne tue — le retirer laissait
// la suite entière verte.
type testingTB interface {
	Helper()
	Logf(format string, args ...any)
	Error(args ...any)
	Fatal(args ...any)
}

// Ledger note ce que la suite a réellement exécuté. `godog` ne pose aucun plancher : `Paths` qui ne
// trouve rien rend une suite vide et **réussie**, et `Strict` ne couvre que les steps non définies
// d'un scénario **lu**. Un `.feature` déplacé, renommé ou vidé laisserait donc la suite verte sans
// que rien n'ait tourné. Le registre ferme les deux trous : un plancher sur ce qui a réellement
// tourné, et l'exigence que chaque `.feature` du répertoire ait porté au moins un scénario.
//
// Le verrou n'est pas décoratif : `godog` exécute les scénarios en parallèle dès que `Concurrency`
// dépasse 1, et ce jour-là le compteur se tairait sous `-race` plutôt que de compter faux.
type Ledger struct {
	mu       sync.Mutex
	byFile   map[string]int
	executed int
}

// Watch accroche le registre à la suite. À appeler dans le `ScenarioInitializer`, avant les
// définitions de step.
func (l *Ledger) Watch(ctx *godog.ScenarioContext) {
	ctx.Before(func(ctx context.Context, sc *godog.Scenario) (context.Context, error) {
		l.mu.Lock()
		defer l.mu.Unlock()

		if l.byFile == nil {
			l.byFile = make(map[string]int)
		}
		// `sc.Uri` est le chemin relatif au répertoire que godog a parcouru, séparé par des `/` :
		// c'est la forme que `FeatureFiles` reproduit, et deux `.feature` de même nom rangés dans des
		// sous-répertoires différents y restent distincts.
		l.byFile[sc.Uri]++
		l.executed++

		return ctx, nil
	})
}

// RequireCorpusExercised est ce qu'une suite appelle après `suite.Run()`. Le plancher vient de
// l'appelant : les trois suites du dépôt n'ont pas le même corpus, et un plancher partagé serait
// celui de la plus petite — c'est-à-dire aucun.
func (l *Ledger) RequireCorpusExercised(t testingTB, root string, minimum int) {
	t.Helper()

	l.requireCorpusExercised(t, root, minimum, runFilter())
}

func (l *Ledger) requireCorpusExercised(t testingTB, root string, minimum int, runFilter string) {
	t.Helper()

	// `TestingT: t` fait de chaque pickle un sous-test, et `t.Run` rend `true` sans exécuter sa closure
	// — donc sans le hook `Before` du registre — quand le nom ne correspond pas au filtre. Le registre
	// ne voit alors qu'une partie du corpus, et les deux exigences accuseraient celui qui débogue un
	// scénario seul d'avoir fait fondre le corpus. Le dire, plutôt que se taire, pour que personne ne
	// croie la porte active.
	if filtersScenarios(runFilter) {
		t.Logf("plancher et couverture du corpus non vérifiés : `-run %s` ne demande qu'une partie des "+
			"scénarios. Ces deux portes ne mordent qu'une suite lancée en entier", runFilter)

		return
	}

	features, err := FeatureFiles(root)
	if err != nil {
		// `return` explicite : `testing.T.Fatal` sort de la goroutine, mais `testingTB` ne promet pas
		// cette sémantique et rien ici ne doit en dépendre. Sans lui, une racine fausse se reprochait
		// **aussi** comme un plancher manqué — un message qui envoie écrire des scénarios existants.
		t.Fatal(err)

		return
	}

	for _, shortfall := range l.shortfalls(features, minimum) {
		t.Error(shortfall)
	}
}

// shortfalls rend ce que le registre reproche au corpus, et rien quand il est entièrement exercé.
func (l *Ledger) shortfalls(features []string, minimum int) []string {
	l.mu.Lock()
	defer l.mu.Unlock()

	var shortfalls []string

	if l.executed < minimum {
		shortfalls = append(shortfalls, fmt.Sprintf(
			"%d scénario(s) exécuté(s) pour un plancher de %d : le corpus a fondu, ou la suite ne le "+
				"trouve plus — dans les deux cas elle ne prouve plus ce qu'elle annonce",
			l.executed, minimum))
	}

	for _, feature := range features {
		if l.byFile[feature] == 0 {
			shortfalls = append(shortfalls, fmt.Sprintf(
				"%s n'a exécuté aucun scénario : il est présent mais la suite l'ignore", feature))
		}
	}

	return shortfalls
}

// FeatureFiles nomme les scénarios que la suite doit exercer, dans la forme où godog les nomme :
// relatifs à `root`, séparés par des `/`. La recherche descend dans les sous-répertoires parce que
// `Paths: ["."]` y descend aussi — un glob `*.feature` ne verrait que le répertoire courant, et un
// `.feature` rangé plus bas tournerait sans que personne n'exige qu'il tourne.
func FeatureFiles(root string) ([]string, error) {
	var features []string

	err := fs.WalkDir(os.DirFS(root), ".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if !entry.IsDir() && strings.HasSuffix(path, ".feature") {
			features = append(features, path)
		}

		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("lecture des fichiers de scénarios sous %s: %w", root, err)
	}

	return features, nil
}

// runFilter rend le motif que `-run` a posé, vide quand la suite tourne en entier. `test.run` est
// enregistré par `testing.Init`, qu'appelle `testing.MainStart` — donc le `_testmain.go` qu'engendre
// `go test`, avant que quoi que ce soit du binaire ne tourne. Le drapeau existe dès qu'un test
// s'exécute, y compris sous un `TestMain` qui n'appellerait jamais `m.Run`
// (`$(go env GOROOT)/src/testing/testing.go`).
func runFilter() string {
	filter := flag.Lookup("test.run")
	if filter == nil {
		return ""
	}

	return filter.Value.String()
}

// filtersScenarios dit si le filtre coupe dans les scénarios eux-mêmes. `-test.run` découpe son motif
// sur les `/`, un niveau par profondeur de sous-test : sans `/`, il ne choisit que le test de tête, et
// les scénarios que celui-ci porte tournent tous.
func filtersScenarios(runFilter string) bool {
	return strings.Contains(runFilter, "/")
}
