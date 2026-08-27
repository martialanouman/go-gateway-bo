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

const testCeremonyTTL = 5 * time.Minute

func webauthnOn(t *testing.T) (*store.Webauthn, string) {
	t.Helper()

	pool, dsn := migratedPool(t)

	return store.NewWebauthn(pool), dsn
}

// samplePasskey fabrique une passkey plausible. Les octets n'ont pas à être une vraie clé : ce
// paquet ne vérifie aucune signature, il écrit et relit des colonnes.
func samplePasskey(credentialID string) store.Passkey {
	return store.Passkey{
		CredentialID:   []byte(credentialID),
		PublicKey:      []byte("clé-publique-" + credentialID),
		SignCount:      0,
		AAGUID:         []byte("aaguid-0123456789ab"),
		Transports:     []string{"internal", "hybrid"},
		Attachment:     "platform",
		BackupEligible: true,
		BackupState:    false,
	}
}

// insertSession ouvre une session sans passer par `internal/session` : ce que ces cas observent est
// le défi, pas le sceau du cookie. L'empreinte est arbitraire, seule sa clé primaire sert.
func insertSession(t *testing.T, dsn, operatorID string) string {
	t.Helper()

	var id string

	queryOn(t, dsn, `
		INSERT INTO sessions (operator_id, token_hash, expires_at)
		VALUES ($1, $2, now() + interval '12 hours')
		RETURNING id::text`, &id, operatorID, tokenHash(operatorID+time.Now().String()))

	return id
}

func registerPasskey(t *testing.T, w *store.Webauthn, operatorID, credentialID string) string {
	t.Helper()

	id, err := w.Register(t.Context(), operatorID, samplePasskey(credentialID))
	require.NoError(t, err)
	require.NotEmpty(t, id)

	return id
}

func TestUnOperateurSansPasskeyRendUneListeVideEtNonUneAbsence(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	owner, found, err := passkeys.OwnerOf(t.Context(), operator)
	require.NoError(t, err)

	// Les deux moitiés comptent : trouvé, et vide. Les confondre ferait dire « pas d'opérateur » là
	// où le fait est « aucune passkey », donc un 401 là où l'écran doit proposer un enrôlement.
	require.True(t, found)
	assert.Empty(t, owner.Passkeys)
	assert.Equal(t, "camille@exemple.test", owner.Email)
}

func TestUnOperateurDesactiveNeRendAucunProprietaire(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	registerPasskey(t, passkeys, operator, "premiere")

	execOn(t, dsn, `UPDATE operators SET status = 'disabled' WHERE id = $1`, operator)

	_, found, err := passkeys.OwnerOf(t.Context(), operator)
	require.NoError(t, err)
	assert.False(t, found, "un compte désactivé garde ses passkeys en base mais n'ouvre aucune cérémonie")
}

func TestLesPasskeysEnregistreesSeRelisentTelesQuEcrites(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	registerPasskey(t, passkeys, operator, "premiere")
	registerPasskey(t, passkeys, operator, "seconde")

	owner, found, err := passkeys.OwnerOf(t.Context(), operator)
	require.NoError(t, err)
	require.True(t, found)
	require.Len(t, owner.Passkeys, 2)

	// L'aller-retour complet, et pas seulement le compte : une colonne oubliée au `Scan` rendrait une
	// passkey que la cérémonie ne reconnaîtrait plus, sans que rien ne le dise ici.
	relu := owner.Passkeys[0]
	assert.Equal(t, []byte("clé-publique-premiere"), relu.PublicKey)
	assert.Equal(t, []string{"internal", "hybrid"}, relu.Transports)
	assert.Equal(t, "platform", relu.Attachment)
	assert.True(t, relu.BackupEligible)
	assert.False(t, relu.BackupState)
}

func TestLesPasskeysDUnAutreOperateurNeSontPasRendues(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	camille := insertOperator(t, dsn, "camille@exemple.test", "hash")
	martin := insertOperator(t, dsn, "martin@exemple.test", "hash")

	registerPasskey(t, passkeys, martin, "celle-de-martin")

	owner, found, err := passkeys.OwnerOf(t.Context(), camille)
	require.NoError(t, err)
	require.True(t, found)
	assert.Empty(t, owner.Passkeys)
}

