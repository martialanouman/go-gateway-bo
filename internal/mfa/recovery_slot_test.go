package mfa_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestLaConfrontationDesCodesNeTientQuUneSeulePlace — dix hachages, une place.
//
// `auth.Verify` prend une place à chaque appel : appelée dans la boucle, elle ferait d'un seul essai
// dix prises sur les dix que compte la borne, et l'amplificateur que cette step vient fermer
// rouvrirait par l'intérieur.
//
// La propriété se lit sur **l'appel**, et non sur une durée : occuper les places et chronométrer
// donnerait un test qui passe sur une machine lente et rougit sur une rapide. Ce que la boucle
// appelle est, lui, décidable — `VerifyHeld` s'exécute sous la place déjà prise par `Hold`.
func TestLaConfrontationDesCodesNeTientQuUneSeulePlace(t *testing.T) {
	t.Parallel()

	file, err := parser.ParseFile(token.NewFileSet(), "recovery.go", nil, 0)
	require.NoError(t, err)

	var body *ast.FuncDecl

	for _, declaration := range file.Decls {
		function, isFunction := declaration.(*ast.FuncDecl)
		if isFunction && function.Name.Name == "MatchRecoveryCode" {
			body = function
		}
	}

	require.NotNil(t, body, "MatchRecoveryCode a disparu : ce test ne garde plus rien")

	holds := authCalls(body, "Hold")

	// La place prise **dans** la boucle est la forme même du défaut : le texte n'y porte toujours
	// qu'un `Hold`, mais il s'exécute dix fois. Compter les appels ne suffit donc pas — il faut savoir
	// où ils sont.
	inLoop := 0

	ast.Inspect(body, func(node ast.Node) bool {
		loop, isLoop := node.(*ast.RangeStmt)
		if !isLoop {
			return true
		}

		inLoop += authCalls(loop.Body, "Hold")

		return true
	})

	assert.Equal(t, 1, holds, "la confrontation ne prend plus une place pour l'ensemble de ses hachages")
	assert.Zero(t, inLoop, "une place est prise à chaque hachage : dix codes en prendraient dix")
	assert.Zero(t, authCalls(body, "Verify"),
		"un hachage passe par `auth.Verify`, qui prend sa propre place, au lieu de `VerifyHeld`")
}

// authCalls compte les appels à `auth.<name>` dans ce nœud.
func authCalls(node ast.Node, name string) int {
	found := 0

	ast.Inspect(node, func(candidate ast.Node) bool {
		call, isCall := candidate.(*ast.CallExpr)
		if !isCall {
			return true
		}

		selector, isSelector := call.Fun.(*ast.SelectorExpr)
		if !isSelector || selector.Sel.Name != name {
			return true
		}

		if pkg, isIdent := selector.X.(*ast.Ident); isIdent && pkg.Name == "auth" {
			found++
		}

		return true
	})

	return found
}
