package store_test

import (
	"net/url"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Une borne de partition est un **instant absolu**, et le fuseau de la session n'est pas sous le
// contrôle de ce dépôt : `pgx` transmet tout paramètre de DSN inconnu comme paramètre d'exécution,
// et un `ALTER DATABASE … SET timezone` côté serveur fait le reste. Ce test pose donc le fuseau
// lui-même plutôt que d'espérer celui du runner.
//
// **Le mois est ancré**, et c'est ce qui rend le défaut falsifiable à toute date : mesuré le
// 02/08/2026, l'arithmétique fautive tombe juste 6 mois sur 12 sous `America/New_York` — dont août.
// Une suite qui s'en remettrait à `now()` dirait donc quelque chose de différent selon le jour où
// elle tourne.
func TestPartitionBoundsHoldWhateverTheSessionTimezone(t *testing.T) {
	t.Parallel()

	// Mars 2026 : sous `America/New_York` la borne haute tombe le 28 mars à 23:00 UTC, sous
	// `Europe/Paris` elle tombe une heure trop tôt — les deux à cause du même passage à l'heure d'été.
	anchor := time.Date(2026, time.March, 10, 0, 0, 0, 0, time.UTC)

	probes := []struct {
		at        time.Time
		partition string
	}{
		{time.Date(2026, time.March, 1, 0, 0, 0, 0, time.UTC), "audit_log_2026_03"},
		{time.Date(2026, time.March, 31, 23, 59, 59, 0, time.UTC), "audit_log_2026_03"},
		{time.Date(2026, time.April, 1, 0, 0, 0, 0, time.UTC), "audit_log_2026_04"},
		{time.Date(2026, time.April, 30, 23, 59, 59, 0, time.UTC), "audit_log_2026_04"},
	}

	for _, timezone := range []string{"America/New_York", "Europe/Paris"} {
		t.Run(timezone, func(t *testing.T) {
			t.Parallel()

			ctx := t.Context()
			dsn := freshDatabase(ctx, t) + "&timezone=" + url.QueryEscape(timezone)

			_, err := store.Migrate(ctx, dsn)
			require.NoError(t, err, "jouer les migrations sous %s", timezone)

			conn, err := pgx.Connect(ctx, dsn)
			require.NoError(t, err, "se connecter sous %s", timezone)

			defer func() { _ = conn.Close(ctx) }()

			// Sans ce contrôle, un `pgx` qui n'enverrait pas le paramètre laisserait le test vert en
			// n'ayant jamais quitté UTC — c'est-à-dire en n'observant rien.
			var session string

			require.NoError(t, conn.QueryRow(ctx, "SHOW timezone").Scan(&session))
			require.Equalf(t, timezone, session,
				"la session tourne en %s : le DSN n'a pas transmis le fuseau, et ce test ne prouverait "+
					"rien de ce qu'il croit observer", session)

			_, err = conn.Exec(ctx, "SELECT ensure_audit_log_partitions($1)", anchor)
			require.NoError(t, err, "créer les partitions du mois d'ancrage")

			// Ce qu'une partition sert à faire est d'accueillir une écriture : les bornes s'observent
			// donc sur l'atterrissage, jamais sur `pg_get_expr` qui décrirait la structure sans
			// jamais tenter l'écriture qui compte.
			for _, probe := range probes {
				var landedIn string

				err = conn.QueryRow(ctx, `
					INSERT INTO audit_log (action, created_at) VALUES ('test.partition', $1)
					RETURNING tableoid::regclass::text`, probe.at).Scan(&landedIn)
				require.NoErrorf(t, err, "écrire un événement d'audit daté du %s sous %s : le mois "+
					"d'ancrage n'est pas couvert de bout en bout, donc toute action tracée du BFF "+
					"serait refusée ce jour-là", probe.at.Format(time.RFC3339), timezone)

				assert.Equalf(t, probe.partition, landedIn,
					"l'événement du %s est rangé dans %q : les bornes ne découpent pas les mois UTC",
					probe.at.Format(time.RFC3339), landedIn)
			}
		})
	}
}
