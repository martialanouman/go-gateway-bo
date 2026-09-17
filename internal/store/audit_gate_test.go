package store

import (
	"go/ast"
	"go/types"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"
)

// TestToutePorteuseDEvenementLEcrit — la seconde moitié de la garde d'audit.
//
// `internal/bff/enumeration_test.go` vérifie qu'une mutation **nomme** son événement ; rien ne
// vérifiait qu'il est écrit. Une méthode qui reçoit un `Event` et le laisse tomber rendrait l'autre
// porte verte sur une action sans trace. En retirer une seule ne fait rougir personne : il faut les
// deux.
func TestToutePorteuseDEvenementLEcrit(t *testing.T) {
	t.Parallel()

	pkg := loadStorePackage(t)
	callees := map[*types.Func][]*types.Func{}
	records := map[*types.Func]bool{}
	carriers := map[*types.Func]bool{}

	for _, file := range pkg.Syntax {
		for _, declaration := range file.Decls {
			function, isFunction := declaration.(*ast.FuncDecl)
			if !isFunction || function.Body == nil {
				continue
			}

			caller, isFunc := pkg.TypesInfo.Defs[function.Name].(*types.Func)
			if !isFunc {
				continue
			}

			if carriesEvent(caller) {
				carriers[caller] = true
			}

			// `record` est le puits lui-même : il porte l'événement sans s'appeler.
			if caller.Name() == "record" {
				records[caller] = true
			}

			ast.Inspect(function.Body, func(node ast.Node) bool {
				call, isCall := node.(*ast.CallExpr)
				if !isCall {
					return true
				}

				target := calledInStore(pkg, call)
				if target == nil {
					return true
				}

				if target.Name() == "record" {
					records[caller] = true
				}

				callees[caller] = append(callees[caller], target)

				return true
			})
		}
	}

	// Point fixe : une porteuse qui délègue à un helper qui écrit reste vue.
	for changed := true; changed; {
		changed = false

		for caller, called := range callees {
			if records[caller] {
				continue
			}

			for _, target := range called {
				if records[target] {
					records[caller] = true
					changed = true

					break
				}
			}
		}
	}

	require.NotEmpty(t, carriers, "aucune méthode ne porte d'événement : la porte est inerte, pas verte")

	for carrier := range carriers {
		assert.Truef(t, records[carrier],
			"%s reçoit un `Event` et n'atteint jamais `record` : l'action s'écrirait sans sa trace, et "+
				"la porte de `internal/bff` resterait verte", carrier.FullName())
	}
}

// carriesEvent dit si la fonction reçoit l'événement d'audit. Le type est résolu par le
// type-checker, jamais par le nom : un `Event` d'un autre paquet ne passe pas.
func carriesEvent(fn *types.Func) bool {
	params := fn.Signature().Params()
	for index := range params.Len() {
		if params.At(index).Type().String() ==
			"github.com/martialanouman/go-gateway-bo/internal/store.Event" {
			return true
		}
	}

	return false
}

func calledInStore(pkg *packages.Package, call *ast.CallExpr) *types.Func {
	switch target := call.Fun.(type) {
	case *ast.Ident:
		resolved, _ := pkg.TypesInfo.Uses[target].(*types.Func)

		return resolved
	case *ast.SelectorExpr:
		resolved, _ := pkg.TypesInfo.Uses[target.Sel].(*types.Func)

		return resolved
	default:
		return nil
	}
}

// loadStorePackage charge ce paquet-ci avec sa syntaxe et ses types. Le test est dans `store` et non
// `store_test` pour voir `record`, qui n'est pas exporté.
func loadStorePackage(t *testing.T) *packages.Package {
	t.Helper()

	loaded, err := packages.Load(&packages.Config{
		Mode: packages.NeedName | packages.NeedTypes | packages.NeedImports | packages.NeedDeps |
			packages.NeedSyntax | packages.NeedTypesInfo,
	}, ".")
	require.NoError(t, err)
	require.Len(t, loaded, 1)
	require.Empty(t, loaded[0].Errors, "le paquet ne type-checke pas, l'analyse ne prouverait rien")

	return loaded[0]
}
