package store_test

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

var errSMTP = errors.New("connexion SMTP refusée")

// deliver envoie la prochaine demande due et rend le jeton qui est parti.
func deliver(t *testing.T, links *store.AccessLinks) string {
	t.Helper()

	var sent string

	delivered, err := links.DeliverNext(t.Context(), func(_ context.Context, _ store.PendingLink, token string) error {
		sent = token

		return nil
	})
	require.NoError(t, err)
	require.True(t, delivered, "aucune demande n'était due")

	return sent
}

func digestOf(t *testing.T, token string) []byte {
	t.Helper()

	digest, ok := store.AccessTokenDigest(token)
	require.True(t, ok, "le jeton envoyé n'a pas la forme attendue")

	return digest
}

// requestReset met en file un lien de reset pour un compte qui a déjà un mot de passe.
func requestReset(t *testing.T, pool *pgxpool.Pool, operatorID string) {
	t.Helper()

	require.NoError(t, store.NewAdministration(pool).RequestAccessLink(t.Context(), operatorID,
		store.Event{Action: "operator.access_link"}))
}

func failing(calls *atomic.Int32) store.SendLink {
	return func(context.Context, store.PendingLink, string) error {
		calls.Add(1)

		return errSMTP
	}
}

func TestUneCreationMetUnLienDActivationEnFile(t *testing.T) {
	t.Parallel()

	pool, dsn := migratedPool(t)

	created, err := store.NewAdministration(pool).CreateOperator(t.Context(), "nadia@exemple.test", "Nadia",
		store.Event{Action: "operator.create"})
	require.NoError(t, err)

	assert.Equal(t, &store.AccessLinkView{Kind: store.LinkActivation, State: store.LinkQueued}, created.AccessLink)

	var withoutPassword, withoutToken bool

	queryOn(t, dsn, `SELECT password_hash IS NULL FROM operators WHERE id = $1`, &withoutPassword, created.ID)
	queryOn(t, dsn, `SELECT token_hash IS NULL FROM access_links WHERE operator_id = $1 AND kind = 'activation'`,
		&withoutToken, created.ID)
	assert.True(t, withoutPassword, "le compte naît avec un mot de passe que quelqu'un d'autre connaît")
	assert.True(t, withoutToken, "un jeton existe avant tout envoi")
}

// backoffOf rend le délai posé avant la prochaine tentative, mesuré par la base.
func backoffOf(t *testing.T, dsn, operatorID string) time.Duration {
	t.Helper()

	var seconds float64

	queryOn(t, dsn, `SELECT extract(epoch FROM next_attempt_at - now()) FROM access_links WHERE operator_id = $1`,
		&seconds, operatorID)

	return time.Duration(seconds * float64(time.Second))
}

func TestUnSMTPEnEchecLaisseLeJetonNulEtRepousse(t *testing.T) {
	t.Parallel()

	pool, dsn := migratedPool(t)
	links := store.NewAccessLinks(pool)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	requestReset(t, pool, operator)

	var calls atomic.Int32

	delivered, err := links.DeliverNext(t.Context(), failing(&calls))
	assert.True(t, delivered, "un échec rend la ligne prise pour non prise")
	require.ErrorIs(t, err, errSMTP)

	var withoutToken bool

	queryOn(t, dsn, `SELECT token_hash IS NULL FROM access_links WHERE operator_id = $1`, &withoutToken, operator)
	assert.True(t, withoutToken, "un envoi raté laisse l'empreinte d'un lien que personne n'a reçu")
	assert.InDelta(t, 30*time.Second, backoffOf(t, dsn, operator), float64(2*time.Second))

	execOn(t, dsn, `UPDATE access_links SET next_attempt_at = now() WHERE operator_id = $1`, operator)
	_, err = links.DeliverNext(t.Context(), failing(&calls))
	require.ErrorIs(t, err, errSMTP)
	assert.InDelta(t, 60*time.Second, backoffOf(t, dsn, operator), float64(2*time.Second))

	execOn(t, dsn, `UPDATE access_links SET attempts = 9, next_attempt_at = now() WHERE operator_id = $1`, operator)
	_, err = links.DeliverNext(t.Context(), failing(&calls))
	require.ErrorIs(t, err, store.ErrDeliveryAbandoned)

	operatorView, err := store.NewAdministration(pool).Operators(t.Context())
	require.NoError(t, err)
	require.Len(t, operatorView, 1)
	assert.Equal(t, store.LinkFailed, operatorView[0].AccessLink.State)

	execOn(t, dsn, `UPDATE access_links SET next_attempt_at = now() WHERE operator_id = $1`, operator)
	calls.Store(0)
	delivered, err = links.DeliverNext(t.Context(), failing(&calls))
	require.NoError(t, err)
	assert.False(t, delivered)
	assert.Zero(t, calls.Load(), "un envoi abandonné est encore retenté")
}

