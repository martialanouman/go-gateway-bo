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

// enroll pose un second facteur pour le décor, et exige que l'écriture ait bien eu lieu. Sans cette
// exigence, un `Enroll` qui rendrait `false` — c'est désormais possible, la garde du remplacement
// vivant dans son `WHERE` — laisserait chaque cas suivant observer une base vide en croyant observer
// un enrôlement.
//
// `replace` vaut toujours `true` ici : ces cas observent l'écriture, et la garde a son propre cas.
func enroll(t *testing.T, m *store.MFA, operatorID, sealed string, hashes []string) {
	t.Helper()

	written, err := m.Enroll(t.Context(), operatorID, sealed, hashes, true)
	require.NoError(t, err)
	require.True(t, written, "l'enrôlement n'a rien écrit")
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

	state, found, err := mfa.TOTPStateOf(t.Context(), operator, testPeriod)
	require.NoError(t, err)
	require.True(t, found)

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

	state, found, err := mfa.TOTPStateOf(t.Context(), operator, testPeriod)
	require.NoError(t, err)
	require.True(t, found)

	var expected int64

	queryOn(t, dsn, `SELECT floor(extract(epoch FROM now()) / $1)::bigint`, &expected, testPeriod)
	assert.InDelta(t, expected, state.CurrentStep, 1)
}

// Un compte désactivé ne rend aucun second facteur : le refus est passif, comme pour la session.
// step-029 révoquera activement.
//
// L'absence est **distincte** de « pas encore enrôlé », et pas par coquetterie : une session résolue
// puis un compte désactivé dans l'intervalle se lirait sinon comme « il lui reste à enrôler un
// authentificateur », et l'enrôlement d'un compte désactivé lui rouvrirait la porte.
func TestUnOperateurDesactiveNaPlusDeSecondFacteurALire(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	enroll(t, mfa, operator, "v1.chiffré", []string{"hash-1"})

	_, found, err := mfa.TOTPStateOf(t.Context(), operator, testPeriod)
	require.NoError(t, err)
	require.True(t, found, "témoin : l'opérateur actif est bien lu")

	execOn(t, dsn, `UPDATE operators SET status = 'disabled' WHERE id = $1`, operator)

	_, found, err = mfa.TOTPStateOf(t.Context(), operator, testPeriod)
	require.NoError(t, err)
	assert.False(t, found)
}

// Le compte de codes appartient à `internal/mfa`, qui les tire ; ce que ce cas observe est que ce
// qu'on lui donne ressort intact et dans le même ordre.
func TestLEnrolementPoseLeSecretEtSesCodes(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	hashes := []string{"hash-1", "hash-2", "hash-3"}
	enroll(t, mfa, operator, "v1.chiffré", hashes)

	state, found, err := mfa.TOTPStateOf(t.Context(), operator, testPeriod)
	require.NoError(t, err)
	require.True(t, found)
	assert.True(t, state.Enrolled)
	assert.Equal(t, "v1.chiffré", state.SealedSecret)
	// L'adresse vient de la même ligne : c'est elle que l'application d'authentification affichera.
	assert.Equal(t, "camille@exemple.test", state.Email)

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

	enroll(t, mfa, operator, "v1.premier", []string{"ancien-1", "ancien-2"})
	enroll(t, mfa, operator, "v1.second", []string{"neuf-1"})

	codes, err := mfa.RecoveryCodesOf(t.Context(), operator)
	require.NoError(t, err)
	require.Len(t, codes, 1)
	assert.Equal(t, "neuf-1", codes[0].Hash)
}

