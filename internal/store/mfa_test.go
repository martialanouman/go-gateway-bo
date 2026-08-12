package store_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// testPeriod et testMaxFailures reprennent ce que le produit applique. Ils voyagent en argument
// plutôt que d'être lus ici : ce fichier ne connaît que le SQL.
const (
	testPeriod      = 30
	testMaxFailures = 5
)

func mfaOn(t *testing.T) (*store.MFA, string) {
	t.Helper()

	pool, dsn := migratedPool(t)

	return store.NewMFA(pool), dsn
}

// issueChallenge pose un challenge vivant sans passer par le premier facteur : ce que ces cas
// observent est sa consommation, pas son émission.
func issueChallenge(t *testing.T, dsn, operatorID, token string) {
	t.Helper()

	touched := execOn(t, dsn, `
		INSERT INTO mfa_challenges (operator_id, token_hash, expires_at)
		VALUES ($1, $2, now() + interval '5 minutes')`, operatorID, tokenHash(token))
	require.EqualValues(t, 1, touched)
}

func TestUnOperateurSansEnrolementNaPasDeSecondFacteur(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	state, err := mfa.TOTPStateOf(t.Context(), operator, testPeriod)
	require.NoError(t, err)

	assert.False(t, state.Enrolled)
	assert.Empty(t, state.SealedSecret)
	// Le pas est rendu quand même : il vient de l'horloge de la base, pas de l'opérateur.
	assert.Positive(t, state.CurrentStep)
}

// Le pas vient du **serveur de base** et non du process : deux instances aux horloges décalées
// accepteraient sinon un code que l'autre refuse.
func TestLePasCourantEstCeluiDeLHorlogeDeLaBase(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	state, err := mfa.TOTPStateOf(t.Context(), operator, testPeriod)
	require.NoError(t, err)

	var expected int64

	queryOn(t, dsn, `SELECT floor(extract(epoch FROM now()) / $1)::bigint`, &expected, testPeriod)
	assert.InDelta(t, expected, state.CurrentStep, 1)
}

// Un compte désactivé ne rend aucun second facteur : le refus est passif, comme pour la session.
// step-029 révoquera activement.
func TestUnOperateurDesactiveNaPlusDeSecondFacteurALire(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	require.NoError(t, mfa.Enroll(t.Context(), operator, "v1.chiffré", []string{"hash-1"}))
	execOn(t, dsn, `UPDATE operators SET status = 'disabled' WHERE id = $1`, operator)

	state, err := mfa.TOTPStateOf(t.Context(), operator, testPeriod)
	require.NoError(t, err)
	assert.False(t, state.Enrolled)
}

// Le compte de codes appartient à `internal/mfa`, qui les tire ; ce que ce cas observe est que ce
// qu'on lui donne ressort intact et dans le même ordre.
func TestLEnrolementPoseLeSecretEtSesCodes(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	hashes := []string{"hash-1", "hash-2", "hash-3"}
	require.NoError(t, mfa.Enroll(t.Context(), operator, "v1.chiffré", hashes))

	state, err := mfa.TOTPStateOf(t.Context(), operator, testPeriod)
	require.NoError(t, err)
	assert.True(t, state.Enrolled)
	assert.Equal(t, "v1.chiffré", state.SealedSecret)

	codes, err := mfa.RecoveryCodesOf(t.Context(), operator)
	require.NoError(t, err)
	require.Len(t, codes, len(hashes))

	for index, code := range codes {
		assert.Equal(t, hashes[index], code.Hash, "l'ordre de lecture ne suit pas celui de l'écriture")
	}
}

// Un secret neuf avec les anciens codes laisserait entrer avec une liste que l'opérateur croit
// périmée. Les deux écritures sont dans la même transaction pour cette raison.
func TestUnReenrolementRemplaceLesCodesPrecedents(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	require.NoError(t, mfa.Enroll(t.Context(), operator, "v1.premier", []string{"ancien-1", "ancien-2"}))
	require.NoError(t, mfa.Enroll(t.Context(), operator, "v1.second", []string{"neuf-1"}))

	codes, err := mfa.RecoveryCodesOf(t.Context(), operator)
	require.NoError(t, err)
	require.Len(t, codes, 1)
	assert.Equal(t, "neuf-1", codes[0].Hash)
}

// L'anti-rejeu porte sur les codes d'un secret. Le précédent vient de disparaître, donc son dernier
// pas consommé n'a plus rien à refuser — et le garder pourrait bloquer une demi-minute le premier code
// du secret neuf.
func TestUnReenrolementRemetLAntiRejeuAZero(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	require.NoError(t, mfa.Enroll(t.Context(), operator, "v1.premier", nil))

	accepted, err := mfa.ConsumeStep(t.Context(), operator, 58_000_010)
	require.NoError(t, err)
	require.True(t, accepted)

	require.NoError(t, mfa.Enroll(t.Context(), operator, "v1.second", nil))

	accepted, err = mfa.ConsumeStep(t.Context(), operator, 58_000_005)
	require.NoError(t, err)
	assert.True(t, accepted, "le pas d'un secret disparu refuse encore les codes du secret neuf")
}

