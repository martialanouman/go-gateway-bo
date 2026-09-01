package auth_test

import (
	"go/ast"
	"go/types"
	"testing"

	"github.com/stretchr/testify/assert"
	"golang.org/x/tools/go/packages"
)

// `subtle.ConstantTimeCompare` est ce qui empêche de remonter un hachage octet par octet : `==` sur
// deux clés rend son verdict d'autant plus tard que les octets de tête coïncident. Rien ne l'imposait
// — le remplacer par `string(key) == string(expected)` laissait tout le paquet vert, mesuré le
// 09/08/2026.
//
// Le périmètre est **nominatif** et non topologique, et c'est mesuré : une règle « toute comparaison
// atteignable depuis un chemin de vérification » compte onze faux positifs, dont sept dans ce paquet
// seul — `decode` compare un nom d'algorithme, une version PHC et des paramètres re-sérialisés, et
// `Verify` l'appelle en première instruction. Une porte qui refuse du légitime finit retirée.
//
// `loadAuth` et `functionBody` viennent d'`oracle_test.go`, même paquet de test.
const (
	hashVerifier           = "Verify"
	constantTimeComparison = "crypto/subtle.ConstantTimeCompare"
)

func TestUnHachageNeSeCompareQuEnTempsConstant(t *testing.T) {
	t.Parallel()

	pkg := loadAuth(t)

	assert.Truef(t, callsQualified(pkg, functionBody(t, pkg, hashVerifier), constantTimeComparison),
		"%s ne passe plus par %s : le temps que met le refus dit combien d'octets de tête étaient "+
			"justes, et le hachage attendu se reconstruit octet par octet à partir de là",
		hashVerifier, constantTimeComparison)
}

// callsQualified dit si le nœud appelle la fonction nommée par son chemin complet. Le sélecteur est
// résolu par `TypesInfo.Uses`, donc un homonyme d'un autre paquet ne compte pas — et un commentaire
// citant la forme naïve, comme `argon2.go` en porte un, ne trompe rien.
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
