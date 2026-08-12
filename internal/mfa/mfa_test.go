package mfa_test

import (
	"net/url"
	"testing"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/hotp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/mfa"
)

// Les trois valeurs du décor. La passphrase a la longueur qu'exige la configuration et rien d'un
// secret d'installation ; le pas est un nombre plausible et fixe, pour que rien ici ne dépende d'une
// horloge.
const (
	testPassphrase = "une-cle-de-chiffrement-de-test-assez-longue"
	testOperatorID = "01900000-0000-7000-8000-000000000001"
	testAccount    = "alice@exemple.test"
	testStep       = 58_000_000
)

func testAuthenticator(t *testing.T) *mfa.Authenticator {
	t.Helper()

	authenticator, err := mfa.NewAuthenticator([]byte(testPassphrase))
	require.NoError(t, err)

	return authenticator
}

func testEnrollment(t *testing.T) (*mfa.Authenticator, mfa.Enrollment) {
	t.Helper()

	authenticator := testAuthenticator(t)

	enrollment, err := authenticator.Enroll(testOperatorID, testAccount)
	require.NoError(t, err)

	return authenticator, enrollment
}

// codeAt fabrique le code d'un pas donné comme le ferait l'application de l'opérateur.
func codeAt(t *testing.T, secret string, step int64) string {
	t.Helper()

	code, err := hotp.GenerateCodeCustom(secret, uint64(step), hotp.ValidateOpts{
		Digits:    otp.DigitsSix,
		Algorithm: otp.AlgorithmSHA1,
	})
	require.NoError(t, err)

	return code
}

func TestUnCodeDuPasCourantEstAccepte(t *testing.T) {
	t.Parallel()

	authenticator, enrollment := testEnrollment(t)

	matched, ok, err := authenticator.Verify(enrollment.SealedSecret, testOperatorID,
		codeAt(t, enrollment.Secret, testStep), testStep)

	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, int64(testStep), matched, "le pas rendu n'est pas celui qui a validé le code")
}

// La fenêtre existe pour le téléphone qui dérive de quelques secondes. Sans elle — c'est le défaut
// de la bibliothèque — un opérateur dont l'horloge avance d'une seconde serait refusé une fois sur
// trente.
func TestUnCodeDuPasVoisinEstAccepte(t *testing.T) {
	t.Parallel()

	authenticator, enrollment := testEnrollment(t)

	for name, step := range map[string]int64{
		"le téléphone retarde": testStep - 1,
		"le téléphone avance":  testStep + 1,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			matched, ok, err := authenticator.Verify(enrollment.SealedSecret, testOperatorID,
				codeAt(t, enrollment.Secret, step), testStep)

			require.NoError(t, err)
			assert.True(t, ok)
			// Le pas **rendu** est celui du voisin et non le courant : c'est lui que l'anti-rejeu
			// mémorisera, sans quoi le code du pas suivant serait refusé comme un rejeu.
			assert.Equal(t, step, matched)
		})
	}
}

// La borne haute de la fenêtre. Deux pas doubleraient la durée pendant laquelle un code intercepté
// vaut encore quelque chose.
func TestUnCodeADeuxPasEstRefuse(t *testing.T) {
	t.Parallel()

	authenticator, enrollment := testEnrollment(t)

	for name, step := range map[string]int64{
		"deux pas en arrière": testStep - 2,
		"deux pas en avant":   testStep + 2,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			_, ok, err := authenticator.Verify(enrollment.SealedSecret, testOperatorID,
				codeAt(t, enrollment.Secret, step), testStep)

			require.NoError(t, err)
			assert.False(t, ok)
		})
	}
}

// Ce que la bibliothèque rend pour une longueur inattendue est une **erreur**, et la traiter comme
// telle ferait rendre 500 à qui tape cinq chiffres — donc transformerait une faute de frappe en
// incident.
func TestUnCodeMalFormeEstUnRefusEtNonUnePanne(t *testing.T) {
	t.Parallel()

	authenticator, enrollment := testEnrollment(t)

	for name, code := range map[string]string{
		"trop court":  "12345",
		"trop long":   "1234567",
		"vide":        "",
		"pas chiffré": "abcdef",
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			_, ok, err := authenticator.Verify(enrollment.SealedSecret, testOperatorID, code, testStep)

			require.NoError(t, err, "un code mal formé est remonté comme une panne")
			assert.False(t, ok)
		})
	}
}

func TestDeuxEnrolementsNeProduisentPasLeMemeSecret(t *testing.T) {
	t.Parallel()

	authenticator := testAuthenticator(t)

	first, err := authenticator.Enroll(testOperatorID, testAccount)
	require.NoError(t, err)

	second, err := authenticator.Enroll(testOperatorID, testAccount)
	require.NoError(t, err)

	assert.NotEqual(t, first.Secret, second.Secret)
	assert.NotEqual(t, first.RecoveryCodes, second.RecoveryCodes)
}

// Ce que step-028 dessinera. Les quatre paramètres sont **écrits** dans l'URI plutôt que laissés au
// défaut : beaucoup d'applications les ignorent et supposent les mêmes valeurs, mais celles qui les
// lisent doivent lire ce que le serveur vérifie.
func TestLUriOtpauthPorteCeQueLApplicationAttend(t *testing.T) {
	t.Parallel()

	_, enrollment := testEnrollment(t)

	parsed, err := url.Parse(enrollment.OtpauthURI)
	require.NoError(t, err)

	assert.Equal(t, "otpauth", parsed.Scheme)
	assert.Equal(t, "totp", parsed.Host)
	assert.Contains(t, parsed.Path, testAccount)

	query := parsed.Query()
	assert.Equal(t, enrollment.Secret, query.Get("secret"),
		"l'URI et la saisie manuelle ne portent pas le même secret")
	assert.Equal(t, "SHA1", query.Get("algorithm"))
	assert.Equal(t, "6", query.Get("digits"))
	assert.Equal(t, "30", query.Get("period"))
	assert.NotEmpty(t, query.Get("issuer"))
}
