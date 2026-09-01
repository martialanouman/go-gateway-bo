package session

import (
	"go/ast"
	"go/types"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"
)

// `hmac.Equal` est ce qui empêche de forger un sceau octet par octet : une comparaison ordinaire rend
// son verdict d'autant plus tard que les octets de tête coïncident, et cet écart se remonte. Le
// remède tient en un appel, et rien ne l'imposait — le remplacer par `string(a) != string(b)`
// laissait la suite entière verte, mesuré le 10/08/2026.
//
// L'appelé est résolu en **objet** du type-checker plutôt que cherché dans la source : `cookie.go`
// cite la forme naïve exacte dans un commentaire, qu'un détecteur textuel trouverait.
const (
	sealReader        = "Unseal"
	constantTimeEqual = "crypto/hmac.Equal"
)

func TestLeSceauNeSeCompareQuEnTempsConstant(t *testing.T) {
	t.Parallel()

	pkg := loadSession(t)

	assert.Truef(t, callsQualified(pkg, functionBody(t, pkg, sealReader), constantTimeEqual),
		"%s ne passe plus par %s : le temps que met le refus dit combien d'octets de tête étaient "+
			"justes, et un sceau se forge octet par octet à partir de là", sealReader, constantTimeEqual)
}

// loadSession recharge le paquet par le type-checker, dans la forme d'`internal/bff/dto_test.go`.
func loadSession(t *testing.T) *packages.Package {
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

// functionBody rend le corps de la fonction nommée et **échoue** si elle n'existe plus : une porte qui
// ne trouve pas son sujet est verte pour la mauvaise raison, ce qu'un renommage produirait.
func functionBody(t *testing.T, pkg *packages.Package, name string) *ast.BlockStmt {
	t.Helper()

	for _, file := range pkg.Syntax {
		for _, declaration := range file.Decls {
			function, isFunction := declaration.(*ast.FuncDecl)
			if isFunction && function.Name.Name == name && function.Body != nil {
				return function.Body
			}
		}
	}

	t.Fatalf("la fonction %s n'existe plus : cette porte ne garde plus rien", name)

	return nil
}

// callsQualified dit si le nœud appelle la fonction nommée par son chemin complet. Le sélecteur est
// résolu par `TypesInfo.Uses`, donc un `Equal` homonyme d'un autre paquet ne compte pas.
func callsQualified(pkg *packages.Package, node ast.Node, qualified string) bool {
	var called bool

	ast.Inspect(node, func(current ast.Node) bool {
		if called {
			return false
		}

		call, isCall := current.(*ast.CallExpr)
		if !isCall {
			return true
		}

		selector, isSelector := call.Fun.(*ast.SelectorExpr)
		if !isSelector {
			return true
		}

		function, isFunction := pkg.TypesInfo.Uses[selector.Sel].(*types.Func)
		called = isFunction && function.Pkg() != nil &&
			function.Pkg().Path()+"."+function.Name() == qualified

		return !called
	})

	return called
}
