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

// Le mode est ce qui décide du mTLS et du jeton : la valeur zéro doit tomber du côté strict.
//
// `config.Load` replie l'absence sur `real` et refuse tout autre littéral, mais cette polarité ne
// traverse pas la frontière du package — NewAdminClient prend une struct nue, que les tests
// construisent déjà à la main et qu'un helper de step-004 construira partiellement. Un `Mode` vide
// qui prendrait le chemin `mock` joindrait une passerelle de production sans certificat client et
// avec le jeton factice en en-tête.
func TestAdminClientRefusesAnUnknownGatewayMode(t *testing.T) {
	t.Parallel()

	for _, mode := range []config.GatewayMode{"", "prod", "REAL", " mock"} {
		t.Run(string(mode), func(t *testing.T) {
			t.Parallel()

			client, err := gateway.NewAdminClient(config.GatewayConfig{
				Mode:    mode,
				BaseURL: "https://admin.gateway.internal/v1",
				Timeout: time.Second,
			})

			require.Error(t, err,
				"un mode que le package ne connaît pas ne doit pas retomber sur le chemin permissif")
			assert.Nil(t, client)
			assert.Contains(t, err.Error(), string(config.GatewayModeReal))
			assert.Contains(t, err.Error(), string(config.GatewayModeMock))
		})
	}
}

// La même frontière que le test voisin, sur l'autre moitié de la configuration : `config.Load`
// refuse déjà une passerelle réelle jointe en clair, mais cette polarité s'arrête à l'environnement.
// NewAdminClient prend une struct nue, et un `http://` qui la traverse ne casse rien de visible —
// http.Transport ne consulte pas son tls.Config, le matériel mTLS est chargé, posé, jamais présenté.
//
// Mesuré le 02/08/2026 avant cette garde, en mode `real` avec un matériel mTLS valide et les deux
// bouts en clair : `NewAdminClient` rend nil, l'API reçoit `Bearer jeton-machine-1` et
// `clientCerts:0`, et le tokenUrl reçoit `Basic ZGFzaGJvYXJkOnNlY3JldA==` — le secret client en
// Base64 sur le fil, avec les cinq scopes dont `gdpr:erase`.
func TestAdminClientRefusesAPlaintextGatewayInRealMode(t *testing.T) {
	t.Parallel()

	pki := newTestPKI(t)

	withGateway := func(baseURL, tokenURL string) config.GatewayConfig {
		return config.GatewayConfig{
			Mode:         config.GatewayModeReal,
			BaseURL:      baseURL,
			TokenURL:     tokenURL,
			ClientID:     "tableau-de-bord",
			ClientSecret: "secret-de-test",
			ClientCert:   pki.clientCertFile,
			ClientKey:    pki.clientKeyFile,
			CACert:       pki.caFile,
			Timeout:      time.Second,
		}
	}

	t.Run("refuse une API jointe en clair", func(t *testing.T) {
		t.Parallel()

		client, err := gateway.NewAdminClient(
			withGateway("http://passerelle.test/v1", "https://passerelle.test/token"))

		require.Error(t, err,
			"le jeton machine et ses cinq scopes partiraient en clair, mTLS chargé et jamais présenté")
		assert.Nil(t, client)
		assert.Contains(t, err.Error(), "http://passerelle.test/v1",
			"le message doit nommer l'URL fautive : sinon l'exploitant relit les deux")
		assert.NotContains(t, err.Error(), "secret-de-test", "un secret ne sort pas dans une erreur")
	})

	t.Run("refuse un tokenUrl joint en clair", func(t *testing.T) {
		t.Parallel()

		client, err := gateway.NewAdminClient(
			withGateway("https://passerelle.test/v1", "http://passerelle.test/token"))

		require.Error(t, err,
			"c'est là que part le secret client en Basic ; en clair, il est lisible sur le fil")
		assert.Nil(t, client)
		assert.Contains(t, err.Error(), "http://passerelle.test/token")
		assert.NotContains(t, err.Error(), "secret-de-test", "un secret ne sort pas dans une erreur")
	})

	// Le schéma d'une URL est insensible à la casse, et net/url le minuscule à l'analyse
	// ($GOROOT/src/net/url/url.go:454). Refuser `HTTPS://` refuserait une passerelle parfaitement
	// joignable, et une garde qui refuse du légitime finit par être retirée.
	t.Run("accepte un schéma en majuscules", func(t *testing.T) {
		t.Parallel()

		client, err := gateway.NewAdminClient(
			withGateway("HTTPS://passerelle.test/v1", "HTTPS://passerelle.test/token"))

		require.NoError(t, err)
		assert.NotNil(t, client)
	})
}

// NewAdminClient lit le matériel mTLS à la construction et refuse en nommant le fichier fautif
// (§1.8), plutôt que de rendre un client qui échouera à sa première requête. Aucune de ces erreurs
// ne porte le secret client, qui n'entre pas ici.
//
// **Ce que ce test ne prouve pas, et que la §1.8 demande pourtant** : que ce refus arrive au
// démarrage. Mesuré le 02/08/2026 — `internal/gateway` n'a aucun importeur hors de lui-même,
// `NewAdminClient` n'est appelé par aucun code de production, et `run()` de `cmd/dashboard/main.go`
// enchaîne `config.Load` → `webassets.FS` → `net.Listen` → `serve` sans jamais construire de client
// sortant. Du côté configuration, `requireRealGatewayMaterial` (internal/config/config.go) ne
// contrôle que la **présence** des six variables du mode `real`, jamais que les fichiers qu'elles
// nomment se chargent.
//
// Conséquence à ce jour : un déploiement en `real` dont `DASHBOARD_GATEWAY_CLIENT_CERT` pointe sur
// un chemin inexistant démarre sans un mot. Le manque est un **appelant**, pas une garde — la
// première route qui joint la passerelle arrive en step-004, et c'est son câblage qui donnera à ce
// refus un moment de démarrage où s'exercer. Construire le client dans `main` avant qu'une route ne
// l'utilise serait du code mort.
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
