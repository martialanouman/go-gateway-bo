package bddtest

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const floor = 8

// `TestingT: t` fait de chaque pickle un sous-test, et les hooks `Before` s'exécutent **dans** la
// closure de `t.Run` — or `t.Run` rend `true` sans l'exécuter quand le nom ne correspond pas à
// `-test.run`. Déboguer un scénario seul n'ouvre donc qu'un `Before` sur huit : le registre compterait
// 1 et accuserait le corpus d'avoir fondu, sur un flux de travail parfaitement normal.
func TestARunFilterStandsTheCorpusFloorDown(t *testing.T) {
	t.Parallel()

	// Registre vide, comme après un `-run 'TestScenarios/aucun_nom_ne_correspond'`.
	stoodDown := &recordedT{}

	(&Ledger{}).requireCorpusExercised(stoodDown, ".", floor, "TestScenarios/une_URL_collée")

	assert.Empty(t, stoodDown.errors,
		"la porte accuse celui qui débogue un scénario seul d'avoir fait fondre le corpus")
	assert.NotEmpty(t, stoodDown.logs,
		"la porte se retire sans le dire : rien ne signale qu'elle ne mord plus, et on la croira active")
}

// La porte ne se retire que devant un filtre qui coupe vraiment dans les scénarios. `-test.run`
// découpe son motif sur les `/`, un niveau par profondeur de sous-test : sans `/`, il ne choisit que
// le test de tête et les scénarios tournent tous — se taire là rendrait le plancher retirable par un
// `go test -run TestScenarios`, qui est la commande de tous les jours.
func TestOnlyASubtestFilterStandsTheCorpusFloorDown(t *testing.T) {
	t.Parallel()

	for filter, standsDown := range map[string]bool{
		"":                                 false,
		"TestScenarios":                    false,
		"TestSc":                           false,
		"TestScenarios/une_URL_collée.*":   true,
		"TestScenarios/aucun_nom_ne_colle": true,
	} {
		assert.Equal(t, standsDown, filtersScenarios(filter), "-run %q", filter)
	}
}

func TestTheLedgerReportsACorpusThatShrank(t *testing.T) {
	t.Parallel()

	ran := ledgerOf("assets.feature", floor-1)

	shortfalls := ran.shortfalls([]string{"assets.feature"}, floor)

	require.NotEmpty(t, shortfalls,
		"le corpus a fondu sous le plancher sans que le registre le dise : la suite ne prouve plus "+
			"grand-chose et se tait")
	assert.Contains(t, strings.Join(shortfalls, "\n"), "plancher")
}

func TestTheLedgerReportsAFeatureThatRanNothing(t *testing.T) {
	t.Parallel()

	ran := ledgerOf("assets.feature", floor)

	shortfalls := ran.shortfalls([]string{"assets.feature", "sous-repertoire/silencieux.feature"}, floor)

	require.Len(t, shortfalls, 1,
		"un `.feature` présent que la suite n'ouvre jamais — mal nommé, mal rangé, filtré par un tag — "+
			"est un comportement décrit que personne n'exerce")
	assert.Contains(t, shortfalls[0], "sous-repertoire/silencieux.feature")
}

func TestTheLedgerIsSilentOnAFullyExercisedCorpus(t *testing.T) {
	t.Parallel()

	ran := ledgerOf("assets.feature", floor)

	assert.Empty(t, ran.shortfalls([]string{"assets.feature"}, floor),
		"un corpus entièrement exercé n'a rien à se reprocher")
}

// Le plancher est porté par l'appelant et non par une constante du package : les trois suites n'ont
// pas le même corpus. Un plancher partagé serait celui de la plus petite, donc aucun.
func TestTheFloorIsTheCallersAndNotThePackages(t *testing.T) {
	t.Parallel()

	ran := ledgerOf("base.feature", 2)

	assert.Empty(t, ran.shortfalls([]string{"base.feature"}, 2))
	assert.NotEmpty(t, ran.shortfalls([]string{"base.feature"}, 3),
		"un plancher plus haut que ce qui a tourné doit se voir, sinon chaque suite hérite du plus bas")
}

