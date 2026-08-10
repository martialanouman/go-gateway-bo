package bff

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// `retryAfterSeconds` et `humanDelay` sont des primitives écrites à la main, et jusqu'ici un seul cas
// les exerçait — 900 secondes, à travers un `strings.Contains` de scénario qui n'accepte que la
// présence du mot « minute ». Une inversion de chiffres dans `itoa` aurait rendu « 51 minutes » sans
// qu'aucune porte ne bouge. Ce sont les « mécanismes aux limites » que la charte range en unitaires.
func TestLaDureeAnnonceeArrondItToujoursAuSuperieur(t *testing.T) {
	t.Parallel()

	cases := map[string]struct {
		remaining time.Duration
		seconds   int
		spoken    string
	}{
		// L'arrondi au supérieur : jamais faire revenir l'opérateur trop tôt.
		"une seconde et des poussières": {1100 * time.Millisecond, 2, "2 secondes"},
		"juste sous la minute":          {59 * time.Second, 59, "59 secondes"},
		"une minute pile":               {60 * time.Second, 60, "1 minute"},
		"une seconde de plus":           {61 * time.Second, 61, "2 minutes"},
		"le verrou entier":              {15 * time.Minute, 900, "15 minutes"},
		// Le singulier se dit au singulier : « 1 minutes » se lit comme un bug.
		"une seconde":     {time.Second, 1, "1 seconde"},
		"deux chiffres":   {12 * time.Minute, 720, "12 minutes"},
		"trois chiffres":  {150 * time.Minute, 9000, "150 minutes"},
		"un reste infime": {100 * time.Millisecond, 1, "1 seconde"},
	}

	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			seconds := retryAfterSeconds(testCase.remaining)
			assert.Equal(t, testCase.seconds, seconds, "l'en-tête Retry-After annonce autre chose")
			assert.Equal(t, testCase.spoken, humanDelay(seconds), "la phrase annonce autre chose que l'en-tête")
		})
	}
}

// Le contrat déclare `minimum: 1` sur `Retry-After`, et un `Retry-After: 0` dirait « réessaie tout de
// suite » à l'instant même où l'on vient de refuser. La branche est **inatteignable** depuis `Login`
// — `lockedResponse` n'est appelée que sur un verrou dont `Remaining` est strictement positif — et
// c'est pourquoi elle est exercée ici directement plutôt que par un scénario.
func TestUneDureeNulleOuNegativeNAnnonceJamaisZero(t *testing.T) {
	t.Parallel()

	assert.Equal(t, 1, retryAfterSeconds(0))
	assert.Equal(t, 1, retryAfterSeconds(-time.Minute))
}

// La promesse écrite au-dessus de `lockedResponse` : l'en-tête et la phrase sortent du **même**
// arrondi. Sans ce test, poser `RetryAfter: 1` en laissant « 15 minutes » dans le message laissait
// tout vert — le scénario ne vérifie que la présence du mot « minute », et kin-openapi accepte 1.
func TestLEnTeteEtLaPhraseAnnoncentLaMemeDuree(t *testing.T) {
	t.Parallel()

	response := lockedResponse(14*time.Minute + 30*time.Second)

	assert.Equal(t, 870, response.Headers.RetryAfter)
	assert.Contains(t, response.Body.Message, humanDelay(response.Headers.RetryAfter),
		"un client qui lit l'en-tête et un opérateur qui lit la phrase voient deux nombres différents")
}
