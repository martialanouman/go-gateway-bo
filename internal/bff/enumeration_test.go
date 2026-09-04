package bff

import (
	"context"
	"go/ast"
	"go/types"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
)

// La porte de l'invariant (c), et c'est elle la vraie livraison de cette step : aucune opération de
// M1 n'exige de permission, mais **aucune step ne pourra plus en ajouter une sans décider**.
// La DoD de step-029 s'engage déjà à la faire rougir en retirant la garde de `POST /operators`.
//
// **Les cas viennent du contrat, jamais de la table qu'ils gardent.** Une porte dont la population
// est tirée de la donnée qu'elle contrôle ne voit pas sa dérive : elle dirait seulement que la table
// est égale à elle-même. C'est la doctrine de `specRoles` (`internal/permissions/roles_test.go`) et
// de `dashboardTables` (`internal/store/base_test.go`), et la mutation qui compte est de **retirer**
// une entrée, pas d'en altérer une.
const contractPath = "../../api/openapi-bff.yaml"

// Les deux planchers, et ce sont bien des planchers : `>=`, pas une égalité. Ils ne sont pas
// décoratifs — mesuré ailleurs dans ce dépôt, un inventaire vidé laisse son contrôle **vert**, il
// passe en n'ayant rien cherché. Ce qu'ils attrapent est la porte devenue aveugle, pas le contrat qui
// grandit : une opération ajoutée n'oblige à rien ici, et c'est la propriété 1 qui exige qu'on la
// décide.
const (
	contractOperationCount = 10
	contractMutationCount  = 8
)

// mutationMethods sont les méthodes HTTP qui changent l'état, donc celles que l'invariant (c) vise.
// `GET` et `HEAD` n'y sont pas : une lecture ne laisse pas de trace et n'exige d'élévation que pour
// `content:read`, qui n'a pas encore de route.
var mutationMethods = []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete}

// operation est ce que la porte lit du contrat, et rien de plus.
type operation struct {
	// goName est le nom de méthode que le code engendré passe au middleware — donc la clé de la table.
	// Il est **résolu par le type-checker** dans `StrictServerInterface`, jamais fabriqué par une
	// transformation de chaîne : le YAML déclare `deleteWebauthnPasskey` et le wrapper passe
	// `DeleteWebauthnPasskey`, et une porte qui comparerait deux vocabulaires serait verte en ne
	// trouvant jamais rien.
	goName      string
	operationID string
	method      string
	path        string
	declares403 bool
}

// contractOperations lit le contrat et rattache chaque opération à son nom Go.
func contractOperations(t *testing.T) []operation {
	t.Helper()

	document, err := (&openapi3.Loader{Context: context.Background()}).LoadFromFile(contractPath)
	require.NoError(t, err, "le contrat est illisible : la porte ne garderait rien")

	goNames := strictServerMethods(t)
	operations := make([]operation, 0, contractOperationCount)

	for path, item := range document.Paths.Map() {
		for method, declared := range item.Operations() {
			require.NotEmptyf(t, declared.OperationID,
				"%s %s n'a pas d'operationId : la garde se pose par opération, et une opération sans "+
					"nom ne peut pas en porter", method, path)

			resolved, found := goNameOf(goNames, declared.OperationID)
			require.Truef(t, found,
				"aucune méthode de StrictServerInterface ne correspond à l'operationId %q : le pont "+
					"entre les deux vocabulaires est rompu, et toute entrée de la table serait "+
					"inatteignable", declared.OperationID)

			operations = append(operations, operation{
				goName:      resolved,
				operationID: declared.OperationID,
				method:      method,
				path:        path,
				declares403: declared.Responses.Status(http.StatusForbidden) != nil,
			})
		}
	}

	require.GreaterOrEqual(t, len(operations), contractOperationCount,
		"le contrat déclare %d opération(s) pour un plancher de %d : la porte ne regarde plus le "+
			"contrat qu'elle est censée garder", len(operations), contractOperationCount)

	return operations
}

func (o operation) mutates() bool { return slices.Contains(mutationMethods, o.method) }

// strictServerMethods rend les noms de méthode de l'interface engendrée. C'est la seule source du
// vocabulaire Go : la lire ici plutôt que transformer la chaîne du YAML est ce qui fait que le pont
// se rompt bruyamment le jour où oapi-codegen nommerait autrement.
func strictServerMethods(t *testing.T) []string {
	t.Helper()

	pkg := loadThisPackage(t)

	declared := pkg.Types.Scope().Lookup("StrictServerInterface")
	require.NotNil(t, declared, "StrictServerInterface introuvable : le code engendré a changé de forme")

	contract, isInterface := declared.Type().Underlying().(*types.Interface)
	require.True(t, isInterface, "StrictServerInterface n'est plus une interface")

	names := make([]string, 0, contract.NumMethods())
	for index := range contract.NumMethods() {
		names = append(names, contract.Method(index).Name())
	}

	require.NotEmpty(t, names, "l'interface engendrée ne déclare aucune opération : la porte est inerte")

	return names
}

