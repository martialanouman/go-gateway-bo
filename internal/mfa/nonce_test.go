package mfa

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// **Ce fichier est en `package mfa` et non `mfa_test`, et c'est la raison même de son existence.**
//
// `TestDeuxChiffrementsDuMemeSecretDifferent`, dans la suite externe, appelait `Enroll` deux fois : il
// comparait donc les chiffrés de **deux secrets différents**, ce qui est vrai quel que soit le nonce.
// Mesuré le 12/08/2026 : un nonce de douze zéros constants le laissait vert. La dérive venait de ce
// que `seal` n'est pas exporté — la suite externe ne pouvait pas fixer le secret.
//
// Ce qu'un nonce constant coûterait sous GCM n'est pas une faiblesse théorique : deux secrets chiffrés
// sous la même clé et le même nonce se déchiffrent l'un par l'autre, et la clé d'authentification se
// retrouve. C'est la faute la plus courte pour perdre à la fois la confidentialité et l'intégrité.
func TestDeuxChiffrementsDuMemeSecretSousLaMemeCleDifferent(t *testing.T) {
	t.Parallel()

	authenticator, err := NewAuthenticator([]byte("une-cle-de-chiffrement-de-test-assez-longue"))
	require.NoError(t, err)

	const (
		secret     = "JBSWY3DPEHPK3PXP"
		operatorID = "01900000-0000-7000-8000-000000000001"
	)

	first, err := authenticator.seal(secret, operatorID)
	require.NoError(t, err)

	second, err := authenticator.seal(secret, operatorID)
	require.NoError(t, err)

	assert.NotEqual(t, first, second, "deux chiffrements du même secret sous la même clé coïncident : "+
		"le nonce ne change pas")

	// Le témoin : les deux se relisent bien vers le secret de départ. Sans lui, un `seal` qui rendrait
	// une valeur aléatoire sans rapport passerait ce test.
	for _, sealed := range []string{first, second} {
		opened, openErr := authenticator.open(sealed, operatorID)
		require.NoError(t, openErr)
		assert.Equal(t, secret, opened)
	}
}
