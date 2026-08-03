package bddtest_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"

	"github.com/martialanouman/go-gateway-bo/internal/bddtest"
)

const harness = "github.com/martialanouman/go-gateway-bo/internal/bddtest"

// Les deux moitiés du module. `internal/bddtest` en fait partie et n'est pas exclu : ce sont ses
// **importateurs** qu'on juge, et il ne s'importe pas lui-même.
var productionPatterns = []string{"./cmd/...", "./internal/..."}

// Ce package est du harnais dans un package ordinaire, parce que Go n'offre rien d'autre : un
// `foo_test` n'est importable de nulle part. Rien dans le langage n'empêche donc un fichier de
// production de l'importer, et il entrerait alors dans le binaire livré — avec `testing`, et avec les
// drapeaux que `testing` enregistre.
//
// La garde lit le graphe d'imports **résolu** par le type-checker, pas le texte des fichiers :
// chercher le nom du paquet dans les sources serait rendu vrai par le premier commentaire qui le
// mentionne — et ce fichier-ci en est plein.
func TestNoProductionFileImportsTheHarness(t *testing.T) {
	loaded := load(t, false)

	for _, loadedPackage := range loaded {
		for imported := range loadedPackage.Imports {
			assert.NotEqualf(t, harness, imported,
				"%s importe le harnais depuis un fichier de production : il entre dans le binaire",
				loadedPackage.PkgPath)
		}
	}
}

// Le témoin positif. Sans lui, la garde ci-dessus serait verte pour la pire des raisons — un
// chargement qui ne rend rien, un motif qui ne désigne aucun paquet, un chemin d'import mal écrit —
// et personne ne le saurait. Ici, le même analyseur, sur les mêmes motifs, **doit** trouver le
// harnais dès qu'on lui demande aussi les fichiers de test, puisque trois suites l'importent.
func TestTheSameAnalysisSeesTheHarnessWhenTestFilesAreIncluded(t *testing.T) {
	loaded := load(t, true)

	var importers []string

	for _, loadedPackage := range loaded {
		for imported := range loadedPackage.Imports {
			if imported == harness {
				importers = append(importers, loadedPackage.PkgPath)
			}
		}
	}

	require.NotEmpty(t, importers,
		"l'analyse ne voit le harnais nulle part, pas même dans les suites qui l'importent : "+
			"elle ne garde rien, et la garde jumelle est verte pour cette raison-là")
	t.Logf("le harnais est importé par %d paquet(s) de test : %s", len(importers), strings.Join(importers, ", "))
}

func load(t *testing.T, withTests bool) []*packages.Package {
	t.Helper()

	loaded, err := packages.Load(&packages.Config{
		Mode:  packages.NeedName | packages.NeedImports,
		Dir:   bddtest.RepositoryRoot(t),
		Tests: withTests,
	}, productionPatterns...)
	require.NoError(t, err)
	require.NotEmpty(t, loaded, "aucun paquet chargé : les motifs ne désignent plus rien")

	// Une erreur de chargement laisse un paquet sans ses imports, et la garde le déclarerait innocent.
	for _, loadedPackage := range loaded {
		require.Emptyf(t, loadedPackage.Errors, "%s n'a pas pu être chargé", loadedPackage.PkgPath)
	}

	return loaded
}