// **La garde du remplacement, et elle vit dans l'écriture.** L'appelant sait déjà s'il y a un facteur
// en place, mais entre sa lecture et celle-ci il y a le tirage du secret et le hachage des codes — un
// quart de seconde dont l'appelant choisit le cadencement. Un booléen lu avant ne garde rien.
func TestUnEnrolementSansRemplacementNEcrasePasUnFacteurEnPlace(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	// Le témoin : sur une base sans facteur, le même appel écrit. Sans lui, ce cas serait vert sur un
	// `Enroll` qui n'écrirait jamais rien.
	written, err := mfa.Enroll(t.Context(), operator, "v1.premier", []string{"ancien"}, false)
	require.NoError(t, err)
	require.True(t, written)

	written, err = mfa.Enroll(t.Context(), operator, "v1.second", []string{"neuf"}, false)
	require.NoError(t, err)
	assert.False(t, written)

	state, _, err := mfa.TOTPStateOf(t.Context(), operator, testPeriod)
	require.NoError(t, err)
	assert.Equal(t, "v1.premier", state.SealedSecret, "le secret en place a été écrasé")

	codes, err := mfa.RecoveryCodesOf(t.Context(), operator)
	require.NoError(t, err)
	require.Len(t, codes, 1)
	assert.Equal(t, "ancien", codes[0].Hash, "les codes en place ont été détruits par un refus")
}