// **Le test central de la step.** Sans l'anti-rejeu, un code intercepté se rejoue pendant toute la
// fenêtre de dérive.
func TestUnPasDejaConsommeEstRefuse(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	accepted, err := mfa.ConsumeStep(t.Context(), operator, 58_000_000)
	require.NoError(t, err)
	require.True(t, accepted)

	accepted, err = mfa.ConsumeStep(t.Context(), operator, 58_000_000)
	require.NoError(t, err)
	assert.False(t, accepted)
}

// La garde est **monotone** et non « pas deux fois le même » : avec ±1 pas de dérive, refuser
// seulement l'identique laisserait rejouer le code du pas précédent, encore dans la fenêtre.
func TestUnPasAnterieurAuDernierConsommeEstRefuse(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	accepted, err := mfa.ConsumeStep(t.Context(), operator, 58_000_000)
	require.NoError(t, err)
	require.True(t, accepted)

	accepted, err = mfa.ConsumeStep(t.Context(), operator, 58_000_000-1)
	require.NoError(t, err)
	assert.False(t, accepted, "le code du pas précédent se rejoue")

	// Le témoin : le pas suivant passe, sinon ce cas serait vert sur une garde qui refuse tout.
	accepted, err = mfa.ConsumeStep(t.Context(), operator, 58_000_000+1)
	require.NoError(t, err)
	assert.True(t, accepted)
}

// Deux opérateurs ne partagent pas leur compteur : la garde porte sur la ligne, pas sur la table.
func TestLAntiRejeuEstProprementParOperateur(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	camille := insertOperator(t, dsn, "camille@exemple.test", "hash")
	martin := insertOperator(t, dsn, "martin@exemple.test", "hash")

	accepted, err := mfa.ConsumeStep(t.Context(), camille, 58_000_000)
	require.NoError(t, err)
	require.True(t, accepted)

	accepted, err = mfa.ConsumeStep(t.Context(), martin, 58_000_000)
	require.NoError(t, err)
	assert.True(t, accepted)
}

func TestUnChallengeVivantSeRetrouveAvecSonOperateur(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	issueChallenge(t, dsn, operator, "jeton")

	challenge, alive, err := mfa.LiveChallenge(t.Context(), tokenHash("jeton"), testMaxFailures)
	require.NoError(t, err)
	require.True(t, alive)
	assert.Equal(t, operator, challenge.OperatorID)
	assert.NotEmpty(t, challenge.ID)
}

// Trois façons de cesser d'être utilisable, et une quatrième juste en dessous — « ce jeton n'existe
// pas », qui n'a rien à abîmer. Toutes rendent la **même** absence : le refus qu'elles produisent ne
// dit pas laquelle s'applique.
func TestUnChallengeQuiNestPlusUtilisableNeSeRetrouvePas(t *testing.T) {
	t.Parallel()

	for name, breakIt := range map[string]string{
		// La naissance recule avec l'échéance : le schéma refuse une échéance antérieure à la
		// création, et un `UPDATE` rejeté aurait fait passer ce cas pour la mauvaise raison.
		"il est échu": `UPDATE mfa_challenges
			SET created_at = now() - interval '10 minutes', expires_at = now() - interval '1 second'
			WHERE token_hash = $1`,
		"il a déjà servi":        `UPDATE mfa_challenges SET consumed_at = now() WHERE token_hash = $1`,
		"il a épuisé ses essais": `UPDATE mfa_challenges SET failures = 5 WHERE token_hash = $1`,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			mfa, dsn := mfaOn(t)
			operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
			issueChallenge(t, dsn, operator, "jeton")

			// Le témoin, avant d'abîmer quoi que ce soit : sans lui, un décor qui n'ouvrirait jamais
			// rien rendrait ce cas vert sans exercer la condition qu'il nomme.
			_, alive, err := mfa.LiveChallenge(t.Context(), tokenHash("jeton"), testMaxFailures)
			require.NoError(t, err)
			require.True(t, alive, "le challenge du décor n'était pas vivant")

			require.EqualValues(t, 1, execOn(t, dsn, breakIt, tokenHash("jeton")))

			_, alive, err = mfa.LiveChallenge(t.Context(), tokenHash("jeton"), testMaxFailures)
			require.NoError(t, err)
			assert.False(t, alive)
		})
	}
}

func TestUnJetonQueLaBaseNePortePasNeRetrouveAucunChallenge(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	issueChallenge(t, dsn, operator, "jeton")

	_, alive, err := mfa.LiveChallenge(t.Context(), tokenHash("un jeton que personne n'a émis"),
		testMaxFailures)

	require.NoError(t, err)
	assert.False(t, alive)
}

