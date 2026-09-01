package auth_test

import (
	"go/ast"
	"go/token"
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
// **La porte a deux moitiés, et il a fallu les deux.** La première rédaction n'exigeait que la
// *présence* de l'appel, et une revue l'a mise en défaut le 01/09/2026 par deux formes : jeter le
// résultat (`_ = subtle.ConstantTimeCompare(…)` puis comparer naïvement), et poser un raccourci naïf
// **devant** l'appel. Les deux gardent l'appel dans le corps et rendent le refus en temps variable.
//
// **Le périmètre est nominatif et non topologique, et c'est mesuré** : une règle « toute comparaison
// atteignable depuis un chemin de vérification » compte onze faux positifs, dont sept dans ce paquet
// seul — `decode` compare un nom d'algorithme, une version PHC et des paramètres re-sérialisés, et
// `Verify` l'appelle en première instruction. La contrepartie est écrite : extraire la comparaison
// dans une fonction voisine ferait rougir cette porte à tort.
//
// `loadAuth` et `functionBody` viennent d'`oracle_test.go`, même paquet de test.
const (
	hashVerifier           = "Verify"
	constantTimeComparison = "crypto/subtle.ConstantTimeCompare"
)

func TestUnHachageNeSeCompareQuEnTempsConstant(t *testing.T) {
	t.Parallel()

	pkg := loadAuth(t)
	body := functionBody(t, pkg, hashVerifier)

	assert.Truef(t, callsQualified(pkg, body, constantTimeComparison),
		"%s ne passe plus par %s : le temps que met le refus dit combien d'octets de tête étaient "+
			"justes, et le hachage attendu se reconstruit octet par octet à partir de là",
		hashVerifier, constantTimeComparison)

	assert.Emptyf(t, naiveComparison(pkg, body),
		"%s compare des octets en %s : ce qui décide du verdict n'est plus %s, et sa durée redevient "+
			"lisible", hashVerifier, naiveComparison(pkg, body), constantTimeComparison)
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

// naiveComparison rend la position de la première comparaison qui décide sur des octets, ou une
// chaîne vide.
//
// Go interdit `==` sur les tranches, donc une comparaison naïve d'octets prend forcément l'une de ces
// trois formes : `string(a) == string(b)`, `bytes.Equal`, ou `bytes.Compare`. Les trois sont refusées.
func naiveComparison(pkg *packages.Package, body *ast.BlockStmt) string {
	var found string

	ast.Inspect(body, func(node ast.Node) bool {
		if found != "" {
			return false
		}

		switch current := node.(type) {
		case *ast.BinaryExpr:
			if current.Op != token.EQL && current.Op != token.NEQ {
				return true
			}

			if carriesBytes(pkg, current.X) || carriesBytes(pkg, current.Y) {
				found = pkg.Fset.Position(current.Pos()).String()
			}
		case *ast.CallExpr:
			for _, naive := range []string{"bytes.Equal", "bytes.Compare"} {
				if callsQualified(pkg, current, naive) {
					found = pkg.Fset.Position(current.Pos()).String()
				}
			}
		}

		return found == ""
	})

	return found
}

// carriesBytes dit si l'expression porte des octets — une tranche, ou sa conversion en chaîne.
func carriesBytes(pkg *packages.Package, expression ast.Expr) bool {
	if isByteSlice(pkg, expression) {
		return true
	}

	conversion, isCall := expression.(*ast.CallExpr)
	if !isCall || len(conversion.Args) != 1 {
		return false
	}

	return pkg.TypesInfo.Types[conversion.Fun].IsType() && isByteSlice(pkg, conversion.Args[0])
}

func isByteSlice(pkg *packages.Package, expression ast.Expr) bool {
	carrier := pkg.TypesInfo.Types[expression].Type
	if carrier == nil {
		return false
	}

	_, isSlice := carrier.Underlying().(*types.Slice)

	return isSlice
}
