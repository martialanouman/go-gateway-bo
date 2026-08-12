package store_test

import (
	"context"
	"crypto/sha256"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

const (
	// La fenêtre des tests est large : ce qu'ils observent est le comptage et le verrou, pas
	// l'écoulement du temps. Les scénarios qui font expirer un verrou reculent `last_failure_at`
	// plutôt que d'attendre.
	testWindow    = time.Hour
	testThreshold = 5
)

// loginsOn rend un accès prêt à servir sur une base neuve. Le pool est fermé par le contexte du
// test — c'est le cycle de vie que `NewPool` attache lui-même.
func loginsOn(t *testing.T) (*store.Logins, string) {
	t.Helper()

	pool, dsn := migratedPool(t)

	return store.NewLogins(pool), dsn
}

// insertOperator pose un opérateur directement, sans passer par la commande : ce que ces tests
// observent est le comptage, pas la création de compte.
func insertOperator(t *testing.T, dsn, email, hash string) string {
	t.Helper()

	conn, err := pgx.Connect(t.Context(), dsn)
	require.NoError(t, err)

	defer func() { _ = conn.Close(context.WithoutCancel(t.Context())) }()

	var id string

	err = conn.QueryRow(t.Context(),
		`INSERT INTO operators (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id::text`,
		email, "Opérateur d'essai", hash).Scan(&id)
	require.NoError(t, err)

	return id
}

func TestUneAdresseInconnueNeRendAucunOperateurSansEtreUneErreur(t *testing.T) {
	t.Parallel()

	logins, _ := loginsOn(t)

	operator, err := logins.OperatorByEmail(t.Context(), "personne@exemple.test")
	require.NoError(t, err, "une adresse inconnue est un cas normal du chemin, pas une panne")
	assert.Nil(t, operator)
}

// L'index d'unicité de 00001 porte sur `lower(email)`. Si la requête ne l'empruntait pas, un
// opérateur inscrit avec une majuscule deviendrait introuvable — et son compte, inaccessible.
func TestUnOperateurSeRetrouveQuelleQueSoitLaCasseDeSonAdresse(t *testing.T) {
	t.Parallel()

	logins, dsn := loginsOn(t)
	id := insertOperator(t, dsn, "Camille.Durand@Exemple.test", "$argon2id$peu$importe")

	operator, err := logins.OperatorByEmail(t.Context(), "camille.durand@exemple.test")
	require.NoError(t, err)
	require.NotNil(t, operator, "l'adresse inscrite avec des majuscules est introuvable en minuscules")
	assert.Equal(t, id, operator.ID)
	assert.Equal(t, store.StatusActive, operator.Status)
}

func TestLeVerrouTombeAuSeuilEtPasAvant(t *testing.T) {
	t.Parallel()

	logins, _ := loginsOn(t)

	for attempt := 1; attempt < testThreshold; attempt++ {
		lock, err := logins.RecordFailure(t.Context(), "cible@exemple.test", "source-a", testWindow, testThreshold)
		require.NoError(t, err)
		assert.False(t, lock.Locked(), "verrouillé dès le %dᵉ échec, alors que le seuil est %d",
			attempt, testThreshold)
	}

	lock, err := logins.RecordFailure(t.Context(), "cible@exemple.test", "source-a", testWindow, testThreshold)
	require.NoError(t, err)
	assert.True(t, lock.Locked(), "le %dᵉ échec ne verrouille pas : la porte ne se ferme jamais", testThreshold)
	assert.Positive(t, lock.Remaining, "le verrou n'annonce aucune durée restante")
}

// La seconde dimension. Sans elle, une machine qui balaie des adresses différentes n'est comptée par
// rien : chaque adresse repart de zéro et le verrou par compte ne la ralentit jamais.
func TestLeVerrouSAppliqueAussiALAdresseSource(t *testing.T) {
	t.Parallel()

	logins, _ := loginsOn(t)

	for attempt := range testThreshold {
		_, err := logins.RecordFailure(t.Context(),
			// Une adresse différente à chaque fois : seul le compteur de source peut verrouiller.
			"cible-"+string(rune('a'+attempt))+"@exemple.test", "source-balayeuse", testWindow, testThreshold)
		require.NoError(t, err)
	}

	lock, err := logins.LockFor(t.Context(), "encore-une-autre@exemple.test", "source-balayeuse",
		testWindow, testThreshold)
	require.NoError(t, err)
	assert.True(t, lock.Locked(), "une source qui balaie des adresses distinctes n'est comptée par rien")
	assert.Equal(t, store.ScopeSource, lock.Scope)
}

// La ligne de la fiche : « le compteur est bien partagé ». Deux pools distincts, c'est-à-dire deux
// jeux de connexions indépendants, comme le sont deux instances derrière le load balancer.
func TestDeuxPoolsDistinctsSurLaMemeBaseAdditionnentLeursEchecs(t *testing.T) {
	t.Parallel()

	dsn, err := createDatabase(t.Context())
	require.NoError(t, err)

	_, err = store.Migrate(t.Context(), dsn)
	require.NoError(t, err)

	premierPool, err := store.NewPool(t.Context(), dsn)
	require.NoError(t, err)

	secondPool, err := store.NewPool(t.Context(), dsn)
	require.NoError(t, err)

	premiere, seconde := store.NewLogins(premierPool), store.NewLogins(secondPool)

	// Les échecs alternent d'une instance à l'autre, comme le ferait un load balancer en tourniquet.
	for attempt := range testThreshold {
		instance := premiere
		if attempt%2 == 1 {
			instance = seconde
		}

		_, err = instance.RecordFailure(t.Context(), "cible@exemple.test", "source-a", testWindow, testThreshold)
		require.NoError(t, err)
	}

	lock, err := seconde.LockFor(t.Context(), "cible@exemple.test", "source-a", testWindow, testThreshold)
	require.NoError(t, err)
	assert.True(t, lock.Locked(),
		"les échecs de deux instances ne s'additionnent pas : chacune compte dans son coin et la porte reste ouverte")
	assert.Equal(t, testThreshold, lock.Failures)
}

// La course. Ce test est le seul que la forme « CTE + excluded.failures » fait rougir : elle lit sur
// le snapshot de sa transaction et écrase la valeur fraîche, donc elle perd des échecs — en restant
// verte sous test séquentiel.
func TestDesEchecsSimultanesNeSePerdentPas(t *testing.T) {
	t.Parallel()

	logins, _ := loginsOn(t)

	const simultaneous = 12

	var groupe sync.WaitGroup

	errs := make([]error, simultaneous)

	for worker := range simultaneous {
		groupe.Add(1)

		go func() {
			defer groupe.Done()

			_, errs[worker] = logins.RecordFailure(t.Context(), "cible@exemple.test", "source-a",
				testWindow, simultaneous+1)
		}()
	}

	groupe.Wait()

	for _, err := range errs {
		require.NoError(t, err)
	}

	lock, err := logins.LockFor(t.Context(), "cible@exemple.test", "source-a", testWindow, 1)
	require.NoError(t, err)
	assert.Equal(t, simultaneous, lock.Failures,
		"%d échecs simultanés en ont laissé %d : des tentatives se perdent, et le verrou tombe plus tard "+
			"qu'il ne le devrait", simultaneous, lock.Failures)
}

// L'égalité entre la fenêtre d'oubli et la durée du verrou, qui est ce qui rend vraie la phrase
// « verrou expiré → un nouvel essai est possible ». Si l'oubli était plus long, le compteur serait
// encore au-dessus du seuil quand le verrou tombe, et le premier essai suivant reverrouillerait.
func TestUnVerrouEchuLaisseLeCompteurRepartirDeUn(t *testing.T) {
	t.Parallel()

	logins, dsn := loginsOn(t)

	for range testThreshold {
		_, err := logins.RecordFailure(t.Context(), "cible@exemple.test", "source-a", testWindow, testThreshold)
		require.NoError(t, err)
	}

	// On recule l'horodatage stocké plutôt que d'attendre une heure : c'est l'état de la base qu'on
	// déplace, pas le produit — aucun drapeau de test, aucune garde désarmée.
	ageCounters(t, dsn, testWindow+time.Minute)

	lock, err := logins.LockFor(t.Context(), "cible@exemple.test", "source-a", testWindow, testThreshold)
	require.NoError(t, err)
	require.False(t, lock.Locked(), "le verrou n'est jamais tombé")

	after, err := logins.RecordFailure(t.Context(), "cible@exemple.test", "source-a", testWindow, testThreshold)
	require.NoError(t, err)
	assert.False(t, after.Locked(),
		"le premier échec après l'échéance reverrouille aussitôt : la fenêtre d'oubli est plus longue que le verrou")
}

func TestUneConnexionReussieEffaceLeCompteurDeLAdresseEtPasCeluiDeLaSource(t *testing.T) {
	t.Parallel()

	logins, _ := loginsOn(t)

	for range testThreshold {
		_, err := logins.RecordFailure(t.Context(), "cible@exemple.test", "source-a", testWindow, testThreshold)
		require.NoError(t, err)
	}

	require.NoError(t, logins.ClearFailures(t.Context(), "cible@exemple.test"))

	// L'adresse repart de zéro : LockFor au seuil 1 ne trouve plus rien pour elle seule.
	lock, err := logins.LockFor(t.Context(), "cible@exemple.test", "source-inconnue", testWindow, 1)
	require.NoError(t, err)
	assert.False(t, lock.Locked(), "le compteur de l'adresse n'a pas été effacé après une connexion réussie")

	// La source, elle, garde son compte : sinon détenir un compte valide annulerait la seconde
	// dimension pour tout le monde.
	stillCounted, err := logins.LockFor(t.Context(), "autre@exemple.test", "source-a", testWindow, testThreshold)
	require.NoError(t, err)
	assert.True(t, stillCounted.Locked(),
		"le compteur de source a été effacé par une connexion réussie : quiconque détient un compte peut le vider")
}

func TestUnChallengeEstEmisAvecUneEcheanceDansLeFutur(t *testing.T) {
	t.Parallel()

	logins, dsn := loginsOn(t)
	id := insertOperator(t, dsn, "camille@exemple.test", "$argon2id$peu$importe")

	empreinte := sha256.Sum256([]byte("un jeton"))

	expiresAt, err := logins.IssueChallenge(t.Context(), id, empreinte[:], 5*time.Minute)
	require.NoError(t, err)
	assert.True(t, expiresAt.After(time.Now()), "le challenge est émis déjà périmé")
}

// L'unicité de `token_hash` n'est pas décorative : c'est elle qui ferait échouer bruyamment un
// générateur qui répéterait une valeur, plutôt que de laisser deux opérateurs partager un challenge.
func TestDeuxChallengesNePeuventPasPorterLaMemeEmpreinte(t *testing.T) {
	t.Parallel()

	logins, dsn := loginsOn(t)
	premier := insertOperator(t, dsn, "camille@exemple.test", "$argon2id$peu$importe")
	second := insertOperator(t, dsn, "dominique@exemple.test", "$argon2id$peu$importe")

	empreinte := sha256.Sum256([]byte("un jeton"))

	_, err := logins.IssueChallenge(t.Context(), premier, empreinte[:], 5*time.Minute)
	require.NoError(t, err)

	_, err = logins.IssueChallenge(t.Context(), second, empreinte[:], 5*time.Minute)
	require.Error(t, err, "deux challenges partagent la même empreinte sans que la base s'en plaigne")
}

// ageCounters recule l'horodatage de tous les compteurs, pour observer une échéance sans attendre.
func ageCounters(t *testing.T, dsn string, by time.Duration) {
	t.Helper()

	conn, err := pgx.Connect(t.Context(), dsn)
	require.NoError(t, err)

	defer func() { _ = conn.Close(context.WithoutCancel(t.Context())) }()

	_, err = conn.Exec(t.Context(),
		`UPDATE login_attempt_counters SET last_failure_at = last_failure_at - make_interval(secs => $1)`,
		by.Seconds())
	require.NoError(t, err)
}
