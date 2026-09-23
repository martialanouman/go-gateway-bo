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

// Réinitialiser, c'est retirer **tout** ce qui franchit le second facteur : un code de récupération ou
// une passkey survivants suffiraient à celui qui a volé le téléphone et la feuille de codes. Le verrou
// d'essais est levé avec, sans quoi le titulaire ne pourrait pas se réenrôler.
func TestLaReinitialisationNeLaisseAucunFacteurNiVerrou(t *testing.T) {
	t.Parallel()

	pool, dsn := migratedPool(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	registerPasskey(t, store.NewWebauthn(pool), operator, "cle")

	ctx := t.Context()

	_, err := pool.Exec(ctx, `
		WITH secret AS (UPDATE operators SET mfa_totp_secret = 'scelle', mfa_totp_last_step = 1 WHERE id = $1),
		     codes AS (INSERT INTO mfa_recovery_codes (operator_id, code_hash) VALUES ($1, 'h'))
		INSERT INTO login_attempt_counters (scope, subject, failures, last_failure_at)
		VALUES ('mfa', $1::text, 5, now())`, operator)
	require.NoError(t, err)

	require.NoError(t, store.NewAdministration(pool).ResetSecondFactors(ctx, operator,
		store.Event{Action: "mfa.reset"}))

	var survivors int

	require.NoError(t, pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM operators WHERE id = $1 AND mfa_totp_secret IS NOT NULL)
		     + (SELECT count(*) FROM mfa_recovery_codes WHERE operator_id = $1)
		     + (SELECT count(*) FROM webauthn_credentials WHERE operator_id = $1)
		     + (SELECT count(*) FROM login_attempt_counters WHERE scope = 'mfa' AND subject = $1::text)`,
		operator).Scan(&survivors))

	assert.Zero(t, survivors, "la réinitialisation laisse un facteur ou un verrou derrière elle")
}