// Le seuil mord **au** seuil et pas avant : un opérateur qui s'est trompé quatre fois doit encore
// pouvoir entrer, sinon la garde refuserait du légitime et finirait retirée.
func TestLeChallengeSurvitJusquAuSeuil(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	issueChallenge(t, dsn, operator, "jeton")

	challenge, alive, err := mfa.LiveChallenge(t.Context(), tokenHash("jeton"), testMaxFailures)
	require.NoError(t, err)
	require.True(t, alive)

	for range testMaxFailures - 1 {
		require.NoError(t, mfa.RecordChallengeFailure(t.Context(), challenge.ID))

		_, alive, err = mfa.LiveChallenge(t.Context(), tokenHash("jeton"), testMaxFailures)
		require.NoError(t, err)
		require.True(t, alive, "le challenge est mort avant le seuil")
	}

	require.NoError(t, mfa.RecordChallengeFailure(t.Context(), challenge.ID))

	_, alive, err = mfa.LiveChallenge(t.Context(), tokenHash("jeton"), testMaxFailures)
	require.NoError(t, err)
	assert.False(t, alive, "le challenge survit au seuil : la recherche exhaustive n'est pas bornée")
}

// La consommation est le point de sérialisation : deux requêtes concurrentes portant le même
// challenge n'en élèvent qu'une.
func TestUnChallengeNeSeConsommeQuUneFois(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	issueChallenge(t, dsn, operator, "jeton")

	challenge, _, err := mfa.LiveChallenge(t.Context(), tokenHash("jeton"), testMaxFailures)
	require.NoError(t, err)

	consumed, err := mfa.ConsumeChallenge(t.Context(), challenge.ID)
	require.NoError(t, err)
	require.True(t, consumed)

	consumed, err = mfa.ConsumeChallenge(t.Context(), challenge.ID)
	require.NoError(t, err)
	assert.False(t, consumed)
}

// Consommé et non détruit : « déjà servi » doit rester discernable de « n'a jamais existé » pour
// l'audit de step-025.
func TestUnChallengeConsommeResteEnBase(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	issueChallenge(t, dsn, operator, "jeton")

	challenge, _, err := mfa.LiveChallenge(t.Context(), tokenHash("jeton"), testMaxFailures)
	require.NoError(t, err)

	_, err = mfa.ConsumeChallenge(t.Context(), challenge.ID)
	require.NoError(t, err)

	var consumed *time.Time

	queryOn(t, dsn, `SELECT consumed_at FROM mfa_challenges WHERE id = $1`, &consumed, challenge.ID)
	assert.NotNil(t, consumed)
}

// Détruit et non marqué : il n'y a rien à réafficher, donc rien à fuir, et un code détruit ne se
// distingue pas d'un code qui n'a jamais existé.
func TestUnCodeDeRecuperationConsommeDisparait(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	require.NoError(t, mfa.Enroll(t.Context(), operator, "v1.chiffré", []string{"hash-1", "hash-2"}))

	codes, err := mfa.RecoveryCodesOf(t.Context(), operator)
	require.NoError(t, err)
	require.Len(t, codes, 2)

	consumed, err := mfa.ConsumeRecoveryCode(t.Context(), codes[0].ID)
	require.NoError(t, err)
	require.True(t, consumed)

	remaining, err := mfa.RecoveryCodesOf(t.Context(), operator)
	require.NoError(t, err)
	require.Len(t, remaining, 1)
	assert.Equal(t, "hash-2", remaining[0].Hash)

	consumed, err = mfa.ConsumeRecoveryCode(t.Context(), codes[0].ID)
	require.NoError(t, err)
	assert.False(t, consumed, "un code consommé se consomme une seconde fois")
}

// Ce que `GET /auth/me` rend : un booléen et un compte, jamais un secret ni un code.
func TestLesFacteursRenduSontUnBooleenEtUnCompte(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	factors, err := mfa.FactorsOf(t.Context(), operator)
	require.NoError(t, err)
	assert.False(t, factors.TOTPEnrolled)
	assert.Equal(t, 0, factors.RecoveryCodesRemaining)

	require.NoError(t, mfa.Enroll(t.Context(), operator, "v1.chiffré",
		[]string{"hash-1", "hash-2", "hash-3"}))

	factors, err = mfa.FactorsOf(t.Context(), operator)
	require.NoError(t, err)
	assert.True(t, factors.TOTPEnrolled)
	assert.Equal(t, 3, factors.RecoveryCodesRemaining)

	codes, err := mfa.RecoveryCodesOf(t.Context(), operator)
	require.NoError(t, err)

	_, err = mfa.ConsumeRecoveryCode(t.Context(), codes[0].ID)
	require.NoError(t, err)

	factors, err = mfa.FactorsOf(t.Context(), operator)
	require.NoError(t, err)
	assert.Equal(t, 2, factors.RecoveryCodesRemaining)
}
