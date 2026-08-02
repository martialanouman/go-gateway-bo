package permissions_test

import (
	"regexp"
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
)

// Le front Go↔SQL — les onze catégories d'ici contre le `CHECK` sur `permissions.category` — est
// tenu par `internal/store/permissions_catalog_test.go`, et non ici. Il y a d'abord vécu sous la
// forme d'un `os.ReadFile` de la migration et d'une expression rationnelle sur son texte ; mesuré le
// 02/08/2026, la contrainte mise en commentaire d'historique laissait les deux cas **verts**. Un
// détecteur textuel n'a aucune notion de commentaire SQL, et ne voit pas non plus un `ALTER` posé
// par une migration ultérieure. Le remplaçant observe la contrainte que PostgreSQL applique, où ces
// deux angles n'existent plus — au prix du conteneur que `internal/store` monte déjà.

// `catalog` est un `var` de package : sans la copie de `All()`, chaque appelant recevrait la tranche
// elle-même, et écrire dedans réécrirait le catalogue **pour tout le process**. Le scénario n'est pas
// théorique : l'écran d'édition de rôle (step-027) trie et filtre ce qu'on lui donne, et
// `RequirePermission` (step-025) lirait ensuite un catalogue réordonné sans qu'aucun log ne le dise.
//
// Ce cas existe parce que la propriété n'était tenue par rien : mesuré le 02/08/2026, remplacer
// `slices.Clone(catalog)` par `return catalog` laissait `internal/permissions` et
// `cmd/permissionsgen` verts et `golangci-lint` à 0 issue — la couverture était pourtant à 100 %,
// mais c'est une couverture d'instructions, et aucun cas n'écrivait dans la tranche rendue.
// L'entrée témoin est copiée **par valeur** (`Entry` n'a que des champs valeur), et non gardée sous
// la forme d'une tranche : une première version de ce cas comparait `permissions.All()` d'avant à
// celui d'après et restait verte défaut posé, les deux « tranches » étant la même quand `All()` rend
// le catalogue lui-même.
func TestAllHandsOutACopyAndNotTheCatalogItself(t *testing.T) {
	handed := permissions.All()
	require.NotEmpty(t, handed)

	witness := handed[0]
	handed[0] = permissions.Entry{Key: "saccage:tout", Category: "saccage", Description: "saccage"}

	assert.Equal(t, witness, permissions.All()[0],
		"écrire dans ce que rend All() a modifié le catalogue : la tranche de package a été rendue "+
			"telle quelle")
}

// `Categories` est ce dont le TypeScript engendré tire son union `PermissionCategory` : une
// catégorie qui en manquerait donnerait au client un type qui refuse une valeur légitime.
func TestCategoriesListsExactlyWhatTheKeysCarry(t *testing.T) {
	var expected []permissions.Category
	for _, entry := range permissions.All() {
		if !slices.Contains(expected, entry.Category) {
			expected = append(expected, entry.Category)
		}
	}

	assert.Equal(t, expected, permissions.Categories())
}

// La forme admise : un domaine sans underscore, puis **un ou plusieurs** segments d'action où
// l'underscore est admis. La forme naïve `domaine:action` serait fausse — quatre clés légitimes du
// catalogue ne la satisfont pas, et le test suivant les nomme.
//
// Ce que la règle refuse, mesuré et non supposé : la majuscule, le tiret, l'underscore au domaine,
// le segment vide, et le chiffre **où qu'il soit**. Le cas suivant les nomme un à un.
//
// L'expression a été resserrée après coup. DN-2 l'arrêtait à `^[a-z][a-z0-9]*(:[a-z][a-z0-9_]*)+$`
// tout en affirmant qu'elle refusait le chiffre : elle ne le refusait qu'en tête de segment, et
// `routes2:read` la satisfaisait. Plutôt qu'affaiblir l'affirmation, c'est la règle qui a bougé —
// les 44 clés passent la version stricte, vérifié sur les trois formulations avant de choisir.
var keyShape = regexp.MustCompile(`^[a-z]+(:[a-z][a-z_]*)+$`)

func TestEveryKeyFollowsTheAdmittedShape(t *testing.T) {
	for _, entry := range permissions.All() {
		assert.Truef(t, keyShape.MatchString(string(entry.Key)),
			"la clé %q ne suit pas la forme %s", entry.Key, keyShape)
	}
}

// Une clé en double ne se voit pas à la relecture d'une liste de 44 entrées, et la table
// `permissions` en ferait un échec de clé primaire au seed de step-020 — chez quelqu'un qui n'aura
// plus ce contexte.
func TestNoKeyIsDeclaredTwice(t *testing.T) {
	seen := make(map[permissions.Key]string, len(permissions.All()))

	for _, entry := range permissions.All() {
		if first, duplicate := seen[entry.Key]; duplicate {
			assert.Failf(t, "clé en double",
				"la clé %q est déclarée deux fois — d'abord en catégorie %q", entry.Key, first)

			continue
		}

		seen[entry.Key] = string(entry.Category)
	}
}

// Les quatre clés que la forme naïve rejetterait. Elles sont nommées une à une parce qu'une règle
// resserrée à `domaine:action` passerait la suite en refusant du légitime, et que rien d'autre ne
// le dirait.
func TestTheAtypicalKeysAreAdmitted(t *testing.T) {
	atypical := []permissions.Key{
		permissions.BillingProviderWrite,
		permissions.BillingScopeChange,
		permissions.CDRReadPII,
		permissions.CDRExportBulk,
	}

	for _, key := range atypical {
		assert.Truef(t, keyShape.MatchString(string(key)),
			"la clé atypique %q est refusée par la forme %s", key, keyShape)
	}
}

// Sans ce cas, une expression trop permissive — `.*` en est la limite — resterait verte sur les 44
// clés et ne garderait rien.
func TestTheShapeRejectsWhatNoKeyCarries(t *testing.T) {
	rejected := []string{
		"routes",              // pas de segment d'action
		"routes:",             // segment d'action vide
		":read",               // pas de domaine
		"Routes:read",         // majuscule
		"routes:read-all",     // tiret
		"sender_rewrite:read", // underscore au domaine
		"routes:1read",        // chiffre en tête de segment
		"routes2:read",        // chiffre au domaine
		"routes:read2",        // chiffre à l'action
	}

	for _, candidate := range rejected {
		assert.Falsef(t, keyShape.MatchString(candidate),
			"la forme %s accepte %q, qu'aucune clé ne porte", keyShape, candidate)
	}
}

// La description est ce que l'écran d'édition de rôle affiche tel quel (step-027). Une entrée sans
// description y produirait une case à cocher muette, dont personne ne peut dire ce qu'elle accorde.
func TestEveryEntryCarriesADescription(t *testing.T) {
	for _, entry := range permissions.All() {
		assert.NotEmptyf(t, entry.Description, "la clé %q n'a pas de description", entry.Key)
	}
}
