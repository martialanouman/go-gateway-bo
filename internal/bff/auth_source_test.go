package bff

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Le défaut que ce test rejoue : `http.Header.Get` ne rend que la **première** ligne d'un en-tête, et
// Go ne fusionne pas les lignes répétées. Tous les proxys n'ajoutent pas au même en-tête — HAProxy
// `option forwardfor` en écrit une seconde. Chez un tel proxy, lire `Get` rendrait la ligne écrite
// par le client, avant la nôtre : la remontée de droite à gauche s'appliquerait alors à une chaîne
// entièrement forgée, et l'attaquant choisirait sa clé de compteur — ou celle d'un tiers.
func TestUneSecondeLigneForwardedForNeMasquePasCelleDuProxy(t *testing.T) {
	t.Parallel()

	var (
		seen  string
		found bool
	)

	// Le verdict est **relevé** dans le handler et affirmé après : `require` arrête la goroutine où il
	// s'exécute, et celle d'un handler n'est pas celle du test — l'échec y serait silencieux.
	handler := withClientAddress([]netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")})(
		http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			seen, found = clientAddressFrom(r.Context())
		}))

	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	request.RemoteAddr = "10.0.0.5:443"
	// La ligne du client arrive en premier ; celle du proxy est ajoutée derrière.
	request.Header.Add("X-Forwarded-For", "198.51.100.9")
	request.Header.Add("X-Forwarded-For", "203.0.113.7")

	handler.ServeHTTP(httptest.NewRecorder(), request)

	require.True(t, found, "aucune adresse cliente n'a été posée")
	assert.Equal(t, "203.0.113.7", seen,
		"seule la première ligne a été lue : le client choisit sa clé de compteur en en forgeant une")
}
