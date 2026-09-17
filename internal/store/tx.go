package store

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// inTx tient une action et son audit dans la même transaction : ou les deux, ou aucun.
//
// Le rollback différé est posé avant la première écriture et survit à un contexte annulé —
// `context.WithoutCancel` — sans quoi une requête abandonnée laisserait la transaction ouverte
// jusqu'à son expiration côté serveur.
func inTx(ctx context.Context, pool *pgxpool.Pool, do func(tx pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("ouvrir la transaction : %w", err)
	}

	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err = do(tx); err != nil {
		return err
	}

	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("valider la transaction : %w", err)
	}

	return nil
}