func TestLeBackoffEstPlafonneADixMinutes(t *testing.T) {
	t.Parallel()

	pool, dsn := migratedPool(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	requestReset(t, pool, operator)
	execOn(t, dsn, `UPDATE access_links SET attempts = 8 WHERE operator_id = $1`, operator)

	var calls atomic.Int32

	_, err := store.NewAccessLinks(pool).DeliverNext(t.Context(), failing(&calls))
	require.ErrorIs(t, err, errSMTP)
	assert.LessOrEqual(t, backoffOf(t, dsn, operator), 10*time.Minute)
	assert.Greater(t, backoffOf(t, dsn, operator), 9*time.Minute)
}

// Deux instances tirent la même file : la seconde doit passer la ligne que la première tient, et non
// l'attendre puis l'envoyer une seconde fois.
func TestDeuxWorkersUneLigneUnEnvoi(t *testing.T) {
	t.Parallel()

	pool, dsn := migratedPool(t)
	links := store.NewAccessLinks(pool)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	requestReset(t, pool, operator)

	var calls atomic.Int32

	release := make(chan struct{})
	held := make(chan error, 1)

	go func() {
		_, err := links.DeliverNext(context.WithoutCancel(t.Context()),
			func(context.Context, store.PendingLink, string) error {
				calls.Add(1)
				<-release

				return nil
			})
		held <- err
	}()

	locks := func(granted bool) int {
		var count int

		require.NoError(t, pool.QueryRow(t.Context(), `
			SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
			WHERE c.relname = 'access_links' AND l.mode = 'RowShareLock' AND l.granted = $1
			  AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())`, granted).Scan(&count))

		return count
	}

	require.Eventually(t, func() bool { return locks(true) >= 1 }, 5*time.Second, 20*time.Millisecond,
		"le premier worker ne tient jamais la ligne : la séquence n'exerce pas la course")

	second, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()

	delivered, err := links.DeliverNext(second, func(context.Context, store.PendingLink, string) error {
		calls.Add(1)

		return nil
	})
	require.NoError(t, err, "le second worker a attendu la ligne au lieu de la passer")
	assert.False(t, delivered)

	var waiting int

	// Filtré par base : les tests parallèles partagent le serveur, et une attente de ligne porte sur un
	// `transactionid`, sans colonne `database`.
	require.NoError(t, pool.QueryRow(t.Context(), `
		SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
		WHERE NOT l.granted AND a.datname = current_database()`).Scan(&waiting))
	assert.Zero(t, waiting)

	close(release)
	require.NoError(t, <-held)
	assert.Equal(t, int32(1), calls.Load(), "une ligne, deux envois")
}

func TestUnJetonNeSertQuUneFois(t *testing.T) {
	t.Parallel()

	pool, dsn := migratedPool(t)
	links := store.NewAccessLinks(pool)
	requestReset(t, pool, insertOperator(t, dsn, "camille@exemple.test", "hash"))
	digest := digestOf(t, deliver(t, links))

	require.NoError(t, links.Consume(t.Context(), digest, "neuf", store.Event{Action: "operator.password_set"}))
	assert.ErrorIs(t, links.Consume(t.Context(), digest, "encore", store.Event{Action: "operator.password_set"}),
		store.ErrLinkInvalid)
}

func TestUnJetonExpireEstRefuse(t *testing.T) {
	t.Parallel()

	pool, dsn := migratedPool(t)
	links := store.NewAccessLinks(pool)
	requestReset(t, pool, insertOperator(t, dsn, "camille@exemple.test", "hash"))
	digest := digestOf(t, deliver(t, links))
	execOn(t, dsn, `UPDATE access_links SET expires_at = now() - interval '1 second'`)

	valid, err := links.Valid(t.Context(), digest)
	require.NoError(t, err)
	assert.False(t, valid)
	assert.ErrorIs(t, links.Consume(t.Context(), digest, "neuf", store.Event{Action: "operator.password_set"}),
		store.ErrLinkInvalid)
}

func TestUnNouveauLienInvalideLePrecedent(t *testing.T) {
	t.Parallel()

	pool, dsn := migratedPool(t)
	links := store.NewAccessLinks(pool)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	requestReset(t, pool, operator)
	former := digestOf(t, deliver(t, links))
	requestReset(t, pool, operator)
	latest := digestOf(t, deliver(t, links))

	require.ErrorIs(t, links.Consume(t.Context(), former, "ancien", store.Event{Action: "operator.password_set"}),
		store.ErrLinkInvalid)
	assert.NoError(t, links.Consume(t.Context(), latest, "neuf", store.Event{Action: "operator.password_set"}))
}

// Le reset retire **tout** ce qui franchit le second facteur : un code de récupération ou une passkey
// survivants suffiraient à celui qui a volé le téléphone et la feuille de codes. Rien ne change avant
// l'usage : l'administrateur qui demande le lien ne prive personne de son accès.
func TestLeResetEffaceLesFacteursEtFermeLesSessions(t *testing.T) {
	t.Parallel()

	pool, dsn := migratedPool(t)
	links := store.NewAccessLinks(pool)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	registerPasskey(t, store.NewWebauthn(pool), operator, "cle")
	execOn(t, dsn, `
		WITH secret AS (UPDATE operators SET mfa_totp_secret = 'scelle', mfa_totp_last_step = 1 WHERE id = $1),
		     codes AS (INSERT INTO mfa_recovery_codes (operator_id, code_hash) VALUES ($1, 'h')),
		     session AS (INSERT INTO sessions (operator_id, token_hash, expires_at)
		                 VALUES ($1, 'jeton', now() + interval '1 hour'))
		INSERT INTO login_attempt_counters (scope, subject, failures, last_failure_at)
		VALUES ('mfa', $1::text, 5, now())`, operator)

	survivors := func() int {
		var count int

		queryOn(t, dsn, `
			SELECT (SELECT count(*) FROM operators WHERE id = $1 AND mfa_totp_secret IS NOT NULL)
			     + (SELECT count(*) FROM mfa_recovery_codes WHERE operator_id = $1)
			     + (SELECT count(*) FROM webauthn_credentials WHERE operator_id = $1)
			     + (SELECT count(*) FROM login_attempt_counters WHERE scope = 'mfa' AND subject = $1::text)
			     + (SELECT count(*) FROM sessions WHERE operator_id = $1)`, &count, operator)

		return count
	}

	requestReset(t, pool, operator)
	digest := digestOf(t, deliver(t, links))
	require.Equal(t, 5, survivors(), "la demande a changé quelque chose avant l'usage du lien")

	require.NoError(t, links.Consume(t.Context(), digest, "neuf", store.Event{Action: "operator.password_set"}))
	assert.Zero(t, survivors(), "le reset laisse un facteur, un verrou ou une session derrière lui")
}

func TestUnCompteSansMotDePasseNEstPasTrouveAuLogin(t *testing.T) {
	t.Parallel()

	pool, _ := migratedPool(t)

	_, err := store.NewAdministration(pool).CreateOperator(t.Context(), "nadia@exemple.test", "Nadia",
		store.Event{Action: "operator.create"})
	require.NoError(t, err)

	found, err := store.NewLogins(pool).OperatorByEmail(t.Context(), "nadia@exemple.test")
	require.NoError(t, err)
	assert.Nil(t, found, "un compte sans mot de passe échappe au hachage factice")
}

func TestUnLienSurUnCompteDesactiveEstRefuse(t *testing.T) {
	t.Parallel()

	pool, dsn := migratedPool(t)
	links := store.NewAccessLinks(pool)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	requestReset(t, pool, operator)
	digest := digestOf(t, deliver(t, links))
	execOn(t, dsn, `UPDATE operators SET status = 'disabled' WHERE id = $1`, operator)

	require.ErrorIs(t, store.NewAdministration(pool).RequestAccessLink(t.Context(), operator,
		store.Event{Action: "operator.access_link"}), store.ErrOperatorDisabled)
	assert.ErrorIs(t, links.Consume(t.Context(), digest, "neuf", store.Event{Action: "operator.password_set"}),
		store.ErrLinkInvalid)
}

// Réactiver ne rend pas vie à ce que la désactivation a fermé : ni le lien parti, ni la demande en
// file, qui partirait sans que personne l'ait redemandée.
func TestUneReactivationNeRanimeAucunLien(t *testing.T) {
	t.Parallel()

	pool, dsn := migratedPool(t)
	admin := store.NewAdministration(pool)
	links := store.NewAccessLinks(pool)
	sent := insertOperator(t, dsn, "camille@exemple.test", "hash")
	queued := insertOperator(t, dsn, "nadia@exemple.test", "hash")
	requestReset(t, pool, sent)
	digest := digestOf(t, deliver(t, links))
	requestReset(t, pool, queued)

	for _, status := range []string{"disabled", store.StatusActive} {
		for _, operator := range []string{sent, queued} {
			_, err := admin.SetOperatorStatus(t.Context(), operator, status, store.Event{Action: "operator.status"})
			require.NoError(t, err)
		}
	}

	require.ErrorIs(t, links.Consume(t.Context(), digest, "neuf", store.Event{Action: "operator.password_set"}),
		store.ErrLinkInvalid)

	var calls atomic.Int32

	delivered, err := links.DeliverNext(t.Context(), failing(&calls))
	require.NoError(t, err)
	assert.False(t, delivered, "une demande faite avant la désactivation part après la réactivation")

	requestReset(t, pool, queued)
	assert.NotEmpty(t, deliver(t, links), "un renvoi après la réactivation ne part pas")
}
