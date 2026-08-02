package store_test

import (
	"context"
	"regexp"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
)

// Les onze catégories vivent à trois endroits : `internal/permissions`, le TypeScript qu'il
// engendre, et le `CHECK` sur `permissions.category`. `check-generated` tient le front Go↔TS ; ces
// deux cas sont tout ce qui tient le front Go↔SQL. Sans eux, une catégorie mal orthographiée en Go
// passe toutes les portes et n'échoue qu'à l'`INSERT` du seed, en step-020.
//
// # Pourquoi ces cas vivent ici et non dans `internal/permissions`
//
// Ils y ont d'abord vécu, sous la forme d'un `os.ReadFile` de la migration `00001` et d'une
// expression rationnelle sur son texte. Mesuré le 02/08/2026 : la contrainte mise en commentaire
// d'historique — `-- CHECK (category IN (` — laissait les **deux** cas verts, parce que ni
// `os.ReadFile` ni `regexp` n'ont de notion de commentaire SQL. Ils affirmaient tenir un front qui
// n'existait plus en base. Le même angle mort couvrait un `ALTER … DROP CONSTRAINT` posé par une
// migration ultérieure, que la lecture de `00001` seule ne peut pas voir.
//
// Ici, la contrainte est **celle que PostgreSQL applique** après les trois migrations : un
// commentaire n'en fait plus partie, et un `ALTER` d'une future `00004` s'y voit — vérifié en posant
// une `00004` qui `DROP` la contrainte, que la lecture de `00001` seule laissait verte. Le prix est
// un conteneur, que ce package paie déjà pour toutes ses suites : mesuré le 02/08/2026, la suite
// passe de 13,3 s à 14,3 s, soit deux bases neuves et leurs migrations.
//
// # Ce qui est observé et ce qui est lu
//
// Le sens Go → SQL est **observé** : une ligne par catégorie est réellement insérée, et le refus —
// ou son absence — est ce que le test regarde, comme le reste de `constraints_test.go`.
//
// Le sens inverse ne peut pas l'être : « la contrainte accepte-t-elle une valeur qu'aucune clé ne
// porte ? » porte sur un ensemble infini de chaînes candidates, et aucune sonde ne l'épuise. Il faut
// donc énumérer ce que la contrainte accepte, et `pg_get_constraintdef` est la seule façon de le
// demander. C'est du texte, mais du texte **rendu par l'analyseur** : mesuré le 02/08/2026 sur
// `postgres:18-alpine`, le `IN (…)` de la migration y ressort normalisé en
// `CHECK ((category = ANY (ARRAY['routing'::text, …])))`.
var checkedLiteral = regexp.MustCompile(`'([^']*)'::text`)

// categoriesAllowedBySQL rend les catégories que la contrainte appliquée accepte.
func categoriesAllowedBySQL(ctx context.Context, t *testing.T, conn *pgx.Conn) []permissions.Category {
	t.Helper()

	// La contrainte est retrouvée par la **colonne** qu'elle porte, jamais par son nom : un
	// `permissions_category_check` codé en dur ferait d'un renommage un faux rouge, et d'un `ALTER`
	// qui repose la contrainte sous un autre nom un faux vert.
	rows, err := conn.Query(ctx, `
		SELECT pg_get_constraintdef(c.oid)
		FROM pg_constraint c
		JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
		WHERE c.conrelid = 'permissions'::regclass
			AND c.contype = 'c'
			AND a.attname = 'category'`)
	require.NoError(t, err, "interroger pg_constraint")

	defer rows.Close()

	var definitions []string

	for rows.Next() {
		var definition string

		require.NoError(t, rows.Scan(&definition))

		definitions = append(definitions, definition)
	}

	require.NoError(t, rows.Err())

	// Zéro voudrait dire que plus rien ne contraint `category` en base — le cas que la lecture du
	// fichier laissait passer. Deux, qu'on ne sait plus laquelle fait foi.
	require.Lenf(t, definitions, 1,
		"une seule contrainte doit porter sur `permissions.category` ; PostgreSQL en applique %d",
		len(definitions))

	var allowed []permissions.Category
	for _, literal := range checkedLiteral.FindAllStringSubmatch(definitions[0], -1) {
		allowed = append(allowed, permissions.Category(literal[1]))
	}

	require.NotEmptyf(t, allowed, "la contrainte appliquée n'énumère aucune catégorie : %s",
		definitions[0])

	return allowed
}

func TestEveryCatalogCategoryIsAcceptedBySQL(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	tx := seededTransaction(ctx, t, migratedDatabase(ctx, t))

	for _, category := range permissions.Categories() {
		// Un point de reprise par sonde, et non un seul `INSERT` après l'autre : un `INSERT` refusé
		// **avorte la transaction**, et les sondes suivantes échoueraient toutes sur
		// `current transaction is aborted`. Mesuré le 02/08/2026 en retirant `'compliance'` de la
		// liste : sans le point de reprise, le test nommait aussi `alerts` et `audit` comme refusées
		// alors que la contrainte les accepte.
		probe, err := tx.Begin(ctx)
		require.NoError(t, err, "ouvrir le point de reprise de la sonde")

		_, err = probe.Exec(ctx,
			`INSERT INTO permissions (key, category, description) VALUES ($1, $2, $3)`,
			"probe:"+string(category), string(category), "sonde")

		assert.NoErrorf(t, err,
			"le catalogue Go porte la catégorie %q, que la contrainte appliquée refuse", category)

		require.NoError(t, probe.Rollback(ctx), "annuler le point de reprise de la sonde")
	}
}

// Le sens inverse n'est pas décoratif : en v1.0, `connectors` a existé côté PostgreSQL sans qu'aucune
// clé ne s'y rattache, et l'écran d'édition de rôle présentait une famille vide.
func TestEveryCategoryAcceptedBySQLCarriesAtLeastOneKey(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	conn := migratedDatabase(ctx, t)

	carried := make(map[permissions.Category]int)
	for _, entry := range permissions.All() {
		carried[entry.Category]++
	}

	for _, category := range categoriesAllowedBySQL(ctx, t, conn) {
		assert.Positivef(t, carried[category],
			"la contrainte appliquée accepte la catégorie %q et aucune clé du catalogue Go ne s'y "+
				"rattache", category)
	}
}