// `Paths: ["."]` descend dans les sous-répertoires, là où un glob `*.feature` ne voit que le
// répertoire courant : l'exigence doit couvrir exactement ce que godog exécute.
func TestFeatureFilesAreFoundInSubdirectoriesToo(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, "sous-repertoire"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(root, "racine.feature"), nil, 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(root, "sous-repertoire", "range.feature"), nil, 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(root, "pas-un-scenario.go"), nil, 0o644))

	features, err := FeatureFiles(root)

	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"racine.feature", "sous-repertoire/range.feature"}, features,
		"un `.feature` rangé dans un sous-répertoire tournerait sans que personne n'exige qu'il tourne")
}

func ledgerOf(feature string, scenarios int) *Ledger {
	return &Ledger{byFile: map[string]int{feature: scenarios}, executed: scenarios}
}

// `shortfalls` calcule ce que le registre reproche ; c'est la boucle de `requireCorpusExercised` qui
// le rapporte. Le calcul est testé au-dessus, le fil ne l'était nulle part : le remplacer par
// `_ = l.shortfalls(...)` laissait `go test -race ./...` entièrement vert, plancher et couverture par
// fichier supprimés en silence.
func TestTheCorpusGateReportsItsShortfallsToTheTest(t *testing.T) {
	t.Parallel()

	reported := &recordedT{}

	// Un registre vide contre un plancher : `.` est le répertoire de ce paquet, qui ne porte aucun
	// `.feature` — seul le plancher a donc de quoi se plaindre.
	(&Ledger{}).requireCorpusExercised(reported, ".", floor, "")

	require.Len(t, reported.errors, 1,
		"le registre a compté en silence : la porte calcule ce qu'elle reproche et ne le dit à personne")
	assert.Contains(t, reported.errors[0], "plancher")
}

// Le défaut qu'on reproduit ici est une racine fausse — une suite déplacée, un chemin mal recopié.
// Sans cette preuve, retirer le `t.Fatal` du même chemin laissait la suite entière verte : la porte
// aurait alors reproché « 0 scénario(s) exécuté(s) pour un plancher de 8 », qui envoie écrire des
// scénarios là où il n'y a qu'un chemin à corriger.
func TestACorpusRootThatDoesNotExistIsSaidAndNotTakenForAnEmptyOne(t *testing.T) {
	t.Parallel()

	reported := &recordedT{}

	(&Ledger{}).requireCorpusExercised(reported, filepath.Join(t.TempDir(), "corpus-absent"), floor, "")

	require.Len(t, reported.fatals, 1,
		"la racine du corpus n'existe pas et la porte n'en dit rien")
	assert.Contains(t, reported.fatals[0], "corpus-absent")
	assert.Empty(t, reported.errors,
		"la porte reproche un plancher là où le chemin est faux : elle envoie écrire des scénarios "+
			"qui existent déjà")
}

// recordedT capte ce qu'un registre rapporte, là où `*testing.T` le ferait tomber. `testing.TB` porte
// une méthode privée et n'est pas implémentable ici ; `testingTB` ne nomme que les quatre méthodes que
// les registres appellent.
//
// `Fatal` enregistre et rend la main, là où `testing.T.Fatal` sort de la goroutine : les deux tests
// qui s'en servent n'atteignent pas cette branche, et un `Fatal` qui interromprait le calcul le
// rendrait invisible plutôt que constatable.
type recordedT struct {
	errors []string
	fatals []string
	logs   []string
}

func (r *recordedT) Helper() {}

func (r *recordedT) Logf(format string, args ...any) {
	r.logs = append(r.logs, fmt.Sprintf(format, args...))
}

func (r *recordedT) Error(args ...any) { r.errors = append(r.errors, fmt.Sprint(args...)) }
func (r *recordedT) Fatal(args ...any) { r.fatals = append(r.fatals, fmt.Sprint(args...)) }
