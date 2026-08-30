package bff_test

import (
	"go/ast"
	"go/types"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"
)

// writerName est la seule fonction du paquet qui écrive un corps JSON sans passer par un `Visit…`
// engendré, et `bodyArgument` la position du corps dans sa signature.
const (
	writerName   = "writeJSON"
	bodyArgument = 2
)

// writeJSONCallSites est un **plancher**, pas une égalité : quatre refus dans `guard.go` et quatre
// dans `router.go` le jour où ce contrôle est écrit. Il est là parce qu'un inventaire vidé passe en
// n'ayant rien cherché — la porte serait verte en n'ayant vu aucun site.
const writeJSONCallSites = 8

// Le second chemin vers le fil ne sérialise que des DTO déclarés.
//
// **`writeJSON` prend un `body any`** (`respond.go`), et c'est la seule surface de sérialisation non
// typée du paquet. Le mode strict retire le `ResponseWriter` du *handler*, pas du produit : les refus
// qu'un middleware écrit — la garde de permission, les quatre erreurs du routeur — partent par ici,
// hors de tout `Visit…Response` engendré et hors de la conformité au contrat que les scénarios
// exercent. `enumeration_test.go` le nomme déjà par l'autre bout.
//
// La porte de step-004 ne pouvait rien en dire : elle énumère des **types**, et ce chemin-ci n'en
// déclare aucun. Ce qui est gardé ici est donc le **site d'appel** — le type statique de l'argument,
// résolu par le type-checker et non par la lecture de l'expression, ce qui laisse passer aussi bien
// `errorResponse{…}` littéral qu'un constructeur qui le rend.
//
// L'alias compte comme le type : `errorResponse` **est** `Error`, engendré depuis le contrat, et
// `types.Unalias` est ce qui le dit. Sans lui la porte refuserait les huit sites légitimes le jour de
// sa livraison, ce qui est la façon la plus sûre de la faire retirer.
func TestLeSecondCheminVersLeFilNeSerialiseQueDesDTODeclares(t *testing.T) {
	t.Parallel()

	pkg := loadBFF(t)
	generated := generatedFile(t, pkg)
	bodies := serializedBodies(t, pkg)

	require.GreaterOrEqualf(t, len(bodies), writeJSONCallSites,
		"%d site(s) d'appel de %s pour %d attendus au moins : la porte ne regarde plus ce chemin",
		len(bodies), writerName, writeJSONCallSites)

	for _, body := range bodies {
		assert.Equalf(t, generated, declarationFile(pkg, body.carrier),
			"%s sérialise un %s, que le contrat n'engendre pas : ce qu'il porte partirait sur le fil "+
				"sans qu'aucun DTO ne le borne", body.where, body.carrier)
	}

	assertNeverPassedAround(t, pkg)
}

// assertNeverPassedAround exige que `writeJSON` ne soit **jamais** nommé ailleurs qu'en position
// d'appel.
//
// Sans cela, la porte ci-dessus se contourne sans faire tomber son plancher, et la revue du
// 30/08/2026 l'a montré : `var emit = writeJSON` puis `emit(w, 403, session)` n'est pas un
// `*ast.CallExpr` dont le `Fun` résout sur la fonction, donc le site n'entre pas dans la population.
// Les huit sites directs restent en place, le `GreaterOrEqual` est satisfait, et la porte est verte
// pendant qu'un type de domaine part sur le fil.
//
// La règle est plus simple à tenir que l'analyse d'un alias : un `writeJSON` qui n'est qu'appelé est
// entièrement vu par la population, et c'est exactement ce que ce contrôle rend vrai.
func assertNeverPassedAround(t *testing.T, pkg *packages.Package) {
	t.Helper()

	called := map[*ast.Ident]bool{}

	for _, file := range pkg.Syntax {
		ast.Inspect(file, func(node ast.Node) bool {
			if call, isCall := node.(*ast.CallExpr); isCall {
				if name, isIdent := call.Fun.(*ast.Ident); isIdent {
					called[name] = true
				}
			}

			return true
		})
	}

	for name, object := range pkg.TypesInfo.Uses {
		resolved, isFunc := object.(*types.Func)
		if !isFunc || resolved.Name() != writerName || called[name] {
			continue
		}

		assert.Failf(t, "writeJSON est passé de main en main",
			"%s nomme %s hors d'une position d'appel : ce qu'il sérialisera n'entre dans aucune "+
				"population, et cette porte resterait verte", pkg.Fset.Position(name.Pos()), writerName)
	}
}

// serializedBody est un argument de corps trouvé sur un site d'appel, avec de quoi le nommer.
type serializedBody struct {
	where   string
	carrier types.Type
}

// serializedBodies rend le type statique du corps de chaque appel à `writeJSON` du paquet.
//
// L'appel est résolu par le **type-checker** et non cherché dans le texte : un détecteur qui grep un
// nom est rendu vrai par le moindre commentaire qui le cite — le dépôt s'est déjà fait prendre. C'est
// le patron de `callsByFunction` et de `cmd/dashboard/partitions_test.go`, appliqué à un argument.
//
// Le paquet est chargé sans ses tests, donc un appel écrit dans un `_test.go` n'entre pas dans la
// population : ce qui est gardé est ce que la production sert.
func serializedBodies(t *testing.T, pkg *packages.Package) []serializedBody {
	t.Helper()

	var found []serializedBody

	for _, file := range pkg.Syntax {
		ast.Inspect(file, func(node ast.Node) bool {
			call, isCall := node.(*ast.CallExpr)
			if !isCall || len(call.Args) <= bodyArgument {
				return true
			}

			name, isIdent := call.Fun.(*ast.Ident)
			if !isIdent {
				return true
			}

			if resolved, isFunc := pkg.TypesInfo.Uses[name].(*types.Func); !isFunc ||
				resolved.Name() != writerName {
				return true
			}

			body := call.Args[bodyArgument]
			found = append(found, serializedBody{
				where:   pkg.Fset.Position(body.Pos()).String(),
				carrier: pkg.TypesInfo.Types[body].Type,
			})

			return true
		})
	}

	return found
}