func TestUneMemeCleNeSEnregistrePasDeuxFois(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	camille := insertOperator(t, dsn, "camille@exemple.test", "hash")
	martin := insertOperator(t, dsn, "martin@exemple.test", "hash")

	registerPasskey(t, passkeys, camille, "la-meme")

	// Même sur un autre opérateur : une passkey n'appartient qu'à un compte, et l'index est global.
	//
	// Un identifiant vide et **non une erreur** : la violation d'unicité est traduite en refus, ce qui
	// ferme un oracle — un 500 face à un 200 dirait à qui détient l'authentificateur si sa clé est
	// enrôlée quelque part dans le déploiement, fût-ce sous un autre compte.
	id, err := passkeys.Register(t.Context(), martin, samplePasskey("la-meme"))
	require.NoError(t, err)
	assert.Empty(t, id)

	owner, _, err := passkeys.OwnerOf(t.Context(), martin)
	require.NoError(t, err)
	assert.Empty(t, owner.Passkeys, "un refus ne doit rien écrire")
}

func TestLeCompteurDeSignatureNAvanceQue(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	registerPasskey(t, passkeys, operator, "premiere")

	advanced, err := passkeys.ConsumeSignCount(t.Context(), []byte("premiere"), 7, true)
	require.NoError(t, err)
	require.True(t, advanced)

	// Reculer est le signal du clonage : deux copies de la même clé privée, chacune avec son propre
	// compteur.
	advanced, err = passkeys.ConsumeSignCount(t.Context(), []byte("premiere"), 6, true)
	require.NoError(t, err)
	assert.False(t, advanced, "un compteur qui recule signale un authentificateur cloné")

	// Stagner aussi : c'est la même assertion rejouée.
	advanced, err = passkeys.ConsumeSignCount(t.Context(), []byte("premiere"), 7, true)
	require.NoError(t, err)
	assert.False(t, advanced, "un compteur qui stagne au-dessus de zéro est une assertion rejouée")

	var stored int64

	queryOn(t, dsn, `SELECT sign_count FROM webauthn_credentials WHERE credential_id = $1`,
		&stored, []byte("premiere"))
	assert.EqualValues(t, 7, stored, "un refus ne doit rien écrire")
}

// Le cas légitime que la garde doit laisser passer, et il est admis nommément : certains
// authentificateurs ne comptent pas et rendent toujours zéro. Les refuser reviendrait à refuser du
// matériel conforme, et une garde qui refuse du légitime finit retirée.
func TestUnCompteurToujoursAZeroEstAccepte(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	registerPasskey(t, passkeys, operator, "sans-compteur")

	for range 3 {
		advanced, err := passkeys.ConsumeSignCount(t.Context(), []byte("sans-compteur"), 0, false)
		require.NoError(t, err)
		assert.True(t, advanced, "un authentificateur qui ne compte pas doit rester utilisable")
	}
}

// `uvInitialized` de la spécification : une fois qu'une cérémonie a vérifié l'utilisateur, la
// propriété est acquise. L'affecter au lieu de la latcher la ferait reculer à la première assertion
// où l'appareil ne redemande rien.
func TestLaVerificationDeLUtilisateurNeRecuePas(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	registerPasskey(t, passkeys, operator, "premiere")

	_, err := passkeys.ConsumeSignCount(t.Context(), []byte("premiere"), 1, true)
	require.NoError(t, err)

	_, err = passkeys.ConsumeSignCount(t.Context(), []byte("premiere"), 2, false)
	require.NoError(t, err)

	var verified bool

	queryOn(t, dsn, `SELECT user_verified FROM webauthn_credentials WHERE credential_id = $1`,
		&verified, []byte("premiere"))
	assert.True(t, verified)
}

func TestRetirerUnePasskeyQuandIlEnResteUneAutreReussit(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	first := registerPasskey(t, passkeys, operator, "premiere")
	registerPasskey(t, passkeys, operator, "seconde")

	outcome, err := passkeys.Remove(t.Context(), operator, first)
	require.NoError(t, err)
	assert.Equal(t, store.PasskeyRemoved, outcome)

	owner, _, err := passkeys.OwnerOf(t.Context(), operator)
	require.NoError(t, err)
	assert.Len(t, owner.Passkeys, 1)
}

func TestRetirerLaDernierePasskeySansTOTPEstRefuse(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	only := registerPasskey(t, passkeys, operator, "la-seule")

	outcome, err := passkeys.Remove(t.Context(), operator, only)
	require.NoError(t, err)
	assert.Equal(t, store.PasskeyIsLastFactor, outcome,
		"retirer le dernier facteur enfermerait l'opérateur dehors")

	owner, _, err := passkeys.OwnerOf(t.Context(), operator)
	require.NoError(t, err)
	assert.Len(t, owner.Passkeys, 1, "un refus ne doit rien supprimer")
}

