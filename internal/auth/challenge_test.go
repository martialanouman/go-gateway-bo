package auth_test

import (
	"crypto/sha256"
	"encoding/base64"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
)

// canonicalChallenge est un challenge tel que `Login` en émet : trente-deux octets encodés en
// base64url sans remplissage, donc quarante-trois caractères.
const canonicalChallenge = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

func TestUnChallengeCanoniqueRendLEmpreinteQueLaBasePorte(t *testing.T) {
	t.Parallel()

	digest, ok := auth.ChallengeDigest(canonicalChallenge)
	require.True(t, ok)

	token, err := base64.RawURLEncoding.DecodeString(canonicalChallenge)
	require.NoError(t, err)

	expected := sha256.Sum256(token)
	assert.Equal(t, expected[:], digest)
}

// **La garde de `Strict()`, qui n'était tenue par rien.** Le jeton fait trente-deux octets, donc
// quarante-trois caractères base64url dont le **dernier ne porte que deux bits significatifs** : sans
// ce contrôle, quatre valeurs distinctes décodent vers les mêmes octets, donc quatre challenges
// différents seraient acceptés pour une seule ligne.
//
// C'est le piège que ce dépôt a déjà payé en step-022, sur le sceau du cookie. Là-bas la garde a son
// test ; ici elle n'en avait aucun — mesuré le 12/08/2026, retirer `Strict()` laissait toutes les
// suites et les quarante-deux scénarios verts.
func TestUnChallengeNonCanoniqueNEstPasLeMemeChallenge(t *testing.T) {
	t.Parallel()

	// Les trois autres encodages des mêmes octets. Le dernier caractère de `canonicalChallenge` est
	// `A` (bits de remplissage nuls) ; `B`, `C` et `D` ne diffèrent que par ces bits.
	for _, variant := range []string{"B", "C", "D"} {
		presented := canonicalChallenge[:len(canonicalChallenge)-1] + variant

		t.Run(presented[len(presented)-1:], func(t *testing.T) {
			t.Parallel()

			// Le témoin : sans `Strict()`, ces trois valeurs décodent bien vers les **mêmes** octets que
			// la canonique. Sans lui, ce cas passerait aussi sur un décodeur qui les refuserait pour une
			// tout autre raison — une longueur, un caractère hors alphabet.
			relaxed, err := base64.RawURLEncoding.DecodeString(presented)
			require.NoError(t, err, "la variante n'est même pas du base64 : le cas ne prouverait rien")

			canonical, err := base64.RawURLEncoding.DecodeString(canonicalChallenge)
			require.NoError(t, err)
			require.Equal(t, canonical, relaxed, "la variante ne décode pas vers les mêmes octets")

			_, ok := auth.ChallengeDigest(presented)
			assert.False(t, ok, "un challenge non canonique est accepté : quatre valeurs distinctes "+
				"ouvriraient la même ligne")
		})
	}
}

// La longueur exacte est l'autre moitié : une valeur plus courte ou plus longue n'a pas la forme d'un
// jeton émis ici, et l'empreinte qu'elle produirait ne correspondrait de toute façon à aucune ligne.
// Ce que ce refus achète est de ne pas offrir un aller-retour PostgreSQL à qui envoie n'importe quoi.
func TestUneValeurQuiNaPasLaFormeDUnChallengeEstRefusee(t *testing.T) {
	t.Parallel()

	for name, presented := range map[string]string{
		"vide":             "",
		"trop court":       "AAAA",
		"trop long":        canonicalChallenge + "AAAA",
		"pas du base64url": "ceci n'est pas du base64 !",
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			digest, ok := auth.ChallengeDigest(presented)
			assert.False(t, ok)
			assert.Nil(t, digest)
		})
	}
}
