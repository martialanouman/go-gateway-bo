package permissions

import "slices"

// Key est une clé de permission. Les valeurs admises sont les constantes de `catalog.go`, et elles
// seules.
type Key string

// Category est la famille dont relève une clé. Les valeurs admises sont exactement celles que le
// `CHECK` sur `permissions.category` accepte — `internal/store/permissions_catalog_test.go` compare
// les deux ensembles dans les deux sens contre la contrainte **appliquée** par PostgreSQL, parce que
// rien d'autre ne tient ce front.
type Category string

// Entry est une entrée du catalogue : ce qu'un rôle accorde, et ce qu'on en dit à l'écran.
type Entry struct {
	Key         Key
	Category    Category
	Description string
}

// All rend le catalogue, dans l'ordre où l'écran d'édition de rôle le présente.
//
// La copie n'est pas une précaution de style : le catalogue est un `var` de package, donc un
// appelant qui recevrait la tranche elle-même pourrait réécrire une entrée pour tout le process, y
// compris les gardes. `Entry` n'a que des champs valeur, donc la copie est complète.
func All() []Entry {
	return slices.Clone(catalog)
}

// Categories rend les familles dans leur ordre de première apparition au catalogue — c'est-à-dire
// l'ordre d'affichage. Elle est **dérivée** des clés plutôt que déclarée à part : une liste écrite
// en second pourrait nommer une famille que plus aucune clé ne porte.
func Categories() []Category {
	var ordered []Category

	for _, entry := range catalog {
		if !slices.Contains(ordered, entry.Category) {
			ordered = append(ordered, entry.Category)
		}
	}

	return ordered
}
