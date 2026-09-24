package store_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Une base d'avant le renommage porte les neuf rôles par défaut sous leurs anciens identifiants. La
// migration les renomme en place : les détenteurs gardent leurs rôles, et le seed qui suit retrouve
// ses noms au lieu de créer neuf rôles vides à côté de neuf rôles orphelins.
func TestLaMigrationRenommeLesRolesParDefautSansPerdreLeursDetenteurs(t *testing.T) {
	t.Parallel()

	pool, dsn := migratedPool(t)
	ctx := t.Context()
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	_, err := pool.Exec(ctx, `
		WITH created AS (
		    INSERT INTO roles (name, description, is_default)
		    SELECT unnest($1::text[]), '', true
		    RETURNING id, name
		)
		INSERT INTO operator_roles (operator_id, role_id)
		SELECT $2::uuid, id FROM created WHERE name = 'auditor'`,
		[]string{
			"super_admin", "ops", "script_author", "support_readonly", "billing_admin",
			"billing_readonly", "account_manager", "compliance", "auditor",
		}, operator)
	require.NoError(t, err)

	_, err = pool.Exec(ctx, `DELETE FROM goose_db_version WHERE version_id = 10`)
	require.NoError(t, err)

	_, err = store.Migrate(ctx, dsn)
	require.NoError(t, err)

	var names []string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT array_agg(name ORDER BY name) FROM roles WHERE is_default`).Scan(&names))
	assert.ElementsMatch(t, []string{
		"Propriétaire", "Exploitation", "Scripts", "Support", "Finance",
		"Reporting", "Clientèle", "Conformité", "Audit",
	}, names)

	var held string
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT r.name FROM operator_roles orl JOIN roles r ON r.id = orl.role_id
		WHERE orl.operator_id = $1::uuid`, operator).Scan(&held))
	assert.Equal(t, "Audit", held, "le détenteur a perdu son rôle au renommage")
}
