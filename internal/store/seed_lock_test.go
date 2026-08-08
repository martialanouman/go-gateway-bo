package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Deux `bootstrap` qui se croisent sur une base pas encore semée : un pas de déploiement relancé
// pendant que le premier tourne suffit. Sans verrou, les deux transactions voient la même clé
// absente, l'insèrent, et la seconde échoue sur `permissions_pkey` une fois la première validée —
// une livraison arrêtée par le cas le plus fréquent, la première installation. C'est exactement la
// raison pour laquelle `Migrate` prend déjà un verrou de session (step-005, DN-1).
//
// **Le verrou s'observe dans `pg_locks`, jamais en lançant deux goroutines** : deux `Seed`
// concurrents passent la plupart du temps sans se croiser, et le test vert dirait alors « ils ne se
// sont pas rencontrés » plutôt que « le verrou tient ». Ici, une transaction de contrôle prend le
// verrou d'abord et ne le rend qu'à la fin : `Seed` doit attendre, ce qui est un fait binaire.
func TestUnSecondSeedAttendLePremierPlutotQueDEchouer(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	dsn := migratedDatabaseDSN(ctx, t)

	holder, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)

	defer func() { _ = holder.Close(context.WithoutCancel(ctx)) }()

	held, err := holder.Begin(ctx)
	require.NoError(t, err)

	_, err = held.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", store.SeedLockKey)
	require.NoError(t, err)

	seeded := make(chan error, 1)

	go func() { _, err := store.Seed(context.WithoutCancel(ctx), dsn); seeded <- err }()

	// Le seed doit être **en attente du verrou**, et non simplement lent : c'est `pg_locks` qui le
	// dit, avec `granted = false` sur un verrou consultatif portant notre clé.
	require.Eventually(t, func() bool { return waitingForSeedLock(ctx, t, holder) }, 5*time.Second,
		50*time.Millisecond,
		"aucune transaction n'attend le verrou du seed : un second bootstrap concurrent a foncé, et "+
			"il échouera sur une clé dupliquée dès que le premier aura validé")

	select {
	case err := <-seeded:
		t.Fatalf("le seed a terminé alors que le verrou était tenu : %v", err)
	default:
	}

	require.NoError(t, held.Commit(ctx))

	select {
	case err := <-seeded:
		require.NoError(t, err, "le seed a échoué une fois le verrou rendu")
	case <-time.After(10 * time.Second):
		t.Fatal("le seed n'a pas repris après la libération du verrou")
	}
}

// waitingForSeedLock demande à PostgreSQL si une session attend le verrou consultatif du seed. La
// connexion qui interroge est celle qui tient le verrou : elle n'attend rien, donc ne se compte pas.
func waitingForSeedLock(ctx context.Context, t *testing.T, conn *pgx.Conn) bool {
	t.Helper()

	var waiting bool

	require.NoError(t, conn.QueryRow(ctx,
		"SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted "+
			"AND ((classid::bigint << 32) | objid::bigint) = $1)", store.SeedLockKey).Scan(&waiting))

	return waiting
}