// goNameOf apparie les deux vocabulaires par comparaison insensible à la casse. Le YAML impose le
// camelCase, oapi-codegen le PascalCase, et rien d'autre ne les sépare.
func goNameOf(candidates []string, operationID string) (string, bool) {
	for _, candidate := range candidates {
		if strings.EqualFold(candidate, operationID) {
			return candidate, true
		}
	}

	return "", false
}

// TestChaqueOperationDuContratEstDecidee — propriété 1, et celle qui force les steps à venir.
func TestChaqueOperationDuContratEstDecidee(t *testing.T) {
	t.Parallel()

	for _, declared := range contractOperations(t) {
		_, decided := authorization[declared.goName]
		assert.Truef(t, decided,
			"%s %s (%s) n'a aucune entrée dans la table d'autorisation : ni clé exigée, ni exemption "+
				"écrite. Le défaut étant fermé, elle est servie en 403 — décider est le seul remède",
			declared.method, declared.path, declared.goName)
	}
}

// TestLaTableNeDecidePasDOperationInconnue est le sens inverse, et il n'est pas redondant.
//
// Sans lui, une entrée écrite dans le vocabulaire du YAML — `"login"` — passerait : la propriété 1
// ne regarde que les opérations qui ont une entrée, jamais les entrées qui n'ont pas d'opération.
func TestLaTableNeDecidePasDOperationInconnue(t *testing.T) {
	t.Parallel()

	known := make([]string, 0, contractOperationCount)
	for _, declared := range contractOperations(t) {
		known = append(known, declared.goName)
	}

	for name := range authorization {
		assert.Containsf(t, known, name,
			"la table décide de %q, qui n'est aucune opération du contrat : l'entrée est inatteignable, "+
				"et l'opération qu'elle croyait garder est décidée par le défaut", name)
	}
}

// TestChaqueCleCiteeExisteAuCatalogue — propriété 2, et le **seul** endroit du dépôt qui tienne ce
// sens. `internal/permissions/catalog.go` le documente : une constante déclarée mais absente du
// catalogue compile, laisse les deux suites vertes, et `requires(permissions.FooBar)`
// refuserait alors tout le monde en silence.
func TestChaqueCleCiteeExisteAuCatalogue(t *testing.T) {
	t.Parallel()

	cataloged := make([]permissions.Key, 0, len(permissions.All()))
	for _, entry := range permissions.All() {
		cataloged = append(cataloged, entry.Key)
	}

	require.NotEmpty(t, cataloged, "le catalogue est vide : la porte est inerte, pas verte")

	for name, decided := range authorization {
		if decided.exempted() {
			continue
		}

		assert.Containsf(t, cataloged, decided.permission,
			"%s exige la clé %q, qu'aucune entrée du catalogue ne porte : la garde refuserait tout le "+
				"monde, sans qu'aucun rôle puisse jamais l'accorder", name, decided.permission)
	}
}

// TestChaqueExemptionPorteSaRaison — propriété 3. Une liste d'exemptions qui s'allonge sans motif
// écrit est le premier état d'une garde désactivée.
func TestChaqueExemptionPorteSaRaison(t *testing.T) {
	t.Parallel()

	mutations := 0

	for _, declared := range contractOperations(t) {
		if !declared.mutates() {
			continue
		}

		mutations++

		decided := authorization[declared.goName]
		if !decided.exempted() {
			continue
		}

		assert.NotEmptyf(t, strings.TrimSpace(decided.exemption),
			"%s %s est exemptée sans raison écrite", declared.method, declared.path)
	}

	require.GreaterOrEqual(t, mutations, contractMutationCount,
		"le contrat porte %d mutation(s) pour un plancher de %d : la porte ne regarde plus les "+
			"opérations que l'invariant (c) vise", mutations, contractMutationCount)
}

// TestChaqueOperationGardeeDeclareSon403 — propriété 4.
//
// Le refus de la garde est écrit **à la main** sur le `ResponseWriter`, donc il échappe au
// `Visit…Response` engendré et à la conformité au contrat que les scénarios exercent. Ce qu'il porte
// est gardé depuis step-026 par `TestLeSecondCheminVersLeFilNeSerialiseQueDesDTODeclares` ; ce que le
// **contrat en dit**, c'est-à-dire le 403 déclaré, reste l'affaire de ce cas-ci. Sans cette
// propriété, la première route gardée servirait un 403 que le YAML ne déclare pas, et c'est le
// scénario de step-029 qui le découvrirait — une step trop tard.
func TestChaqueOperationGardeeDeclareSon403(t *testing.T) {
	t.Parallel()

	for _, declared := range contractOperations(t) {
		if authorization[declared.goName].exempted() {
			continue
		}

		assert.Truef(t, declared.declares403,
			"%s %s exige une permission mais ne déclare pas %s au contrat : le refus servi ne serait "+
				"conforme à rien, et la validation des scénarios le rejetterait",
			declared.method, declared.path, strconv.Itoa(http.StatusForbidden))
	}
}