// L'anti-rejeu porte sur les codes d'un secret. Le précédent vient de disparaître, donc son dernier
// pas consommé n'a plus rien à refuser — et le garder pourrait bloquer une demi-minute le premier code
// du secret neuf.
func TestUnReenrolementRemetLAntiRejeuAZero(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	enroll(t, mfa, operator, "v1.premier", nil)

	accepted, err := mfa.ConsumeStep(t.Context(), operator, 58_000_010)
	require.NoError(t, err)
	require.True(t, accepted)

	enroll(t, mfa, operator, "v1.second", nil)

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

// **Le verrou qui borne la recherche exhaustive**, et qui manquait : le compteur par challenge ne
// borne rien, puisqu'une connexion réussie n'incrémente aucun compteur du premier facteur.
func TestLeVerrouDeSecondFacteurTombeAuSeuilEtPasAvant(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	for essai := 1; essai < testMaxFailures; essai++ {
		lock, err := mfa.RecordFailure(t.Context(), operator, testWindow, testMaxFailures)
		require.NoError(t, err)
		require.False(t, lock.Locked(), "le verrou mord au %d° échec, avant le seuil", essai)
	}

	lock, err := mfa.RecordFailure(t.Context(), operator, testWindow, testMaxFailures)
	require.NoError(t, err)
	require.True(t, lock.Locked(), "le seuil est franchi et rien ne verrouille")
	assert.Positive(t, lock.Remaining)

	// Et il se relit, plutôt que d'être seulement rendu par l'écriture qui l'a posé : c'est cette
	// lecture que le handler fait avant toute dépense.
	lock, err = mfa.LockFor(t.Context(), operator, testWindow, testMaxFailures)
	require.NoError(t, err)
	assert.True(t, lock.Locked())
}

// Le verrou porte sur **l'opérateur** : celui d'un compte ne ferme pas la porte d'un autre.
func TestLeVerrouDeSecondFacteurEstProprementParOperateur(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	camille := insertOperator(t, dsn, "camille@exemple.test", "hash")
	martin := insertOperator(t, dsn, "martin@exemple.test", "hash")

	for range testMaxFailures {
		_, err := mfa.RecordFailure(t.Context(), camille, testWindow, testMaxFailures)
		require.NoError(t, err)
	}

	lock, err := mfa.LockFor(t.Context(), martin, testWindow, testMaxFailures)
	require.NoError(t, err)
	assert.False(t, lock.Locked())
}

// La dimension du second facteur est **distincte** de celles du premier : verrouiller le second ne
// ferme pas la connexion, et le compteur d'adresse ne verrouille pas le second facteur. Les
// confondre ferait qu'un opérateur qui se trompe de code perdrait aussi sa connexion.
func TestLeVerrouDeSecondFacteurNeSeConfondPasAvecCeluiDeLaConnexion(t *testing.T) {
	t.Parallel()

	pool, dsn := migratedPool(t)
	mfa, logins := store.NewMFA(pool), store.NewLogins(pool)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	for range testMaxFailures {
		_, err := mfa.RecordFailure(t.Context(), operator, testWindow, testMaxFailures)
		require.NoError(t, err)
	}

	lock, err := logins.LockFor(t.Context(), "camille@exemple.test", "une-source", testWindow,
		testMaxFailures)
	require.NoError(t, err)
	assert.False(t, lock.Locked(), "verrouiller le second facteur a fermé la connexion")

	// Le témoin, dans l'autre sens : le verrou du second facteur, lui, mord bien.
	second, err := mfa.LockFor(t.Context(), operator, testWindow, testMaxFailures)
	require.NoError(t, err)
	assert.True(t, second.Locked())
}

// Un silence plus long que la fenêtre remet le compteur à un — même arbitrage qu'au premier facteur :
// plus court, un verrou qui vient d'expirer se refermerait au premier essai suivant.
func TestUnVerrouDeSecondFacteurEchuLaisseLeCompteurRepartirDeUn(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	for range testMaxFailures {
		_, err := mfa.RecordFailure(t.Context(), operator, testWindow, testMaxFailures)
		require.NoError(t, err)
	}

	execOn(t, dsn, `
		UPDATE login_attempt_counters SET last_failure_at = now() - make_interval(secs => $1)
		WHERE scope = 'mfa'`, (testWindow + time.Minute).Seconds())

	lock, err := mfa.RecordFailure(t.Context(), operator, testWindow, testMaxFailures)
	require.NoError(t, err)
	assert.False(t, lock.Locked(), "le compteur n'est pas reparti de un après l'oubli")
}

// Franchir le second facteur efface le compteur — contrairement au premier, où seule la dimension de
// l'adresse est effacée. Ici la dimension **est** l'opérateur, et celui qui vient de franchir son
// second facteur est précisément celui à qui le compteur était destiné.
func TestFranchirLeSecondFacteurEffaceSonCompteur(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	for range testMaxFailures {
		_, err := mfa.RecordFailure(t.Context(), operator, testWindow, testMaxFailures)
		require.NoError(t, err)
	}

	require.NoError(t, mfa.ClearFailures(t.Context(), operator))

	lock, err := mfa.LockFor(t.Context(), operator, testWindow, testMaxFailures)
	require.NoError(t, err)
	assert.False(t, lock.Locked())
}

func TestUnChallengeVivantSeRetrouveAvecSonOperateur(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	issueChallenge(t, dsn, operator, "jeton")

	challenge, alive, err := mfa.LiveChallenge(t.Context(), tokenHash("jeton"))
	require.NoError(t, err)
	require.True(t, alive)
	assert.Equal(t, operator, challenge.OperatorID)
	assert.NotEmpty(t, challenge.ID)
}

// Deux façons de cesser d'être utilisable, et une troisième juste en dessous — « ce jeton n'existe
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
		"il a déjà servi": `UPDATE mfa_challenges SET consumed_at = now() WHERE token_hash = $1`,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			mfa, dsn := mfaOn(t)
			operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
			issueChallenge(t, dsn, operator, "jeton")

			// Le témoin, avant d'abîmer quoi que ce soit : sans lui, un décor qui n'ouvrirait jamais
			// rien rendrait ce cas vert sans exercer la condition qu'il nomme.
			_, alive, err := mfa.LiveChallenge(t.Context(), tokenHash("jeton"))
			require.NoError(t, err)
			require.True(t, alive, "le challenge du décor n'était pas vivant")

			require.EqualValues(t, 1, execOn(t, dsn, breakIt, tokenHash("jeton")))

			_, alive, err = mfa.LiveChallenge(t.Context(), tokenHash("jeton"))
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

	_, alive, err := mfa.LiveChallenge(t.Context(), tokenHash("un jeton que personne n'a émis"))

	require.NoError(t, err)
	assert.False(t, alive)
}

// La consommation est le point de sérialisation : deux requêtes concurrentes portant le même
// challenge n'en élèvent qu'une.
func TestUnChallengeNeSeConsommeQuUneFois(t *testing.T) {
	t.Parallel()

	mfa, dsn := mfaOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	issueChallenge(t, dsn, operator, "jeton")

	challenge, _, err := mfa.LiveChallenge(t.Context(), tokenHash("jeton"))
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

	challenge, _, err := mfa.LiveChallenge(t.Context(), tokenHash("jeton"))
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

	enroll(t, mfa, operator, "v1.chiffré", []string{"hash-1", "hash-2"})

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

	enroll(t, mfa, operator, "v1.chiffré",
		[]string{"hash-1", "hash-2", "hash-3"})

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
