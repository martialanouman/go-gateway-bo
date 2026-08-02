package gateway_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/martialanouman/go-gateway-bo/internal/gateway"
)

// tokenEndpoint est un faux `tokenUrl` qui **compte** ce qu'il reçoit. C'est la frontière réseau :
// tout ce que ces tests affirment du cache de jeton se lit dans le nombre de requêtes arrivées ici,
// jamais dans un interne qu'on aurait injecté au client.
type tokenEndpoint struct {
	recorder

	// lifetimes donne le `expires_in` des jetons successifs ; le dernier vaut pour tous les suivants.
	lifetimes []int
	issued    atomic.Int64
}

func (e *tokenEndpoint) handle(w http.ResponseWriter, req *http.Request) {
	e.record(req)

	issued := int(e.issued.Add(1))

	lifetime := e.lifetimes[min(issued, len(e.lifetimes))-1]

	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w,
		`{"access_token":"jeton-machine-%d","token_type":"Bearer","expires_in":%d}`,
		issued, lifetime)
}

// realModeGateway monte les deux bouts d'une passerelle jointe pour de vrai — l'API et son
// `tokenUrl` — derrière la même autorité, et rend le client gréé contre eux.
func realModeGateway(
	t *testing.T,
	timeout time.Duration,
	tokenLifetimes []int,
	api http.HandlerFunc,
) (*gateway.ClientWithResponses, *tokenEndpoint) {
	t.Helper()

	pki := newTestPKI(t)
	tokens := &tokenEndpoint{lifetimes: tokenLifetimes}

	apiServer := pki.serveTLS(t, api)
	tokenServer := pki.serveTLS(t, tokens.handle)

	client, err := gateway.NewAdminClient(config.GatewayConfig{
		Mode:         config.GatewayModeReal,
		BaseURL:      apiServer.URL,
		TokenURL:     tokenServer.URL,
		ClientID:     "tableau-de-bord",
		ClientSecret: "secret-de-test",
		ClientCert:   pki.clientCertFile,
		ClientKey:    pki.clientKeyFile,
		CACert:       pki.caFile,
		Timeout:      timeout,
	})
	require.NoError(t, err)

	return client, tokens
}

func ok(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }

// Le jeton s'obtient par le même transport que l'API : un `tokenUrl` joint hors mTLS serait une
// authentification sortante à moitié protégée, et rien ne le signalerait. Ici les deux bouts
// exigent et vérifient le certificat client, donc l'absence de l'un ou de l'autre fait tomber la
// poignée de main — et le test avec elle.
func TestAdminClientPresentsItsCertificateOnBothOutboundCalls(t *testing.T) {
	t.Parallel()

	var api recorder

	client, tokens := realModeGateway(t, 5*time.Second, []int{3600},
		func(w http.ResponseWriter, req *http.Request) {
			api.record(req)
			ok(w, req)
		})

	require.NoError(t, listCustomers(t.Context(), client))

	tokenRequests := tokens.snapshot()
	require.Len(t, tokenRequests, 1)
	assert.Positive(t, tokenRequests[0].clientCerts,
		"le tokenUrl a été joint sans certificat client")

	apiRequests := api.snapshot()
	require.Len(t, apiRequests, 1)
	assert.Positive(t, apiRequests[0].clientCerts, "l'API a été jointe sans certificat client")
	assert.Equal(t, "Bearer jeton-machine-1", apiRequests[0].authorization)
}

func TestAdminClientRenewsTheMachineTokenBeforeItExpires(t *testing.T) {
	t.Parallel()

	t.Run("ne redemande pas un jeton encore valide", func(t *testing.T) {
		t.Parallel()

		client, tokens := realModeGateway(t, 5*time.Second, []int{3600}, ok)

		for range 3 {
			require.NoError(t, listCustomers(t.Context(), client))
		}

		assert.Equal(t, 1, tokens.count(),
			"un jeton valide se réutilise ; le redemander à chaque appel triple la charge sur le "+
				"tokenUrl et rend le tableau de bord bavard sur un chemin qu'il ne devrait pas emprunter")
	})

	t.Run("renouvelle un jeton qui n'a plus que neuf secondes à vivre", func(t *testing.T) {
		t.Parallel()

		client, tokens := realModeGateway(t, 5*time.Second, []int{9}, ok)

		for range 3 {
			require.NoError(t, listCustomers(t.Context(), client))
		}

		assert.Equal(t, 3, tokens.count(),
			"le jeton est annoncé valide neuf secondes encore et doit pourtant être renouvelé : "+
				"sans cette anticipation, un jeton expire en vol entre le contrôle et l'arrivée de la "+
				"requête à la passerelle, qui répond alors 401 à un opérateur qui n'a rien fait de mal")
	})
}

