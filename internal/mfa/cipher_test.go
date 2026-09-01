package mfa_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/mfa"
)

// Ce que la fiche exige de vérifier : la colonne lue en base n'est **pas** un secret utilisable.
func TestCeQuiVaEnBaseNEstPasLeSecretEnClair(t *testing.T) {
	t.Parallel()

	_, enrollment := testEnrollment(t)

	assert.NotEqual(t, enrollment.Secret, enrollment.SealedSecret)
	assert.NotContains(t, enrollment.SealedSecret, enrollment.Secret,
		"le secret en clair se lit dans la valeur stockée")
	assert.True(t, strings.HasPrefix(enrollment.SealedSecret, "v1."),
		"la valeur stockée ne porte pas la marque de son format : une rotation ne saurait pas la relire")
}

// **La garde des données associées.** Recopier la colonne d'une ligne sur une autre est un `UPDATE`
// d'une ligne, et sans cette garde il donnerait à un opérateur le second facteur d'un autre — un
// chiffré ne sait pas à qui il appartient.
func TestUnSecretDeplaceSurUneAutreLigneNeSeDechiffrePas(t *testing.T) {
	t.Parallel()

	authenticator, enrollment := testEnrollment(t)

	const otherOperatorID = "01900000-0000-7000-8000-000000000002"

	_, _, err := authenticator.Verify(enrollment.SealedSecret, otherOperatorID,
		codeAt(t, enrollment.Secret, testStep), testStep)

	var unreadable mfa.UnreadableSecretError
	require.ErrorAs(t, err, &unreadable,
		"le secret d'un autre opérateur a été déchiffré, ou l'échec s'est déguisé en refus")
}

// Une colonne abîmée n'est pas un code mal tapé. Les confondre enverrait l'opérateur retenter
// indéfiniment pendant que personne ne regarde la base — même arbitrage que `auth.MalformedHashError`.
func TestUneValeurStockeeAbimeeEstUnePanneEtNonUnRefus(t *testing.T) {
	t.Parallel()

	authenticator, enrollment := testEnrollment(t)

	// Le premier caractère après le préfixe : altérer la fin ne changerait que des bits de
	// remplissage que `Strict()` refuse, ce qui ferait passer le test pour la mauvaise raison.
	altered := "v1." + flipFirst(strings.TrimPrefix(enrollment.SealedSecret, "v1."))

	for name, stored := range map[string]string{
		"le chiffré est altéré":  altered,
		"le préfixe a disparu":   strings.TrimPrefix(enrollment.SealedSecret, "v1."),
		"ce n'est pas du base64": "v1.pas du base64 !",
		"c'est trop court":       "v1.AAAA",
		"c'est vide":             "",
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			_, _, err := authenticator.Verify(stored, testOperatorID, "123456", testStep)

			var unreadable mfa.UnreadableSecretError
			require.ErrorAs(t, err, &unreadable)
		})
	}
}

// Le message remonte dans un journal. Ce n'est qu'un chiffré, mais rien n'oblige à y verser le
// contenu d'une colonne de second facteur — même règle que `auth.MalformedHashError`.
//
// La valeur est distinctive : sur une chaîne vide, `NotContains` serait vrai de n'importe quel
// message et le test passerait sans rien exiger.
func TestLeRefusNeRecopiePasLaValeurQuIlRefuse(t *testing.T) {
	t.Parallel()

	authenticator := testAuthenticator(t)

	const stored = "v1.QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo"

	_, _, err := authenticator.Verify(stored, testOperatorID, "123456", testStep)

	var unreadable mfa.UnreadableSecretError
	require.ErrorAs(t, err, &unreadable)
	assert.NotContains(t, unreadable.Error(), "QUJDREVG")
}

// La passphrase est étirée par HKDF, donc la même passphrase doit rendre la même clé — sinon un
// redémarrage suffirait à enfermer tout le monde dehors.
func TestUneMemePassphraseRelitCeQuUneAutreInstanceAEcrit(t *testing.T) {
	t.Parallel()

	_, enrollment := testEnrollment(t)

	other := testAuthenticator(t)

	_, ok, err := other.Verify(enrollment.SealedSecret, testOperatorID,
		codeAt(t, enrollment.Secret, testStep), testStep)

	require.NoError(t, err, "deux instances portant la même passphrase ne dérivent pas la même clé")
	assert.True(t, ok)
}

// Et l'inverse : changer la passphrase rend illisibles les secrets déjà en base. C'est le prix que le
// README annonce, vérifié plutôt qu'affirmé.
func TestUneAutrePassphraseNeRelitRien(t *testing.T) {
	t.Parallel()

	_, enrollment := testEnrollment(t)

	other, err := mfa.NewAuthenticator([]byte("une-autre-cle-de-chiffrement-assez-longue"), testIssuer)
	require.NoError(t, err)

	_, _, err = other.Verify(enrollment.SealedSecret, testOperatorID,
		codeAt(t, enrollment.Secret, testStep), testStep)

	var unreadable mfa.UnreadableSecretError
	require.ErrorAs(t, err, &unreadable)
}

// Deux enrôlements ne produisent pas la même valeur stockée. **Ce test ne garde pas le nonce** — il
// compare les chiffrés de deux secrets **différents**, ce qui est vrai quel que soit le nonce : mesuré
// le 12/08/2026, douze zéros constants le laissaient vert. Le nonce est gardé par
// `TestDeuxChiffrementsDuMemeSecretSousLaMemeCleDifferent`, qui vit dans le paquet parce que `seal`
// n'est pas exporté.
//
// Ce qu'il garde, lui : que l'enrôlement tire bien un secret neuf à chaque fois.
func TestDeuxEnrolementsNeStockentPasLaMemeValeur(t *testing.T) {
	t.Parallel()

	authenticator := testAuthenticator(t)

	first, err := authenticator.Enroll(testOperatorID, testAccount)
	require.NoError(t, err)

	second, err := authenticator.Enroll(testOperatorID, testAccount)
	require.NoError(t, err)

	assert.NotEqual(t, first.SealedSecret, second.SealedSecret)
}

// flipFirst remplace le premier caractère par un autre de l'alphabet base64url.
func flipFirst(encoded string) string {
	if encoded == "" {
		return "A"
	}

	replacement := byte('A')
	if encoded[0] == replacement {
		replacement = 'B'
	}

	return string(replacement) + encoded[1:]
}