// Le témoin du précédent : c'est bien l'absence de tout autre facteur qui refuse, et non la dernière
// passkey en soi. Sans ce cas, une garde qui refuserait *toujours* le retrait resterait verte.
func TestRetirerLaDernierePasskeyAvecUnTOTPReussit(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	only := registerPasskey(t, passkeys, operator, "la-seule")

	execOn(t, dsn, `UPDATE operators SET mfa_totp_secret = 'v1.peu-importe' WHERE id = $1`, operator)

	outcome, err := passkeys.Remove(t.Context(), operator, only)
	require.NoError(t, err)
	assert.Equal(t, store.PasskeyRemoved, outcome)
}

func TestRetirerLaPasskeyDUnAutreOperateurNeLaTrouvePas(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	camille := insertOperator(t, dsn, "camille@exemple.test", "hash")
	martin := insertOperator(t, dsn, "martin@exemple.test", "hash")

	// Martin en a deux : le refus ne doit donc pas venir de la règle du dernier facteur.
	his := registerPasskey(t, passkeys, martin, "celle-de-martin")
	registerPasskey(t, passkeys, martin, "autre-de-martin")

	outcome, err := passkeys.Remove(t.Context(), camille, his)
	require.NoError(t, err)
	assert.Equal(t, store.PasskeyUnknown, outcome)

	owner, _, err := passkeys.OwnerOf(t.Context(), martin)
	require.NoError(t, err)
	assert.Len(t, owner.Passkeys, 2)
}

func TestUnDefiDeCeremonieSeRelitEtNeSeConsommeQuUneFois(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	session := insertSession(t, dsn, operator)

	id, err := passkeys.IssueCeremony(t.Context(), session, store.CeremonyAssertion,
		[]byte(`{"challenge":"abc"}`), testCeremonyTTL)
	require.NoError(t, err)

	live, found, err := passkeys.LiveCeremony(t.Context(), session, store.CeremonyAssertion)
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, id, live.ID)
	assert.JSONEq(t, `{"challenge":"abc"}`, string(live.Data))

	consumed, err := passkeys.ConsumeCeremony(t.Context(), id)
	require.NoError(t, err)
	require.True(t, consumed)

	consumed, err = passkeys.ConsumeCeremony(t.Context(), id)
	require.NoError(t, err)
	assert.False(t, consumed, "deux finitions concurrentes n'en font aboutir qu'une")

	_, found, err = passkeys.LiveCeremony(t.Context(), session, store.CeremonyAssertion)
	require.NoError(t, err)
	assert.False(t, found)
}

// L'objet du défi est une garde et non une étiquette : un défi d'assertion qui finirait un
// enregistrement laisserait enrôler une passkey neuve sans rien prouver.
func TestUnDefiDAssertionNeSeRelitPasCommeUnEnregistrement(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	session := insertSession(t, dsn, operator)

	_, err := passkeys.IssueCeremony(t.Context(), session, store.CeremonyAssertion,
		[]byte(`{"challenge":"abc"}`), testCeremonyTTL)
	require.NoError(t, err)

	_, found, err := passkeys.LiveCeremony(t.Context(), session, store.CeremonyRegistration)
	require.NoError(t, err)
	assert.False(t, found)
}

func TestLeDefiDUneAutreSessionNeSeRelitPas(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	mine := insertSession(t, dsn, operator)
	other := insertSession(t, dsn, operator)

	_, err := passkeys.IssueCeremony(t.Context(), other, store.CeremonyAssertion,
		[]byte(`{"challenge":"abc"}`), testCeremonyTTL)
	require.NoError(t, err)

	// Le même opérateur, et pourtant non : une cérémonie ne traverse pas deux sessions.
	_, found, err := passkeys.LiveCeremony(t.Context(), mine, store.CeremonyAssertion)
	require.NoError(t, err)
	assert.False(t, found)
}

// Un seul défi vivant par session et par objet. Deux onglets rendraient sinon indécidable celui que
// la finition doit relire, et le choisir par sa date ferait dépendre une garde d'un tri.
func TestOuvrirUneCeremonieEteintCelleQuElleRemplace(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	session := insertSession(t, dsn, operator)

	first, err := passkeys.IssueCeremony(t.Context(), session, store.CeremonyAssertion,
		[]byte(`{"challenge":"premier"}`), testCeremonyTTL)
	require.NoError(t, err)

	second, err := passkeys.IssueCeremony(t.Context(), session, store.CeremonyAssertion,
		[]byte(`{"challenge":"second"}`), testCeremonyTTL)
	require.NoError(t, err)

	live, found, err := passkeys.LiveCeremony(t.Context(), session, store.CeremonyAssertion)
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, second, live.ID)

	consumed, err := passkeys.ConsumeCeremony(t.Context(), first)
	require.NoError(t, err)
	assert.False(t, consumed, "le défi remplacé est déjà éteint")
}