// Le test que nomme la DoD. Le jeton est d'abord obtenu, puis laissé expirer, puis huit appels
// partent ensemble : ils trouvent tous le jeton expiré, et **une seule** requête doit atteindre le
// tokenUrl. Sans réutilisation de la source, ce sont huit obtentions concurrentes qui partent — sur
// un endpoint d'authentification, c'est une rafale que rien ne distingue d'une attaque.
func TestAdminClientFetchesASingleTokenWhenConcurrentCallsFindItExpired(t *testing.T) {
	t.Parallel()

	// Onze secondes annoncées, moins les dix secondes d'anticipation : le premier jeton vit une
	// seconde. Le second est demandé pendant la rafale et doit couvrir tout le reste du test.
	client, tokens := realModeGateway(t, 5*time.Second, []int{11, 3600}, ok)

	require.NoError(t, listCustomers(t.Context(), client))
	require.Equal(t, 1, tokens.count())

	time.Sleep(1500 * time.Millisecond)

	const callers = 8

	var waiting sync.WaitGroup

	start := make(chan struct{})
	failures := make(chan error, callers)

	for range callers {
		waiting.Add(1)

		go func() {
			defer waiting.Done()

			<-start

			if err := listCustomers(t.Context(), client); err != nil {
				failures <- err
			}
		}()
	}

	close(start)
	waiting.Wait()
	close(failures)

	for err := range failures {
		require.NoError(t, err)
	}

	assert.Equal(t, 2, tokens.count(),
		"un jeton d'amorçage puis un renouvellement : huit appels concurrents sur un jeton expiré "+
			"ne doivent déclencher qu'une seule obtention")
}

// Le Timeout de la configuration borne l'appel sortant, **obtention du jeton comprise** : un
// tokenUrl qui ne répond jamais doit devenir un état d'erreur à l'écran, pas une requête suspendue
// qui retient une connexion et l'opérateur avec elle.
func TestGatewayTimeoutBoundsTokenAcquisition(t *testing.T) {
	t.Parallel()

	pki := newTestPKI(t)

	// Le `defer` plutôt qu'un `t.Cleanup` : il court avant les nettoyages enregistrés, donc avant la
	// fermeture des serveurs, qui autrement attendrait indéfiniment un handler encore en vol.
	mute := make(chan struct{})
	defer close(mute)

	apiServer := pki.serveTLS(t, ok)
	tokenServer := pki.serveTLS(t, func(_ http.ResponseWriter, _ *http.Request) {
		<-mute
	})

	client, err := gateway.NewAdminClient(config.GatewayConfig{
		Mode:         config.GatewayModeReal,
		BaseURL:      apiServer.URL,
		TokenURL:     tokenServer.URL,
		ClientID:     "tableau-de-bord",
		ClientSecret: "secret-de-test",
		ClientCert:   pki.clientCertFile,
		ClientKey:    pki.clientKeyFile,
		CACert:       pki.caFile,
		Timeout:      200 * time.Millisecond,
	})
	require.NoError(t, err)

	// Le contexte de l'appel est celui du test : ce qui rend la main ne peut être que le Timeout.
	failed := make(chan error, 1)
	go func() { failed <- listCustomers(t.Context(), client) }()

	select {
	case err := <-failed:
		require.Error(t, err, "un tokenUrl muet doit produire une erreur, pas une réponse")
	case <-time.After(3 * time.Second):
		t.Fatal("l'appel n'a jamais rendu la main : le Timeout ne borne pas l'obtention du jeton")
	}
}

// Le mode `mock` n'appelle aucun tokenUrl : il n'y en a pas en face. C'est ce que ce test tient, en
// n'en fournissant aucun — un client qui en chercherait un échouerait à joindre la chaîne vide.
func TestMockModeNeverCallsATokenEndpoint(t *testing.T) {
	t.Parallel()

	var api recorder

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		api.record(req)
		ok(w, req)
	}))
	t.Cleanup(server.Close)

	client, err := gateway.NewAdminClient(config.GatewayConfig{
		Mode:    config.GatewayModeMock,
		BaseURL: server.URL,
		Timeout: 5 * time.Second,
	})
	require.NoError(t, err)

	require.NoError(t, listCustomers(t.Context(), client))
	assert.Equal(t, 1, api.count())
}

// Le jeton machine porte `content:read` en permanence, et les scopes demandés sont ceux du contrat,
// codés dans le package. Ce que ce test tient n'est pas une préférence de configuration : c'est que
// la restriction par opérateur ne passe **pas** par là. Elle est entièrement à la charge du BFF —
// `RequirePermission()` en middleware — et l'invariant (c) n'a pas d'autre point d'appui.
func TestMachineTokenAlwaysRequestsContentRead(t *testing.T) {
	t.Parallel()

	client, tokens := realModeGateway(t, 5*time.Second, []int{3600}, ok)

	require.NoError(t, listCustomers(t.Context(), client))

	requested := tokens.snapshot()
	require.Len(t, requested, 1)
	assert.Equal(t, "admin:read admin:write content:read content:erase gdpr:erase", requested[0].scope,
		"les cinq scopes du contrat sont demandés à l'émission, content:read compris et en "+
			"permanence : c'est le BFF qui décide ensuite ce qu'un opérateur voit")
}
