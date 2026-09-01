package permissions_test

import (
	"go/constant"
	"go/types"
	"strconv"
	"testing"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"
)

// keyTypeName nomme le type dont on cherche les constantes. Il est comparé au type **résolu** par le
// type-checker, jamais au texte : `Key` est un nom trop court pour être cherché dans la source.
const keyTypeName = "Key"

// minimumDeclaredKeys est un plancher, pas une égalité — mesuré à 44 le 01/09/2026. Sans lui, un
// filtre qui cesserait de reconnaître le type rendrait zéro constante, donc zéro orpheline, donc du
// vert.
const minimumDeclaredKeys = 40

// Le catalogue est gardé **contre les rôles** par `TestAucuneCleOrphelineHorsDesTroisDeliberees` :
// toute entrée qu'aucun rôle ne détient y est signalée. Le sens inverse n'était gardé par rien, et
// c'était mesuré depuis le 02/08/2026 — un `const FooBar Key = "foo:bar"` ajouté au bloc compile,
// laisse les deux suites vertes et n'apparaît pas dans le TypeScript engendré, Go ne signalant pas
// une constante exportée inutilisée.
//
// Ce que ça coûte n'est pas cosmétique : `RequirePermission(permissions.FooBar)` compile alors,
// n'entre dans aucun rôle, et **refuse tout le monde en silence** sur la route qu'elle garde. C'est
// la même faille que celle qu'un littéral mal orthographié ouvrirait, prise par l'autre bout.
//
// La porte part de la **portée du paquet** et non de `All()`, qui est justement ce que l'orpheline
// n'atteint pas.
func TestAucuneConstanteNeManqueAuCatalogue(t *testing.T) {
	t.Parallel()

	catalogued := make(map[string]bool)
	for _, entry := range permissions.All() {
		catalogued[string(entry.Key)] = true
	}

	var orphans []string

	declared := 0
	scope := loadPermissions(t).Types.Scope()

	for _, name := range scope.Names() {
		value, isKey := declaredKey(scope.Lookup(name))
		if !isKey {
			continue
		}

		declared++

		if !catalogued[value] {
			orphans = append(orphans, name+" = "+strconv.Quote(value))
		}
	}

	require.GreaterOrEqualf(t, declared, minimumDeclaredKeys,
		"%d constante(s) de type %s vue(s) pour %d attendues au moins : le filtre ne reconnaît plus le "+
			"type, la porte est inerte et non verte", declared, keyTypeName, minimumDeclaredKeys)

	assert.Emptyf(t, orphans,
		"%d constante(s) qu'aucune entrée du catalogue ne référence : %v — une garde écrite avec l'une "+
			"d'elles compile, n'entre dans aucun rôle et refuse tout le monde en silence",
		len(orphans), orphans)
}

// loadPermissions recharge le paquet par le type-checker, dans la forme d'`internal/bff/dto_test.go`.
func loadPermissions(t *testing.T) *packages.Package {
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

// declaredKey rend la valeur de la constante si elle est du type `Key` **de ce paquet**. Un type
// homonyme importé d'ailleurs ne compte pas.
func declaredKey(object types.Object) (string, bool) {
	declaration, isConstant := object.(*types.Const)
	if !isConstant {
		return "", false
	}

	named, isNamed := declaration.Type().(*types.Named)
	if !isNamed || named.Obj().Name() != keyTypeName || named.Obj().Pkg() != declaration.Pkg() {
		return "", false
	}

	return constant.StringVal(declaration.Val()), true
}