func TestUnDefiEchuNeSeRelitPas(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	session := insertSession(t, dsn, operator)

	id, err := passkeys.IssueCeremony(t.Context(), session, store.CeremonyRegistration,
		[]byte(`{"challenge":"abc"}`), testCeremonyTTL)
	require.NoError(t, err)

	// La naissance recule avec l'échéance : le `CHECK` de la migration refuse une échéance antérieure
	// à la création, et il a mordu la première rédaction de ce cas.
	execOn(t, dsn, `UPDATE webauthn_challenges
		SET created_at = now() - interval '10 minutes', expires_at = now() - interval '1 second'
		WHERE id = $1`, id)

	_, found, err := passkeys.LiveCeremony(t.Context(), session, store.CeremonyRegistration)
	require.NoError(t, err)
	assert.False(t, found)

	consumed, err := passkeys.ConsumeCeremony(t.Context(), id)
	require.NoError(t, err)
	assert.False(t, consumed, "un défi échu ne se consomme pas non plus")
}

func TestFermerUneSessionEmporteSesDefis(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	session := insertSession(t, dsn, operator)

	_, err := passkeys.IssueCeremony(t.Context(), session, store.CeremonyAssertion,
		[]byte(`{"challenge":"abc"}`), testCeremonyTTL)
	require.NoError(t, err)

	execOn(t, dsn, `DELETE FROM sessions WHERE id = $1`, session)

	var remaining int64

	queryOn(t, dsn, `SELECT count(*) FROM webauthn_challenges WHERE session_id = $1`,
		&remaining, session)
	assert.Zero(t, remaining, "une cérémonie n'a pas à survivre à la session qui l'a ouverte")
}

// Deux retraits concurrents de deux passkeys distinctes ne doivent pas emporter les deux.
//
// La séquence est **forcée**, et non confiée à deux goroutines lancées ensemble : mesuré, une course
// libre ne se produit jamais et le test passait sur le code fautif. C'est le décor qui tient le
// verrou et libère au bon moment ; la fonction sous test, elle, est bien `Remove`.
//
// L'attente est observée dans `pg_locks` plutôt que temporisée : une temporisation rendrait le test
// vert sur une machine lente sans que rien n'ait été exercé.
func TestUnRetraitConcurrentNEmportePasLaDernierePasskey(t *testing.T) {
	t.Parallel()

	passkeys, dsn := webauthnOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")
	first := registerPasskey(t, passkeys, operator, "premiere")
	second := registerPasskey(t, passkeys, operator, "seconde")

	ctx := t.Context()

	decor, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)

	defer func() { _ = decor.Close(context.WithoutCancel(ctx)) }()

	watcher, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)

	defer func() { _ = watcher.Close(context.WithoutCancel(ctx)) }()

	// Le décor prend le verrou de l'opérateur et supprime la première passkey, sans commiter.
	held, err := decor.Begin(ctx)
	require.NoError(t, err)

	var locked int

	require.NoError(t, held.QueryRow(ctx,
		`SELECT 1 FROM operators WHERE id = $1 FOR UPDATE`, operator).Scan(&locked))
	_, err = held.Exec(ctx, `DELETE FROM webauthn_credentials WHERE id = $1`, first)
	require.NoError(t, err)

	// Le retrait de la seconde part maintenant : il va buter sur le verrou.
	outcome := make(chan store.PasskeyRemoval, 1)

	go func() {
		removal, removeErr := passkeys.Remove(context.WithoutCancel(ctx), operator, second)
		assert.NoError(t, removeErr)
		outcome <- removal
	}()

	require.Eventually(t, func() bool {
		var waiting int
		require.NoError(t, watcher.QueryRow(ctx,
			`SELECT count(*) FROM pg_locks WHERE NOT granted`).Scan(&waiting))

		return waiting > 0
	}, 5*time.Second, 20*time.Millisecond,
		"le retrait n'a jamais attendu de verrou : la séquence n'exerce pas la course")

	require.NoError(t, held.Commit(ctx))

	// Débloqué, il doit voir qu'il ne reste qu'une passkey — celle qu'il allait retirer.
	assert.Equal(t, store.PasskeyIsLastFactor, <-outcome,
		"le retrait a compté la passkey que la transaction précédente venait de supprimer : "+
			"l'opérateur se retrouve sans aucun second facteur")

	owner, _, err := passkeys.OwnerOf(ctx, operator)
	require.NoError(t, err)
	assert.Len(t, owner.Passkeys, 1)
}
