package session

import (
	"go/ast"
	"go/token"
	"go/types"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"
)

// `hmac.Equal` est ce qui empêche de forger un sceau octet par octet : une comparaison ordinaire rend
// son verdict d'autant plus tard que les octets de tête coïncident, et cet écart se remonte. Rien ne
// l'imposait — le remplacer par `string(a) != string(b)` laissait la suite entière verte, mesuré le
// 10/08/2026.
//
// **La porte a deux moitiés, et il a fallu les deux.** La première rédaction n'exigeait que la
// *présence* de l'appel ; une revue l'a mise en défaut le 01/09/2026 en posant un raccourci naïf
// **devant** lui — `if string(expected) != string(provided) { return }` —, ce qui rend le refus en
// temps variable tout en laissant `hmac.Equal` dans le corps. La seconde moitié refuse donc toute
// comparaison d'octets, quelle qu'en soit la place.
//
// **Ce que la porte ne voit pas, et c'est écrit plutôt que supposé** : son périmètre est le corps
// d'`Unseal` seul, sans suivi d'appel. Extraire la vérification dans une fonction voisine la ferait
// rougir à tort — le prix assumé d'un périmètre étroit, préféré à un parcours du graphe d'appels qui
// compte onze faux positifs mesurés dans `internal/auth`.
//
// L'appelé est résolu en **objet** du type-checker : `cookie.go` cite la forme naïve exacte dans un
// commentaire, qu'un détecteur textuel trouverait.
const (
	sealReader        = "Unseal"
	constantTimeEqual = "crypto/hmac.Equal"
)

func TestLeSceauNeSeCompareQuEnTempsConstant(t *testing.T) {
	t.Parallel()

	pkg := loadSession(t)
	body := functionBody(t, pkg, sealReader)

	assert.Truef(t, callsQualified(pkg, body, constantTimeEqual),
		"%s ne passe plus par %s : le temps que met le refus dit combien d'octets de tête étaient "+
			"justes, et un sceau se forge octet par octet à partir de là", sealReader, constantTimeEqual)

	assert.Emptyf(t, naiveComparison(pkg, body),
		"%s compare des octets en %s : ce qui décide du refus n'est plus %s, et la durée du verdict "+
			"redevient lisible", sealReader, naiveComparison(pkg, body), constantTimeEqual)
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

// functionBody rend le corps de la déclaration nommée, et échoue si le nom est absent **ou porté par
// deux déclarations**.
//
// Le nom absent était la seule borne de la première rédaction. Une revue a montré le 01/09/2026 que
// l'homonymie en était une autre, et muette : un `func (k APIKey) Verify(…)` dans un fichier trié
// avant `argon2.go` détournait la porte des comparaisons vers cette méthode — qui appelait bien
// `subtle.ConstantTimeCompare` — pendant que le vrai `Verify` comparait naïvement. `pkg.Syntax` suit
// l'ordre des fichiers : « la première trouvée » n'est pas une propriété du code.
func functionBody(t *testing.T, pkg *packages.Package, name string) *ast.BlockStmt {
	t.Helper()

	var found *ast.BlockStmt

	for _, file := range pkg.Syntax {
		for _, declaration := range file.Decls {
			function, isFunction := declaration.(*ast.FuncDecl)
			if !isFunction || function.Name.Name != name || function.Body == nil {
				continue
			}

			require.Nilf(t, found, "deux déclarations se nomment %s : la porte en garderait une au "+
				"hasard de l'ordre des fichiers", name)

			found = function.Body
		}
	}

	require.NotNilf(t, found, "la fonction %s n'existe plus : cette porte ne garde plus rien", name)

	return found
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
