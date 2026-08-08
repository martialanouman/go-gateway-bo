package store_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Le cas qu'aucun scénario ne met en scène parce qu'il ne se produit qu'entre deux releases : un
// rôle marqué `is_default` en base que le code ne décrit plus — une release qui retire un rôle par
// défaut, ou une base semée par une version antérieure.
//
// Le seed le **signale et le laisse en l'état**, comme il fait d'une clé disparue du catalogue. Sans
// la garde `EXISTS (… wanted …)` de la révocation, il le dépouillerait de toutes ses attributions en
// silence : le rôle survivrait, vide, et les opérateurs qui le détiennent perdraient tout accès sans
// qu'aucune ligne d'audit ne dise pourquoi.
func TestUnRoleParDefautDisparuDuCodeEstSignaleSansEtreDepouille(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	dsn := migratedDatabaseDSN(ctx, t)

	_, err := store.Seed(ctx, dsn)
	require.NoError(t, err)

	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	const legacyRole = "night_ops"

	_, err = conn.Exec(ctx,
		"INSERT INTO roles (name, description, is_default) VALUES ($1, 'rôle d’une release "+
			"précédente', true)", legacyRole)
	require.NoError(t, err)

	_, err = conn.Exec(ctx,
		"INSERT INTO role_permissions (role_id, permission_key) "+
			"SELECT id, 'sessions:read' FROM roles WHERE name = $1", legacyRole)
	require.NoError(t, err)

	outcome, err := store.Seed(ctx, dsn)
	require.NoError(t, err)

	assert.Contains(t, outcome.UnknownRoles, legacyRole,
		"un rôle par défaut que le code ne décrit plus n'est pas signalé")
	assert.True(t, outcome.Diverges())

	for _, revoked := range outcome.GrantsRevoked {
		assert.NotEqual(t, legacyRole, revoked.Role,
			"le seed a révoqué une attribution d'un rôle qu'il vient de déclarer inconnu : deux "+
				"traitements contraires du même cas")
	}

	var stillGranted bool

	require.NoError(t, conn.QueryRow(ctx,
		"SELECT EXISTS (SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id "+
			"WHERE r.name = $1)", legacyRole).Scan(&stillGranted))
	assert.True(t, stillGranted, "le rôle inconnu a été vidé de ses attributions")
}
