package bff_test

import (
	"go/types"
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"

	"github.com/martialanouman/go-gateway-bo/internal/bddtest"
)

// visitMethod reconnaît le nom qu'oapi-codegen donne aux méthodes de sérialisation d'une réponse.
//
// Le nom **seul** ne suffirait pas à décider, et la signature est vérifiée avec lui : c'est elle qui
// fait qu'une méthode implémente une interface `…ResponseObject`, et donc qu'elle peut être servie.
var visitMethod = regexp.MustCompile(`^Visit[A-Za-z0-9_]*Response$`)

// modulePackageCount est un **plancher**, pas une égalité : `go list ./...` en rapporte **quatorze**
// le jour où ce contrôle est écrit — quatre sous `cmd/`, dix sous `internal/`. Il est là parce qu'un
// chargement qui ne rapporte rien passe en n'ayant rien cherché, et c'est le mode d'échec que ce dépôt
// a déjà payé.
//
// Le premier chiffre écrit ici était vingt, deviné et non mesuré. Il a fait rougir la porte à sa
// première exécution, ce qui est la bonne direction pour un plancher.
const modulePackageCount = 14

// Aucune méthode de sérialisation d'une réponse n'est écrite hors du fichier engendré, **dans tout le
// module**.
//
// C'est le contournement que la revue du 30/08/2026 a trouvé, et il rendait la première rédaction de
// step-026 largement décorative. `HealthResponseObject` (`bff.gen.go`) ne mentionne que
// `http.ResponseWriter` : **n'importe quel paquet peut l'implémenter**, et le dispatch du wrapper
// engendré est une assertion de type à l'exécution, pas une contrainte de paquet. Sondé le
// 30/08/2026 : un `internal/leak` rendant un `store.Operator` complet compile, `Health` le sert, et
// `password_hash` part sur le fil pendant que les cinq règles de `dto_test.go` rendent **rc=0** —
// elles n'énumèrent que les types déclarés dans `internal/bff`.
//
// La règle porte sur la **méthode** et non sur le type, et c'est ce qui la rend plus forte que la
// provenance : implémenter une de ces interfaces exige d'écrire une méthode de ce nom et de cette
// signature, où qu'elle soit. Elle attrape donc du même coup le type déclaré ailleurs, et la méthode
// posée sur un type engendré qui n'en portait pas — `Health`, `Me`, `MfaChallenge` sont engendrés et
// sans méthode, leur en ajouter une compilait sans que rien ne rougisse.
//
// La méthode est trouvée par le **type-checker**, dans `Defs`, et non cherchée dans le texte : un
// détecteur qui grep un nom est rendu vrai par le moindre commentaire qui le cite — le dépôt s'est
// déjà fait prendre.
func TestAucuneMethodeDeSerialisationNEstEcriteAilleurs(t *testing.T) {
	t.Parallel()

	generated := generatedFile(t, loadBFF(t))
	loaded := loadModule(t)

	require.GreaterOrEqualf(t, len(loaded), modulePackageCount,
		"%d paquet(s) chargé(s) pour %d attendus au moins : le contrôle ne regarde plus le module",
		len(loaded), modulePackageCount)

	written, seen := handWrittenVisits(loaded, generated)

	require.Positive(t, seen,
		"aucune méthode de sérialisation trouvée dans le module : la porte est inerte, pas verte")
	assert.Emptyf(t, written,
		"%d méthode(s) de sérialisation écrite(s) à la main : chacune décide seule de ce qui part sur "+
			"le fil, et le wrapper engendré la sert dès qu'un handler rend son type", len(written))
}

// handWrittenVisits rend les méthodes de sérialisation déclarées hors du fichier engendré, et le
// nombre total de celles qu'il a vues — le second sert de témoin anti-vide à l'appelant.
//
// Il est extrait parce que **deux tests l'exercent en sens contraire** : celui du module exige qu'il
// ne rende rien, celui du témoin exige qu'il rende quelque chose. Une porte dont on n'a pas vu le
// rouge ne prouve rien, et c'est la seule façon d'en garder la preuve dans le dépôt plutôt que dans
// une mutation retirée.
func handWrittenVisits(loaded []*packages.Package, generated string) ([]string, int) {
	var written []string

	seen := 0

	for _, pkg := range loaded {
		for identifier, object := range pkg.TypesInfo.Defs {
			method, isFunc := object.(*types.Func)
			if !isFunc || !visitMethod.MatchString(method.Name()) || !writesAResponse(method) {
				continue
			}

			seen++

			if where := pkg.Fset.Position(identifier.Pos()).Filename; where != generated {
				written = append(written, pkg.PkgPath+"."+method.Name()+" ("+where+")")
			}
		}
	}

	return written, seen
}

// writesAResponse dit si la signature est celle d'une méthode `…ResponseObject` : un
// `http.ResponseWriter` en entrée, une `error` en sortie.
//
// Sans elle, un homonyme quelconque — `VisitFooResponse(ctx)` — ferait rougir la porte sans rien
// pouvoir servir, et une garde qui refuse du légitime finit retirée.
func writesAResponse(method *types.Func) bool {
	signature := method.Signature()
	if signature.Recv() == nil || signature.Params().Len() != 1 || signature.Results().Len() != 1 {
		return false
	}

	return signature.Params().At(0).Type().String() == "net/http.ResponseWriter" &&
		signature.Results().At(0).Type().String() == "error"
}

