package bff

import (
	"go/ast"
	"go/types"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"
)

// writerName est la seule fonction du paquet qui écrive un corps JSON sans passer par un `Visit…`
// engendré, et `bodyArgument` la position du corps dans sa signature.
const (
	writerName   = "writeJSON"
	bodyArgument = 2
)

// strictInterfaceName désigne l'interface que le gabarit strict écrit toujours en pied de fichier
// engendré. **Sa position est la définition de « type engendré »** utilisée plus bas — un renommage du
// fichier de sortie déplace la porte avec lui, là où un `bff.gen.go` codé en dur laisserait la porte
// pointer sur un fichier disparu.
//
// Il double la constante de `dto_test.go` pour la raison que `loadThisPackage` double `loadBFF` :
// celle-là vit dans `package bff_test`.
const strictInterfaceName = "StrictServerInterface"

// writeJSONCallSites est un **plancher**, pas une égalité : quatre refus dans `guard.go` et quatre
// dans `router.go` le jour où ce contrôle est écrit. Il est là parce qu'un inventaire vidé passe en
// n'ayant rien cherché — la porte serait verte en n'ayant vu aucun site.
const writeJSONCallSites = 8

// Le second chemin vers le fil ne sérialise que des DTO déclarés.
//
// **`writeJSON` prend un `body any`** (`respond.go`), et c'est la seule surface de sérialisation non
// typée du paquet. Le mode strict retire le `ResponseWriter` du *handler*, pas du produit : les refus
// qu'un middleware écrit — la garde de permission, les quatre erreurs du routeur — partent par ici,
// hors de tout `Visit…Response` engendré et hors de la conformité au contrat que les scénarios
// exercent. `enumeration_test.go` le nomme déjà par l'autre bout.
//
// La porte de step-004 ne pouvait rien en dire : elle énumère des **types**, et ce chemin-ci n'en
// déclare aucun. Ce qui est gardé ici est donc le **site d'appel** — le type statique de l'argument,
// résolu par le type-checker et non par la lecture de l'expression, ce qui laisse passer aussi bien
// `errorResponse{…}` littéral qu'un constructeur qui le rend.
//
// L'alias compte comme le type : `errorResponse` **est** `Error`, engendré depuis le contrat, et
// `types.Unalias` est ce qui le dit. Sans lui la porte refuserait les huit sites légitimes le jour de
// sa livraison, ce qui est la façon la plus sûre de la faire retirer.
func TestLeSecondCheminVersLeFilNeSerialiseQueDesDTODeclares(t *testing.T) {
	t.Parallel()

	pkg := loadThisPackage(t)

	contract := pkg.Types.Scope().Lookup(strictInterfaceName)
	require.NotNil(t, contract, "%s introuvable : « type engendré » n'a plus de définition",
		strictInterfaceName)
	generated := pkg.Fset.Position(contract.Pos()).Filename

	bodies := serializedBodies(t, pkg)

	require.GreaterOrEqualf(t, len(bodies), writeJSONCallSites,
		"%d site(s) d'appel de %s pour %d attendus au moins : la porte ne regarde plus ce chemin",
		len(bodies), writerName, writeJSONCallSites)

	for _, body := range bodies {
		assert.Equalf(t, generated, declaredIn(pkg, body.carrier),
			"%s sérialise un %s, que le contrat n'engendre pas : ce qu'il porte partirait sur le fil "+
				"sans qu'aucun DTO ne le borne", body.where, body.carrier)
	}
}

// serializedBody est un argument de corps trouvé sur un site d'appel, avec de quoi le nommer.
type serializedBody struct {
	where   string
	carrier types.Type
}

// serializedBodies rend le type statique du corps de chaque appel à `writeJSON` du paquet.
//
// L'appel est résolu par le **type-checker** et non cherché dans le texte : un détecteur qui grep un
// nom est rendu vrai par le moindre commentaire qui le cite — le dépôt s'est déjà fait prendre. C'est
// le patron de `callsByFunction` et de `cmd/dashboard/partitions_test.go`, appliqué à un argument.
//
// Le paquet est chargé sans ses tests, donc un appel écrit dans un `_test.go` n'entre pas dans la
// population : ce qui est gardé est ce que la production sert.
func serializedBodies(t *testing.T, pkg *packages.Package) []serializedBody {
	t.Helper()

	var found []serializedBody

	for _, file := range pkg.Syntax {
		ast.Inspect(file, func(node ast.Node) bool {
			call, isCall := node.(*ast.CallExpr)
			if !isCall || len(call.Args) <= bodyArgument {
				return true
			}

			name, isIdent := call.Fun.(*ast.Ident)
			if !isIdent {
				return true
			}

			if resolved, isFunc := pkg.TypesInfo.Uses[name].(*types.Func); !isFunc ||
				resolved.Name() != writerName {
				return true
			}

			body := call.Args[bodyArgument]
			found = append(found, serializedBody{
				where:   pkg.Fset.Position(body.Pos()).String(),
				carrier: pkg.TypesInfo.Types[body].Type,
			})

			return true
		})
	}

	return found
}

// declaredIn rend le fichier où le type de `carrier` est déclaré, "" pour un type qui n'en a pas.
//
// Il double `declarationFile` de `dto_test.go` pour la raison que `loadThisPackage` double `loadBFF` :
// celui-là vit dans `package bff_test`, et deux paquets de test d'un même répertoire ne partagent pas
// leurs aides.
func declaredIn(pkg *packages.Package, carrier types.Type) string {
	named, ok := types.Unalias(carrier).(*types.Named)
	if !ok {
		return ""
	}

	return pkg.Fset.Position(named.Obj().Pos()).Filename
}
