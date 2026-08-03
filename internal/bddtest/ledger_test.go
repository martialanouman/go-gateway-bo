package bddtest

import (
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

	// Registre vide, comme après un `-run 'TestScenarios/aucun_nom_ne_correspond'`. Si la porte
	// mordait encore, c'est ce test-ci qui tomberait.
	(&Ledger{}).requireCorpusExercised(t, ".", floor, "TestScenarios/une_URL_collée")
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
