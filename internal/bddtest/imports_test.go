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

// Les deux moitiés du module. `internal/bddtest` en fait partie et n'est pas exclu : ce sont les
// paquets qui l'**atteignent** qu'on juge, et il ne s'atteint pas lui-même.
var productionPatterns = []string{"./cmd/...", "./internal/..."}

// Les paquets qui atteignent réellement le harnais, nommés. Un témoin qui se contente de « au moins
// un » se satisfait de lui-même : sous `Tests: true`, `./internal/...` charge aussi le paquet de test
// de ce fichier-ci, qui importe `bddtest` pour `RepositoryRoot`. Il resterait donc vert quand un motif
// cesse de désigner quoi que ce soit alors que l'autre en désigne encore — un `go mv cmd apps`
// produit exactement cet effet. Mesuré : réduits à `./internal/bddtest/...`, les motifs laissaient la
// garde ci-dessous verte sans plus rien garder, et l'ancien témoin vert avec elle.
var harnessImporters = []string{
	"github.com/martialanouman/go-gateway-bo/cmd/dashboard",
	"github.com/martialanouman/go-gateway-bo/cmd/migrate",
	"github.com/martialanouman/go-gateway-bo/internal/gateway",
	"github.com/martialanouman/go-gateway-bo/internal/store",
}

// Ce package est du harnais dans un package ordinaire, parce que Go n'offre rien d'autre : un
// `foo_test` n'est importable de nulle part. Rien dans le langage n'empêche donc un fichier de
// production de l'importer, et il entrerait alors dans le binaire livré avec ce qu'il traîne :
// `go list -f '{{join .Deps "\n"}}' ./internal/bddtest` y montre `testing`, `godog` et `testify`, une
// dizaine de paquets pour les deux derniers. Le coût est la taille et le couplage, pas les
// drapeaux : `testing` n'enregistre les siens que dans `Init()`, appelée par `MainStart` — que seul
// le `_testmain.go` d'un binaire de test appelle — et jamais par le simple import
// (`$(go env GOROOT)/src/testing/testing.go`).
//
// La garde lit le graphe d'imports **résolu** par le type-checker, pas le texte des fichiers :
// chercher le nom du paquet dans les sources serait rendu vrai par le premier commentaire qui le
// mentionne — et ce fichier-ci en est plein. Elle le suit **transitivement** : juger les seuls imports
// directs des paquets qui correspondent aux motifs juge un proxy de « est-ce dans le binaire livré »,
// et un paquet intermédiaire hors motifs suffirait à y faire entrer le harnais sans qu'elle le voie.
func TestNoProductionPackageReachesTheHarness(t *testing.T) {
	for _, loadedPackage := range load(t, false) {
		if packageName(loadedPackage) == harness {
			continue
		}

		chain := chainToHarness(loadedPackage)

		assert.Emptyf(t, chain, "le harnais entre dans le binaire livré par %s",
			strings.Join(chain, " → "))
	}
}

// Le témoin positif. Sans lui, la garde ci-dessus serait verte pour la pire des raisons — un
// chargement qui ne rend rien, un motif qui ne désigne aucun paquet, un chemin d'import mal écrit — et
// personne ne le saurait. Le même parcours, sur les mêmes motifs, **doit** retrouver les quatre
// paquets nommés dès qu'on lui demande aussi les fichiers de test.
func TestTheSameWalkSeesTheHarnessWhenTestFilesAreIncluded(t *testing.T) {
	var reaching []string

	for _, loadedPackage := range load(t, true) {
		name := packageName(loadedPackage)
		if name == harness {
			continue
		}

		if chainToHarness(loadedPackage) != nil {
			reaching = append(reaching, name)
		}
	}

	assert.Subset(t, reaching, harnessImporters,
		"l'analyse ne retrouve pas les suites qui importent le harnais : elle ne garde rien, et la "+
			"garde jumelle est verte pour cette raison-là")
}

// Le parcours transitif n'est pas un raffinement. La garde lisait les imports **directs** des paquets
// qui correspondent aux motifs : un futur `pkg/telemetrie` — hors motifs — qui importerait le harnais
// et que `cmd/dashboard` importerait passait, parce que rien ne chargeait `pkg/telemetrie`. Le graphe
// est synthétique parce que le cas ne peut pas exister dans l'arbre sans être aussitôt corrigé.
func TestTheWalkFollowsAnIntermediatePackageOutsideThePatterns(t *testing.T) {
	relay := &packages.Package{
		PkgPath: "github.com/martialanouman/go-gateway-bo/pkg/telemetrie",
		Imports: map[string]*packages.Package{harness: {PkgPath: harness}},
	}
	binary := &packages.Package{
		PkgPath: "github.com/martialanouman/go-gateway-bo/cmd/dashboard",
		Imports: map[string]*packages.Package{relay.PkgPath: relay},
	}

	require.NotContains(t, binary.Imports, harness,
		"le cas n'a d'intérêt que si le binaire n'importe pas le harnais directement")
	assert.Equal(t, []string{binary.PkgPath, relay.PkgPath, harness}, chainToHarness(binary))
}

// chainToHarness rend la suite d'imports qui mène du paquet au harnais, nil quand il n'y en a aucune.
// L'ordre des imports d'un paquet est celui d'une map Go : quand plusieurs chemins mènent au harnais,
// celui que la garde nomme n'est pas toujours le même — c'est un message d'échec, pas un verdict.
func chainToHarness(from *packages.Package) []string {
	visited := make(map[string]bool)

	var walk func(*packages.Package) []string

	walk = func(current *packages.Package) []string {
		if current.PkgPath == harness {
			return []string{harness}
		}

		if visited[current.PkgPath] {
			return nil
		}

		visited[current.PkgPath] = true

		for _, imported := range current.Imports {
			if chain := walk(imported); chain != nil {
				return append([]string{current.PkgPath}, chain...)
			}
		}

		return nil
	}

	return walk(from)
}

// packageName rend le paquet sous le nom qu'il porte hors test. `Tests: true` sert le même paquet sous
// plusieurs formes — `p`, son test externe `p_test`, et le binaire `p.test` — et un témoin ancré sur
// des noms doit les reconnaître comme un seul, sans quoi déplacer un test d'un package `foo_test` vers
// `foo` le ferait rougir sur un remaniement légitime.
func packageName(loadedPackage *packages.Package) string {
	return strings.TrimSuffix(strings.TrimSuffix(loadedPackage.PkgPath, ".test"), "_test")
}

func load(t *testing.T, withTests bool) []*packages.Package {
	t.Helper()

	loaded, err := packages.Load(&packages.Config{
		Mode:  packages.NeedName | packages.NeedImports | packages.NeedDeps,
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