// loadModule type-checke tout le module, depuis sa racine.
//
// Le chemin vient de `bddtest.RepositoryRoot` et non d'un `../..` relatif : le second se casse
// silencieusement le jour où le fichier change de répertoire, et ce contrôle-ci deviendrait alors une
// porte qui ne charge rien.
func loadModule(t *testing.T) []*packages.Package {
	t.Helper()

	loaded, err := packages.Load(&packages.Config{
		Dir:  bddtest.RepositoryRoot(t),
		Mode: packages.NeedName | packages.NeedTypes | packages.NeedSyntax | packages.NeedTypesInfo,
	}, "./...")
	require.NoError(t, err)
	require.NotEmpty(t, loaded)

	for _, pkg := range loaded {
		require.Emptyf(t, pkg.Errors, "%s ne type-checke pas, l'analyse ne prouverait rien", pkg.PkgPath)
	}

	return loaded
}

// Les portes de step-026 **mordent**, et la preuve en reste dans le dépôt.
//
// C'est ce qui manquait à la première rédaction. Sa fiche annonçait « les portes restent mordantes :
// chacune est vue tomber sur une sonde jetable », et le dépôt ne contenait rien de tel : les sondes
// avaient été jouées puis retirées. Rien ne distinguait une porte mordante d'une porte débranchée.
//
// **Chaque règle a son propre témoin, et c'est une correction de la revue.** La première version n'en
// avait qu'un — le paquet `testdata/fuite` — et il restait vert quand on débranchait la règle de
// domaine : le type y est catché par la règle des méthodes, et l'assertion ne regardait que « quelque
// chose a parlé ». Un témoin qui ne dit pas **laquelle** des portes a parlé prouve la mauvaise borne.
//
// Le paquet témoin ne sert donc qu'à la porte du module. Les deux autres règles sont exercées sur des
// types réels et sur un type fabriqué, parce qu'un paquet de `testdata/` est lui-même « du domaine »
// pour le parcours : il y rougirait dès la racine, sans jamais éprouver la descente.
func TestLesPortesMordentSurLeTemoin(t *testing.T) {
	t.Parallel()

	bff := loadBFF(t)
	generated := generatedFile(t, bff)

	t.Run("la porte du module voit un Visit écrit ailleurs", func(t *testing.T) {
		t.Parallel()

		written, seen := handWrittenVisits([]*packages.Package{loadWitness(t)}, generated)

		require.Positive(t, seen, "le témoin ne porte plus de méthode de sérialisation : il ne prouve rien")
		require.NotEmpty(t, written,
			"la porte n'a rien vu sur un paquet écrit pour la faire rougir : elle est débranchée")
	})

	t.Run("la règle de domaine nomme un type du store", func(t *testing.T) {
		t.Parallel()

		operator := importedType(t, bff, modulePath+"internal/store", "Operator")

		assert.Contains(t,
			forbidden(bff, operator, generated, "Sonde", map[types.Type]bool{}),
			"un type de domaine de ce dépôt",
			"la règle de domaine ne reconnaît plus un type du store : elle est débranchée")
	})

	t.Run("la règle des colonnes nomme la colonne", func(t *testing.T) {
		t.Parallel()

		leaking := types.NewStruct([]*types.Var{
			types.NewField(0, bff.Types, "PasswordHash", types.Typ[types.String], false),
		}, nil)

		assert.Contains(t,
			forbidden(bff, leaking, generated, "Sonde", map[types.Type]bool{}),
			"operators.password_hash",
			"la règle des colonnes ne reconnaît plus la colonne qu'elle nomme : elle est débranchée")
	})
}

// importedType rend un type déclaré par un paquet importé, ou fait rougir.
//
// Il passe par les imports **déjà chargés** de `internal/bff` plutôt que par un second
// `packages.Load` : le type doit être le même objet que celui qu'un DTO atteindrait vraiment, sans
// quoi le témoin exercerait la règle sur une copie et non sur ce que la porte voit.
func importedType(t *testing.T, pkg *packages.Package, path, name string) types.Type {
	t.Helper()

	imported, ok := pkg.Imports[path]
	require.Truef(t, ok, "%s n'est plus importé par internal/bff : le témoin ne prouve plus rien", path)

	declared := imported.Types.Scope().Lookup(name)
	require.NotNilf(t, declared, "%s.%s n'existe plus", path, name)

	return declared.Type()
}

// loadWitness charge le paquet témoin par son chemin. `packages.Load` accepte `./testdata/…` alors que
// `./...` l'ignore, ce qui est exactement la propriété recherchée : rouge sur commande, invisible
// autrement.
func loadWitness(t *testing.T) *packages.Package {
	t.Helper()

	loaded, err := packages.Load(&packages.Config{
		Mode: packages.NeedName | packages.NeedTypes | packages.NeedImports | packages.NeedDeps |
			packages.NeedSyntax | packages.NeedTypesInfo,
	}, "./testdata/fuite")
	require.NoError(t, err)
	require.Len(t, loaded, 1)
	require.Empty(t, loaded[0].Errors, "le témoin ne type-checke pas, il ne prouve rien")

	return loaded[0]
}
