package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Un rôle supprimé pendant qu'on l'attribue n'est pas une panne : l'attribution attend le verrou du
// rôle, puis trouve la clé étrangère rompue — c'est « l'un des rôles désignés n'existe plus ». Le décor
// tient la suppression ouverte, et l'attente est observée dans `pg_locks` plutôt que temporisée.
func TestUnRoleSupprimePendantSonAttributionEstUneReferenceInconnue(t *testing.T) {
	t.Parallel()

	pool, dsn := migratedPool(t)
	admin := store.NewAdministration(pool)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	ctx := t.Context()

	decor, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)

	defer func() { _ = decor.Close(context.WithoutCancel(ctx)) }()

	var role string

	require.NoError(t, decor.QueryRow(ctx,
		`INSERT INTO roles (name, description) VALUES ('astreinte', '') RETURNING id::text`).Scan(&role))

	held, err := decor.Begin(ctx)
	require.NoError(t, err)

	_, err = held.Exec(ctx, `DELETE FROM roles WHERE id = $1::uuid`, role)
	require.NoError(t, err)

	outcome := make(chan error, 1)

	go func() {
		_, setErr := admin.SetOperatorRoles(context.WithoutCancel(ctx), "", operator, []string{role},
			store.Event{Action: "operator.assign_roles"})
		outcome <- setErr
	}()

	require.Eventually(t, func() bool {
		var waiting int
		require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM pg_locks WHERE NOT granted`).Scan(&waiting))

		return waiting > 0
	}, 5*time.Second, 20*time.Millisecond, "l'attribution n'a jamais attendu : la séquence n'exerce pas la course")

	require.NoError(t, held.Commit(ctx))

	assert.ErrorIs(t, <-outcome, store.ErrUnknownReference,
		"la clé étrangère rompue remonte en panne au lieu de dire que le rôle n'existe plus")
}
