package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// removeAuditPartitions retire les partitions que la migration vient de poser, plaçant la base dans
// l'état où elle sera le mois où plus personne ne les renouvelle.
func removeAuditPartitions(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()

	const partitions = `
		SELECT child.relname
		FROM pg_inherits
		JOIN pg_class AS parent ON parent.oid = pg_inherits.inhparent
		JOIN pg_class AS child ON child.oid = pg_inherits.inhrelid
		WHERE parent.relname = 'audit_log'`

	rows, err := pool.Query(t.Context(), partitions)
	require.NoError(t, err)

	var names []string

	for rows.Next() {
		var name string

		require.NoError(t, rows.Scan(&name))

		names = append(names, name)
	}

	rows.Close()
	require.NoError(t, rows.Err())
	require.NotEmpty(t, names, "aucune partition à retirer : ce cas n'exercerait rien")

	for _, name := range names {
		// Le nom vient du catalogue de cette base, jamais d'une donnée reçue.
		_, err = pool.Exec(t.Context(), "DROP TABLE "+name)
		require.NoError(t, err)
	}
}

func auditPartitionCount(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()

	var count int

	require.NoError(t, pool.QueryRow(t.Context(), `
		SELECT count(*) FROM pg_inherits
		JOIN pg_class AS parent ON parent.oid = pg_inherits.inhparent
		WHERE parent.relname = 'audit_log'`).Scan(&count))

	return count
}

func TestLesPartitionsDAuditSeRecreentQuandEllesManquent(t *testing.T) {
	t.Parallel()

	pool, _ := migratedPool(t)
	removeAuditPartitions(t, pool)
	require.Zero(t, auditPartitionCount(t, pool))

	require.NoError(t, store.EnsureAuditPartitions(t.Context(), pool))
	assert.Equal(t, 2, auditPartitionCount(t, pool),
		"le mois courant et le suivant : c'est la fenêtre que la fonction SQL entretient")
}

// Le renouvellement est ce qui couvre un process qui tourne plus d'un mois. Sans lui, l'appel de
// démarrage suffirait tant qu'on redéploie — c'est-à-dire jusqu'au jour où l'on cesse, qui est
// précisément celui où un produit devient stable.
//
// L'intervalle est un argument et non une constante, pour que ce cas puisse l'exercer : le mesurer à
// vingt-quatre heures demanderait d'attendre autant, et le figer rendrait la boucle intestable
// autrement qu'en la relisant.
func TestLeRenouvellementDesPartitionsRepasseEtSArreteAvecSonContexte(t *testing.T) {
	t.Parallel()

	pool, _ := migratedPool(t)
	removeAuditPartitions(t, pool)

	ctx, stop := context.WithCancel(t.Context())
	done := make(chan struct{})

	go func() {
		defer close(done)
		store.KeepAuditPartitions(ctx, pool, 10*time.Millisecond, func(error) {})
	}()

	require.Eventually(t, func() bool { return auditPartitionCount(t, pool) == 2 },
		5*time.Second, 20*time.Millisecond,
		"la boucle n'a pas recréé les partitions : un process qui traverse un changement de mois "+
			"resterait sans partition pour le mois suivant")

	stop()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("la boucle ne s'arrête pas avec son contexte : elle survivrait à l'arrêt du serveur")
	}
}
