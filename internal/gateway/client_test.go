package gateway_test

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/martialanouman/go-gateway-bo/internal/gateway"
)

// recordedRequest garde d'une requête reçue ce que les tests observent, jamais le corps : le
// harnais n'a pas de raison d'en savoir plus que la frontière réseau.
type recordedRequest struct {
	method        string
	path          string
	authorization string
	clientCerts   int
	// scope est ce que la requête d'obtention de jeton demande. Sur une lecture de l'API, où il n'y a
	// pas de corps de formulaire, il reste vide.
	scope string
}

// recorder est la frontière du système sous test : tout ce qu'un test affirme du client se lit dans
// les requêtes qui sont **arrivées**, jamais dans un interne qu'on lui aurait injecté.
type recorder struct {
	mu       sync.Mutex
	received []recordedRequest
}

func (r *recorder) record(req *http.Request) {
	entry := recordedRequest{
		method:        req.Method,
		path:          req.URL.Path,
		authorization: req.Header.Get("Authorization"),
		scope:         req.PostFormValue("scope"),
	}

	if req.TLS != nil {
		entry.clientCerts = len(req.TLS.PeerCertificates)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	r.received = append(r.received, entry)
}

func (r *recorder) snapshot() []recordedRequest {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]recordedRequest(nil), r.received...)
}

func (r *recorder) count() int {
	return len(r.snapshot())
}

func TestAdminClientAuthenticatesWithoutTokenEndpointInMockMode(t *testing.T) {
	t.Parallel()

	var api recorder

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		api.record(req)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	client, err := gateway.NewAdminClient(config.GatewayConfig{
		Mode:    config.GatewayModeMock,
		BaseURL: server.URL,
		Timeout: 5 * time.Second,
	})
	require.NoError(t, err)

	_, err = client.ListCustomersWithResponse(t.Context(), nil)
	require.NoError(t, err)

	received := api.snapshot()
	require.Len(t, received, 1)
	assert.Equal(t, "/admin/customers", received[0].path)
	// Le motif exige un jeton **non vide** : `Bearer ` tout seul passerait un simple préfixe, et
	// c'est exactement ce que produirait une source de jeton oubliée.
	assert.Regexp(t, `^Bearer \S+$`, received[0].authorization,
		"Prism applique le security global du contrat et refuse une requête sans en-tête "+
			"Authorization : le mode mock doit donc porter un jeton, fût-il factice")
}

// Le matériel mTLS est lu au démarrage, et un manque doit **empêcher le lancement** en nommant le
// fichier fautif (§1.8) : un BFF qui démarre puis échoue à la première requête laisse croire que
// l'installation est bonne. Aucune de ces erreurs ne porte le secret client, qui n'entre pas ici.
func TestAdminClientRefusesIncompleteMutualTLSMaterial(t *testing.T) {
	t.Parallel()

	pki := newTestPKI(t)

	withGateway := func(mutate func(*config.GatewayConfig)) config.GatewayConfig {
		cfg := config.GatewayConfig{
			Mode:         config.GatewayModeReal,
			BaseURL:      "https://passerelle.test/v1",
			TokenURL:     "https://passerelle.test/token",
			ClientID:     "tableau-de-bord",
			ClientSecret: "secret-de-test",
			ClientCert:   pki.clientCertFile,
			ClientKey:    pki.clientKeyFile,
			CACert:       pki.caFile,
			Timeout:      time.Second,
		}
		mutate(&cfg)

		return cfg
	}

	cases := []struct {
		name    string
		mutate  func(*config.GatewayConfig)
		nameSin string
	}{
		{
			name:    "refuse un certificat client introuvable",
			mutate:  func(cfg *config.GatewayConfig) { cfg.ClientCert = "/introuvable/client.pem" },
			nameSin: "certificat/clé client",
		},
		{
			name:    "refuse une autorité introuvable",
			mutate:  func(cfg *config.GatewayConfig) { cfg.CACert = "/introuvable/ca.pem" },
			nameSin: "autorité de certification",
		},
		{
			name: "refuse une autorité qui ne contient aucun certificat",
			mutate: func(cfg *config.GatewayConfig) {
				cfg.CACert = write(t, t.TempDir(), "vide.pem", []byte("ceci n'est pas du PEM\n"))
			},
			nameSin: "aucun certificat PEM",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			client, err := gateway.NewAdminClient(withGateway(testCase.mutate))

			require.Error(t, err)
			assert.Nil(t, client)
			assert.Contains(t, err.Error(), testCase.nameSin,
				"le message doit dire quel matériel manque : sinon l'exploitant relit les six variables")
			assert.NotContains(t, err.Error(), "secret-de-test", "un secret ne sort pas dans une erreur")
		})
	}
}
