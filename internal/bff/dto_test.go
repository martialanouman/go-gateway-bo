package bff_test

import (
	"go/types"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"
)

// responseObjectSuffix nomme les interfaces qu'engendre oapi-codegen pour chaque opération —
// `HealthResponseObject` aujourd'hui. C'est un nom d'interface, pas un nom de type de réponse : la
// population se déduit ensuite de `types.Implements`, jamais d'une recherche de motif sur les types
// eux-mêmes. Le dépôt a déjà été mordu par un détecteur qui cherchait un nom dans du texte source,
// que le moindre commentaire rendait toujours vrai.
//
// Si oapi-codegen changeait cette convention, la population deviendrait vide — et c'est un échec,
// pas un succès, par l'assertion `require.NotEmpty` ci-dessous.
const responseObjectSuffix = "ResponseObject"

// contractInterfaceName désigne l'interface que le gabarit strict d'oapi-codegen écrit toujours en
// pied de fichier (`strict-interface.tmpl:234`). Sa position **est** la définition de « fichier
// engendré » utilisée plus bas — un renommage du fichier de sortie déplace la porte avec lui, là où
// un `bff.gen.go` codé en dur laisserait la porte pointer sur un fichier disparu.
const contractInterfaceName = "StrictServerInterface"

// loadBFF recharge le paquet par le type-checker. C'est ce qui permet d'énumérer *tous* les types de
// réponse, y compris ceux qu'une step future ajoutera sans toucher à ce fichier — là où la réflexion
// ne verrait que les types qu'un test nomme déjà.
func loadBFF(t *testing.T) *packages.Package {
	t.Helper()

	loaded, err := packages.Load(&packages.Config{
		Mode: packages.NeedName | packages.NeedTypes | packages.NeedImports | packages.NeedDeps,
	}, ".")
	require.NoError(t, err)
	require.Len(t, loaded, 1)
	require.Empty(t, loaded[0].Errors, "le paquet ne type-checke pas, l'analyse ne prouverait rien")

	return loaded[0]
}

// responseInterfaces rend les interfaces `…ResponseObject` déclarées par le code engendré.
func responseInterfaces(scope *types.Scope) []*types.Interface {
	var found []*types.Interface

	for _, name := range scope.Names() {
		if !strings.HasSuffix(name, responseObjectSuffix) {
			continue
		}

		declared, ok := scope.Lookup(name).(*types.TypeName)
		if !ok {
			continue
		}

		if iface, ok := declared.Type().Underlying().(*types.Interface); ok {
			found = append(found, iface)
		}
	}

	return found
}

// implementsAny teste la valeur **et** le pointeur : un type dont les méthodes ont un récepteur
// pointeur n'implémente l'interface que sous cette forme, et l'omettre laisserait échapper des
// types de réponse de la population.
//
// Aucun test ne rougit si la moitié `types.NewPointer` disparaît, ce qui a été vérifié plutôt que
// supposé — le gabarit d'oapi-codegen écrit toujours `func (response Xxx) VisitXxxResponse`
// (`strict-interface.tmpl:82`), un récepteur valeur. Elle reste parce que sa disparition ne ferait
// pas rougir non plus le jour où un type de réponse écrit à la main prendrait un récepteur pointeur :
// il sortirait simplement de la population, sans que rien ne le dise.
func implementsAny(candidate types.Type, ifaces []*types.Interface) bool {
	for _, iface := range ifaces {
		if types.Implements(candidate, iface) || types.Implements(types.NewPointer(candidate), iface) {
			return true
		}
	}

	return false
}

// dynamicShape nomme la première forme **non déclarée** que porte `carrier`, et rend "" quand il n'en
// contient aucune. C'est la porte que le DTO de sortie demande (§1.11) : un champ absent du struct ne
// peut pas fuir, encore faut-il que les champs présents aient eux-mêmes une forme bornée.
//
// Deux formes seulement, et la frontière est mesurée :
//
//   - une **map**, quel que soit son type de valeur : ses clés ne sont pas déclarées, donc rien ne
//     borne ce qu'un handler y écrit. C'est la forme qu'oapi-codegen émet pour
//     `additionalProperties` — mesuré, 23 champs de ce genre dans `internal/gateway/client.gen.go`,
//     dont `Filters map[string]interface{}` et `ConfigJson *map[string]interface{}`. Le jour où un
//     schéma du contrat **du BFF** en porte un, cette porte rougit et le YAML se relit.
//   - l'**interface vide** (`any`) : elle accepte n'importe quelle valeur et sérialise sa valeur
//     dynamique.
//
// Une interface **non** vide passe, et ce n'est pas un oubli : `io.Reader` est la forme
// qu'oapi-codegen donne au corps d'une réponse binaire (`strict-interface.tmpl:63`), un flux et non
// une surface de sérialisation. L'interdire fermerait la porte à l'export que le contrat déclarera,
// et une garde qui refuse du légitime finit retirée.
//
// Le parcours ne descend que dans ce qui se sérialise : champs exportés et champs anonymes, dont les
// champs exportés se promeuvent.
func dynamicShape(carrier types.Type, path string, visited map[types.Type]bool) string {
	if visited[carrier] {
		return ""
	}
	visited[carrier] = true

	switch shape := carrier.(type) {
	case *types.Map:
		return path + " est une " + shape.String()
	case *types.Interface:
		if shape.NumMethods() == 0 {
			return path + " est une interface vide"
		}

		return ""
	case *types.Struct:
		return dynamicFieldShape(shape, path, visited)
	case *types.Pointer:
		return dynamicShape(shape.Elem(), path, visited)
	case *types.Slice:
		return dynamicShape(shape.Elem(), path+"[]", visited)
	case *types.Array:
		return dynamicShape(shape.Elem(), path+"[]", visited)
	case *types.Named, *types.Alias:
		return dynamicShape(carrier.Underlying(), path, visited)
	default:
		return ""
	}
}

