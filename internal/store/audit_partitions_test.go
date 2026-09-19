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

// **Un échec ne termine pas la boucle**, et c'est la moitié qui comptait le moins jusqu'ici : le test
// d'au-dessus n'observe qu'un passage, donc un `return` posé après le rapport le laissait vert.
//
// Ce qu'un abandon coûterait : la base est momentanément injoignable — bascule du primaire, pool
// saturé, redémarrage de PostgreSQL —, la boucle rend la main, et plus rien ne recrée les partitions.
// La panne ne se voit alors qu'au premier du mois suivant, sur une écriture d'audit refusée, donc sur
// l'action métier qui partage sa transaction.
//
// **La panne est fabriquée en renommant la fonction SQL** plutôt qu'en coupant le serveur : elle est
// locale à la base de ce cas, réversible à la milliseconde, et elle échoue là où
// `EnsureAuditPartitions` appelle — pas dans le pool, qui pourrait avoir ses propres reprises.
func TestUnEchecNArretePasLeRenouvellementDesPartitions(t *testing.T) {
	t.Parallel()

	pool, _ := migratedPool(t)
	removeAuditPartitions(t, pool)

	_, err := pool.Exec(t.Context(),
		"ALTER FUNCTION ensure_audit_log_partitions(timestamptz) RENAME TO hidden_partitions")
	require.NoError(t, err, "cacher la fonction SQL : sans panne à traverser, ce cas n'observe rien")

	ctx, stop := context.WithCancel(t.Context())
	defer stop()

	// Tamponné : la boucle ne doit pas se bloquer sur un rapport que personne ne lit, et un canal
	// synchrone ferait dépendre ce cas de l'ordre d'exécution plutôt que du comportement.
	reports := make(chan error, 64)

	go store.KeepAuditPartitions(ctx, pool, 10*time.Millisecond, func(err error) {
		select {
		case reports <- err:
		default:
		}
	})

	select {
	case reported := <-reports:
		require.Error(t, reported, "la boucle rapporte une réussite alors que la fonction n'existe pas")
	case <-time.After(5 * time.Second):
		t.Fatal("la boucle n'a rien rapporté : l'échec est avalé, et une panne durable serait muette")
	}

	_, err = pool.Exec(t.Context(),
		"ALTER FUNCTION hidden_partitions(timestamptz) RENAME TO ensure_audit_log_partitions")
	require.NoError(t, err)

	assert.Eventually(t, func() bool { return auditPartitionCount(t, pool) == 2 },
		5*time.Second, 20*time.Millisecond,
		"la boucle n'a pas repassé après l'échec : une base momentanément injoignable la termine, "+
			"et plus rien ne crée les partitions du mois suivant")
}
