package mfa_test

import (
	"go/ast"
	"go/token"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"
)

// La boucle de `MatchRecoveryCode` ne court-circuite pas, et c'est tout ce qui cache **lequel** des
// codes a servi : sortir au premier qui colle rend un verdict dont la durée donne sa position dans la
// liste, à un `auth.Verify` près — vingt-six millisecondes. Le remède tient en `matched = index` au
// lieu de `return index`, et rien ne l'imposait : mesuré le 12/08/2026, la suite restait verte.
//
// Ce que la porte cherche n'est donc pas un appel mais une **absence** : aucune sortie anticipée dans
// le corps de la boucle. `continue` en est une exception — il enchaîne sur l'itération suivante, donc
// ne raccourcit rien. Les fermetures aussi : leur `return` quitte la fermeture, pas la boucle.
const loopWithoutShortcut = "MatchRecoveryCode"

func TestLaBoucleDesCodesDeRecuperationNeCourtCircuitePas(t *testing.T) {
	t.Parallel()

	pkg := loadMFA(t)

	position := shortCircuit(pkg, loopBody(t, functionBody(t, pkg, loopWithoutShortcut)))

	assert.Emptyf(t, position,
		"la boucle de %s sort par anticipation en %s : la durée du verdict dit alors à quel rang le "+
			"code présenté a été trouvé, et les codes restants se distinguent les uns des autres",
		loopWithoutShortcut, position)
}

// loadMFA recharge le paquet par le type-checker, dans la forme d'`internal/bff/dto_test.go`.
func loadMFA(t *testing.T) *packages.Package {
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

// loopBody rend le corps de la première boucle, `range` ou `for` indexé. Elle **échoue** s'il n'y en a
// plus : une réécriture qui remplacerait le parcours par autre chose doit faire rougir plutôt que
// laisser la porte chercher dans le vide.
func loopBody(t *testing.T, body *ast.BlockStmt) *ast.BlockStmt {
	t.Helper()

	var loop *ast.BlockStmt

	ast.Inspect(body, func(node ast.Node) bool {
		if loop != nil {
			return false
		}

		switch statement := node.(type) {
		case *ast.RangeStmt:
			loop = statement.Body
		case *ast.ForStmt:
			loop = statement.Body
		}

		return loop == nil
	})

	require.NotNilf(t, loop,
		"aucune boucle dans %s : la forme sur laquelle cette porte repose a changé, et elle ne garde "+
			"plus ce qu'elle prétend", loopWithoutShortcut)

	return loop
}

// shortCircuit rend la position de la première sortie anticipée du corps, ou une chaîne vide.
func shortCircuit(pkg *packages.Package, body *ast.BlockStmt) string {
	var found string

	ast.Inspect(body, func(node ast.Node) bool {
		if found != "" {
			return false
		}

		switch statement := node.(type) {
		case *ast.FuncLit:
			return false
		case *ast.ReturnStmt:
			found = pkg.Fset.Position(statement.Pos()).String()
		case *ast.BranchStmt:
			if statement.Tok == token.BREAK || statement.Tok == token.GOTO {
				found = pkg.Fset.Position(statement.Pos()).String()
			}
		}

		return found == ""
	})

	return found
}
