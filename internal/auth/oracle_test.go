package auth_test

import (
	"go/ast"
	"go/types"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"
)

// La ligne que cette porte garde est la seule qui ferme l'**oracle d'énumération** : sans l'appel à
// `VerifyDummy` sur la branche « opérateur absent », « adresse inconnue » répond en zéro milliseconde
// là où « mot de passe faux » en coûte des dizaines. Le corps et le code ont beau être identiques,
// l'écart de durée dit à l'attaquant lesquelles de ses adresses existent.
//
// **Pourquoi une porte structurelle et pas un test ordinaire.** Un test de durée est instable en CI,
// et la fiche l'écarte. Un test qui appelle `VerifyDummy` directement — c'est ce que fait
// `TestLeHachageFacticeSExecuteSurNImporteQuelSecret` — garde la **fonction**, jamais son **site
// d'appel** : la supprimer de `passwordMatches` laissait toute la suite verte, mesuré le 09/08/2026.
//
// **Pourquoi le type-checker et pas une recherche de texte.** Ce dépôt a déjà été mordu par un
// détecteur qui cherchait un nom dans la source : un commentaire suffisait à le rendre toujours vrai.
// Ici l'identifiant appelé est résolu en **objet** du type-checker, donc un `// VerifyDummy` en
// commentaire, une variable homonyme ou une fonction d'un autre paquet ne trompent rien.
const (
	guardedFunction = "passwordMatches"
	guardedCall     = "VerifyDummy"
)

func TestLaBrancheDeLAdresseInconnueAppelleLeHachageFactice(t *testing.T) {
	t.Parallel()

	pkg := loadAuth(t)

	body := functionBody(t, pkg, guardedFunction)

	// La branche cherchée est celle qui teste la nullité de l'opérateur. La porte ne se contente pas
	// de trouver l'appel **quelque part** dans la fonction : le placer hors de cette branche le ferait
	// payer à tout le monde, ce qui n'est plus la même chose — et le placer après le `return` ne le
	// ferait payer à personne.
	branch := nilOperatorBranch(t, body)

	assert.True(t, callsFunction(pkg, branch, guardedCall),
		"la branche « opérateur absent » de %s n'appelle pas %s : « adresse inconnue » répond sans "+
			"rien calculer, et l'écart de durée avec « mot de passe faux » énumère les comptes",
		guardedFunction, guardedCall)
}

// loadAuth recharge le paquet par le type-checker, dans la forme de `internal/bff/dto_test.go`.
func loadAuth(t *testing.T) *packages.Package {
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

// nilOperatorBranch rend le corps du premier `if` dont la condition compare quelque chose à `nil`.
//
// Elle **échoue** si aucun n'existe : la garde repose sur cette branche, et une réécriture qui la
// ferait disparaître — un `switch`, un retour anticipé inversé — doit faire rougir plutôt que de
// laisser la porte chercher dans le vide.
func nilOperatorBranch(t *testing.T, body *ast.BlockStmt) ast.Node {
	t.Helper()

	var branch ast.Node

	ast.Inspect(body, func(node ast.Node) bool {
		if branch != nil {
			return false
		}

		conditional, isConditional := node.(*ast.IfStmt)
		if !isConditional {
			return true
		}

		comparison, isComparison := conditional.Cond.(*ast.BinaryExpr)
		if !isComparison {
			return true
		}

		if identifier, isIdentifier := comparison.Y.(*ast.Ident); isIdentifier && identifier.Name == "nil" {
			branch = conditional.Body
		}

		return branch == nil
	})

	require.NotNil(t, branch,
		"aucune branche ne teste la nullité de l'opérateur dans %s : la forme sur laquelle cette porte "+
			"repose a changé, et elle ne garde plus ce qu'elle prétend", guardedFunction)

	return branch
}

// callsFunction dit si le nœud appelle la fonction nommée du **même paquet**. L'identifiant est
// résolu par `TypesInfo.Uses`, donc une variable homonyme ou une fonction importée ne compte pas.
func callsFunction(pkg *packages.Package, node ast.Node, name string) bool {
	var called bool

	ast.Inspect(node, func(current ast.Node) bool {
		if called {
			return false
		}

		call, isCall := current.(*ast.CallExpr)
		if !isCall {
			return true
		}

		identifier, isIdentifier := call.Fun.(*ast.Ident)
		if !isIdentifier {
			return true
		}

		function, isFunction := pkg.TypesInfo.Uses[identifier].(*types.Func)
		called = isFunction && function.Name() == name && function.Pkg() == pkg.Types

		return !called
	})

	return called
}