func dynamicFieldShape(carrier *types.Struct, path string, visited map[types.Type]bool) string {
	for field := range carrier.Fields() {
		if !field.Exported() && !field.Embedded() {
			continue
		}

		if found := dynamicShape(field.Type(), path+"."+field.Name(), visited); found != "" {
			return found
		}
	}

	return ""
}

// declarationFile rend le fichier où `carrier` est déclaré, et "" pour un type qui n'en a pas — un
// struct anonyme, un `[]byte`. Un fichier vide n'est jamais celui du code engendré : la comparaison
// qui s'en sert échoue alors du bon côté.
func declarationFile(pkg *packages.Package, carrier types.Type) string {
	named, ok := types.Unalias(carrier).(*types.Named)
	if !ok {
		return ""
	}

	return pkg.Fset.Position(named.Obj().Pos()).Filename
}

// Un type de réponse ne porte que des formes déclarées, et n'embarque que ce que le contrat engendre.
//
// La **forme** d'abord : ni map ni `any`, à n'importe quelle profondeur — c'est l'invariant (a) tenu
// par le compilateur plutôt que par la discipline. Rien n'oblige en revanche le type lui-même à être
// un struct : oapi-codegen rend `type XxxResponse []Foo` pour une réponse tableau et
// `type XxxTextResponse string` pour du `text/plain` (`strict-interface.tmpl:50`), deux formes
// parfaitement bornées qu'une exigence de struct refuserait.
//
// L'**embarquement** ensuite, et la règle y est plus fine pour une raison mesurée : dès qu'une
// réponse est un `$ref` vers `components/responses/*`, le gabarit rend
// `type Xxx400JSONResponse struct{ ErrorJSONResponse }` (`strict-interface.tmpl:47`) — la forme
// normale d'un DTO d'erreur factorisé, que refuser obligerait à dé-factoriser le contrat. Ce qui reste
// interdit est d'embarquer un type que le générateur n'a **pas** écrit : celui-là fuirait demain, en
// silence, les champs qu'on lui ajoute ailleurs, et personne ne relit les types de réponse d'un
// paquet quand il ajoute un champ à un type de domaine.
//
// La population n'est pas « les types dont le nom contient Response » mais « les types qui
// implémentent une interface engendrée » — une définition que le code engendré porte déjà, et
// qu'aucun commentaire ne peut rendre vraie par accident.
func TestResponseTypesDeclareTheirFields(t *testing.T) {
	t.Parallel()

	pkg := loadBFF(t)
	scope := pkg.Types.Scope()

	ifaces := responseInterfaces(scope)
	require.NotEmpty(t, ifaces, "aucune interface %q : l'analyseur est cassé, pas vert", responseObjectSuffix)

	contract := scope.Lookup(contractInterfaceName)
	require.NotNil(t, contract, "%s introuvable : « fichier engendré » n'a plus de définition", contractInterfaceName)
	generated := pkg.Fset.Position(contract.Pos()).Filename

	population := 0

	for _, name := range scope.Names() {
		declared, ok := scope.Lookup(name).(*types.TypeName)
		if !ok || !implementsAny(declared.Type(), ifaces) {
			continue
		}

		// Une interface `…ResponseObject` s'implémente elle-même. Elle déclare la population, elle
		// n'en fait pas partie — c'est le type concret qu'un handler rend qui doit porter des champs.
		if _, isInterface := declared.Type().Underlying().(*types.Interface); isInterface {
			continue
		}

		population++

		assert.Emptyf(t, dynamicShape(declared.Type(), name, map[types.Type]bool{}),
			"%s est un type de réponse : ce qu'il porte doit être déclaré, sans quoi l'invariant (a) "+
				"redevient une discipline", name)

		assertEmbedsOnlyGeneratedTypes(t, pkg, name, declared.Type(), generated)
	}

	require.Positivef(t, population,
		"aucun type n'implémente une interface %q : l'analyseur est cassé, pas vert", responseObjectSuffix)
}

func assertEmbedsOnlyGeneratedTypes(
	t *testing.T, pkg *packages.Package, name string, carrier types.Type, generated string,
) {
	t.Helper()

	structured, ok := carrier.Underlying().(*types.Struct)
	if !ok {
		return
	}

	for field := range structured.Fields() {
		if !field.Embedded() {
			continue
		}

		assert.Equalf(t, generated, declarationFile(pkg, field.Type()),
			"%s embarque %s, que le contrat n'engendre pas : les champs ajoutés à ce type-là fuiraient "+
				"sans relecture", name, field.Name())
	}
}
