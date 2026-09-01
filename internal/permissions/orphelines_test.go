package permissions_test

import (
	"go/ast"
	"go/constant"
	"go/token"
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

// Le catalogue est gardé **contre les rôles** par `TestAucuneCleOrphelineHorsDesTroisDeliberees` :
// toute entrée qu'aucun rôle ne détient y est signalée. Le sens inverse n'était gardé par rien, et
// c'était mesuré depuis le 02/08/2026 — un `const FooBar Key = "foo:bar"` ajouté au bloc compile,
// laisse les deux suites vertes et n'apparaît pas dans le TypeScript engendré, Go ne signalant pas
// une constante exportée inutilisée.
//
// Ce que ça coûte n'est pas cosmétique : `RequirePermission(permissions.FooBar)` compile alors,
// n'entre dans aucun rôle, et **refuse tout le monde en silence** sur la route qu'elle garde.
//
// La porte part de la **portée du paquet** et non de `All()`, qui est justement ce que l'orpheline
// n'atteint pas.
//
// **Le décompte est une égalité et non un plancher, et c'est une correction de revue.** La première
// rédaction posait un plancher à quarante pour quarante-quatre constantes : il ne voyait qu'une panne
// *totale* du filtre, laissait passer une panne partielle de quatre constantes, et aurait accusé le
// filtre le jour où une step supprime des permissions. L'égalité avec le catalogue se met à jour
// toute seule, et elle attrape un défaut que rien d'autre ne tient — deux constantes de la **même
// valeur**, dont une seule est référencée : l'orpheline ne se voit pas par valeur, mais le décompte
// bouge.
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

	assert.Emptyf(t, orphans,
		"%d constante(s) qu'aucune entrée du catalogue ne référence : %v — une garde écrite avec l'une "+
			"d'elles compile, n'entre dans aucun rôle et refuse tout le monde en silence",
		len(orphans), orphans)

	require.Equalf(t, len(permissions.All()), declared,
		"%d constante(s) de type %s pour %d entrée(s) au catalogue : ou le filtre ne les reconnaît plus "+
			"toutes — la porte est alors inerte sur celles qu'il manque —, ou deux constantes portent la "+
			"même valeur, auquel cas une garde écrite avec l'une accorde ce que l'autre nomme",
		declared, keyTypeName, len(permissions.All()))
}

// Une constante de permission écrite **sans son type** est invisible à la porte ci-dessus : son type
// est alors *untyped string*, pas `Key`. Elle reste pourtant assignable à `Key` — une constante non
// typée se convertit implicitement —, donc `RequirePermission(permissions.QuotasManage)` compilerait
// et refuserait tout le monde en silence, exactement le défaut que l'autre porte ferme.
//
// Omettre le type sur une ligne d'un bloc `const` est une écriture Go ordinaire, pas une bizarrerie :
// c'est ce qui rend ce trou probable. Trouvé en revue le 01/09/2026, la porte voisine étant alors
// verte sur cette mutation.
func TestToutLeBlocDesClesPorteSonType(t *testing.T) {
	t.Parallel()

	blocks := 0

	for _, file := range loadPermissions(t).Syntax {
		for _, declaration := range file.Decls {
			block, isConst := declaration.(*ast.GenDecl)
			if !isConst || block.Tok != token.CONST || !declaresKeys(block) {
				continue
			}

			blocks++

			for _, specification := range block.Specs {
				value, isValue := specification.(*ast.ValueSpec)
				require.True(t, isValue)

				assert.NotNilf(t, value.Type,
					"%v est déclarée sans son type dans le bloc des clés : elle reste assignable à %s, "+
						"donc utilisable dans une garde, mais aucune porte ne la confronte au catalogue",
					value.Names, keyTypeName)
			}
		}
	}

	require.Positivef(t, blocks,
		"aucun bloc ne déclare de constante %s : la porte est inerte, pas verte", keyTypeName)
}

// declaresKeys dit si le bloc porte au moins une constante explicitement typée `Key`.
func declaresKeys(block *ast.GenDecl) bool {
	for _, specification := range block.Specs {
		value, isValue := specification.(*ast.ValueSpec)
		if !isValue {
			continue
		}

		if named, isNamed := value.Type.(*ast.Ident); isNamed && named.Name == keyTypeName {
			return true
		}
	}

	return false
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