// TestChaqueMutationLaisseUneTrace — propriété 5, et elle lit **le code** plutôt qu'une déclaration.
//
// Une table « voici les opérations auditées » se déclare vraie sans preuve : une opération listée
// dont le handler cesse d'écrire y resterait, verte. Ce qui est lu ici est l'appel réel, résolu par
// le type-checker, avec un point fixe sur les appels intra-paquet — de sorte que la lecture reste
// vraie le jour où une écriture passe par un helper extrait.
func TestChaqueMutationLaisseUneTrace(t *testing.T) {
	t.Parallel()

	writers := operationsThatAudit(t)
	require.NotEmpty(t, writers, "aucune opération n'atteint le journal : la porte est inerte, pas verte")

	for _, declared := range contractOperations(t) {
		if !declared.mutates() {
			continue
		}

		if reason, exempted := auditExemptions[declared.goName]; exempted {
			assert.NotEmptyf(t, strings.TrimSpace(reason),
				"%s %s est exemptée d'audit sans raison écrite", declared.method, declared.path)

			assert.NotContainsf(t, writers, declared.goName,
				"%s %s est déclarée exemptée d'audit et en écrit pourtant : l'exemption ment sur ce que "+
					"le code fait", declared.method, declared.path)

			continue
		}

		assert.Containsf(t, writers, declared.goName,
			"%s %s ne laisse aucune trace au journal et ne figure pas dans les exemptions nommées : "+
				"l'invariant (c) exige l'un ou l'autre, écrit", declared.method, declared.path)
	}
}

// operationsThatAudit rend les méthodes de `API` qui atteignent une écriture d'audit.
//
// Le point fixe est ce qui distingue cette porte d'un `grep` : elle suit les appels du paquet jusqu'à
// ce que plus rien ne s'ajoute, donc un handler qui délègue son écriture reste vu.
func operationsThatAudit(t *testing.T) []string {
	t.Helper()

	pkg := loadThisPackage(t)
	callees := map[*types.Func][]*types.Func{}
	audits := map[*types.Func]bool{}

	for _, file := range pkg.Syntax {
		for _, declaration := range file.Decls {
			function, isFunction := declaration.(*ast.FuncDecl)
			if !isFunction || function.Body == nil {
				continue
			}

			caller, isFunc := pkg.TypesInfo.Defs[function.Name].(*types.Func)
			if !isFunc {
				continue
			}

			ast.Inspect(function.Body, func(node ast.Node) bool {
				call, isCall := node.(*ast.CallExpr)
				if !isCall {
					return true
				}

				target := calledFunction(pkg, call)
				if target == nil {
					return true
				}

				if writesAudit(target) {
					audits[caller] = true
				}

				callees[caller] = append(callees[caller], target)

				return true
			})
		}
	}

	for changed := true; changed; {
		changed = false

		for caller, called := range callees {
			if audits[caller] {
				continue
			}

			for _, target := range called {
				if audits[target] {
					audits[caller] = true
					changed = true

					break
				}
			}
		}
	}

	return auditingOperations(audits)
}

// writesAudit reconnaît le puits : les deux écritures de `store.Audit`. Le nom seul ne suffirait pas
// — `Record` est un nom trop commun pour qu'un homonyme d'un autre paquet ne finisse pas par exister.
func writesAudit(fn *types.Func) bool {
	if fn.Pkg() == nil ||
		fn.Pkg().Path() != "github.com/martialanouman/go-gateway-bo/internal/store" {
		return false
	}

	receiver := fn.Signature().Recv()
	if receiver == nil || !strings.HasSuffix(receiver.Type().String(), "store.Audit") {
		return false
	}

	return fn.Name() == "Record" || fn.Name() == "RecordTx"
}

func calledFunction(pkg *packages.Package, call *ast.CallExpr) *types.Func {
	switch target := call.Fun.(type) {
	case *ast.Ident:
		resolved, _ := pkg.TypesInfo.Uses[target].(*types.Func)

		return resolved
	case *ast.SelectorExpr:
		resolved, _ := pkg.TypesInfo.Uses[target.Sel].(*types.Func)

		return resolved
	default:
		return nil
	}
}

// auditingOperations ne retient que les méthodes de `API` : ce sont elles que le contrat nomme, et
// un helper qui écrit n'est pas une opération.
func auditingOperations(audits map[*types.Func]bool) []string {
	names := make([]string, 0, len(audits))

	for fn, writes := range audits {
		if !writes {
			continue
		}

		receiver := fn.Signature().Recv()
		if receiver != nil && strings.HasSuffix(receiver.Type().String(), "bff.API") {
			names = append(names, fn.Name())
		}
	}

	return names
}
