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
func implementsAny(candidate types.Type, ifaces []*types.Interface) bool {
	for _, iface := range ifaces {
		if types.Implements(candidate, iface) || types.Implements(types.NewPointer(candidate), iface) {
			return true
		}
	}

	return false
}

// Les types de réponse sont des structs déclarés, jamais une `map[string]any` ni un struct qui en
// embarque un autre. Le premier laisserait écrire n'importe quelle clé — c'est l'invariant (a) rendu
// à la discipline. Le second ferait fuir demain, en silence, les champs ajoutés au type embarqué :
// personne ne relit les types de réponse d'un paquet quand il ajoute un champ ailleurs.
//
// La population n'est pas « les types dont le nom contient Response » mais « les types qui
// implémentent une interface engendrée » — une définition que le code engendré porte déjà, et
// qu'aucun commentaire ne peut rendre vraie par accident.
func TestResponseTypesDeclareTheirFields(t *testing.T) {
	t.Parallel()

	scope := loadBFF(t).Types.Scope()
	ifaces := responseInterfaces(scope)
	require.NotEmpty(t, ifaces, "aucune interface %q : l'analyseur est cassé, pas vert", responseObjectSuffix)

	population := 0

	for _, name := range scope.Names() {
		declared, ok := scope.Lookup(name).(*types.TypeName)
		if !ok || !implementsAny(declared.Type(), ifaces) {
			continue
		}

		underlying := declared.Type().Underlying()

		// Une interface `…ResponseObject` s'implémente elle-même. Elle déclare la population, elle
		// n'en fait pas partie — c'est le type concret qu'un handler rend qui doit porter des champs.
		if _, isInterface := underlying.(*types.Interface); isInterface {
			continue
		}

		population++
		assert.IsTypef(t, (*types.Struct)(nil), underlying,
			"%s est un type de réponse : son sous-jacent doit être un struct déclaré, pas %s", name, underlying)

		structured, ok := underlying.(*types.Struct)
		if !ok {
			continue
		}

		for field := range structured.Fields() {
			assert.Falsef(t, field.Embedded(),
				"%s embarque %s : les champs ajoutés au type embarqué fuiraient sans relecture", name, field.Name())
		}
	}

	require.Positivef(t, population,
		"aucun type n'implémente une interface %q : l'analyseur est cassé, pas vert", responseObjectSuffix)
}
