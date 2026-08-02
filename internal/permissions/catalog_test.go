package permissions_test

import (
	"os"
	"regexp"
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
)

// Les onze catégories vivent à trois endroits : ce package, le TypeScript qu'il engendre, et le
// `CHECK (category IN (…))` de la migration. `check-generated` tient le front Go↔TS ; ces deux cas
// sont tout ce qui tient le front Go↔SQL. Sans eux, une catégorie mal orthographiée en Go passe
// toutes les portes et n'échoue qu'à l'`INSERT` du seed, en step-020.
//
// **Mise à jour, le jour d'une douzième catégorie.** Elle arrivera par une **nouvelle** migration
// qui `ALTER` la contrainte, et ce cas, qui ne lit que `00001`, mentira. Ce qu'il faudra faire est
// lire la **dernière** définition de la contrainte — jamais élargir une liste en dur écrite ici.
//
// **Le fichier est lu sur le disque et non par `//go:embed`**, contre l'intention initiale du
// design. Mesuré le 02/08/2026 : `//go:embed ../store/migrations/00001_…sql` ne compile pas —
// `pattern ../store/migrations/00001_operators_roles_permissions.sql: invalid pattern syntax`. Un
// motif `go:embed` ne remonte pas au-dessus de son répertoire, et l'`embed.FS` de `internal/store`
// est privé (`migrationsFS`, `internal/store/migrations.go`). Le chemin relatif tient parce que
// `go test` lance le binaire de test dans le répertoire du package — et si un jour ce n'était plus
// vrai, `require.NoError` sur la lecture le dirait immédiatement.
const migrationPath = "../store/migrations/00001_operators_roles_permissions.sql"

var (
	categoryCheck   = regexp.MustCompile(`(?s)CHECK\s*\(category IN \((.*?)\)\)`)
	quotedSQLString = regexp.MustCompile(`'([^']*)'`)
)

// categoriesAllowedBySQL rend les catégories que la contrainte accepte, dans son ordre.
func categoriesAllowedBySQL(t *testing.T) []permissions.Category {
	t.Helper()

	migration, err := os.ReadFile(migrationPath)
	require.NoError(t, err)

	constraints := categoryCheck.FindAllStringSubmatch(string(migration), -1)
	// Une seule contrainte porte sur `category`. Zéro voudrait dire que la migration a changé de
	// forme et que la comparaison ne compare plus rien ; deux, qu'on ne sait plus laquelle fait foi.
	require.Len(t, constraints, 1, "le CHECK sur `category` n'a pas été reconnu dans %s", migrationPath)

	var allowed []permissions.Category
	for _, literal := range quotedSQLString.FindAllStringSubmatch(constraints[0][1], -1) {
		allowed = append(allowed, permissions.Category(literal[1]))
	}

	require.NotEmpty(t, allowed)

	return allowed
}

func TestEveryCatalogCategoryIsAcceptedBySQL(t *testing.T) {
	allowed := categoriesAllowedBySQL(t)

	for _, entry := range permissions.All() {
		assert.Containsf(t, allowed, entry.Category,
			"la clé %q porte la catégorie %q, que le CHECK de %s refuse",
			entry.Key, entry.Category, migrationPath)
	}
}

// Le sens inverse n'est pas décoratif : en v1.0, `connectors` a existé dans l'enum PostgreSQL sans
// qu'aucune clé ne s'y rattache, et l'écran d'édition de rôle présentait une famille vide.
func TestEveryCategoryAcceptedBySQLCarriesAtLeastOneKey(t *testing.T) {
	carried := make(map[permissions.Category]int)
	for _, entry := range permissions.All() {
		carried[entry.Category]++
	}

	for _, category := range categoriesAllowedBySQL(t) {
		assert.Positivef(t, carried[category],
			"la catégorie %q est acceptée par le CHECK de %s et aucune clé ne s'y rattache",
			category, migrationPath)
	}
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
