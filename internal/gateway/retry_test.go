package gateway_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/martialanouman/go-gateway-bo/internal/gateway"
)

// listCustomers et suspendCustomer sont les deux verbes du contrat que ces tests exercent : une
// lecture et une mutation. Elles rendent l'erreur de transport, la seule chose qui distingue « la
// requête n'est jamais partie » de « la passerelle a répondu ».
func listCustomers(ctx context.Context, client *gateway.ClientWithResponses) error {
	_, err := client.ListCustomersWithResponse(ctx, nil)

	return err
}

func suspendCustomer(ctx context.Context, client *gateway.ClientWithResponses) error {
	_, err := client.SuspendCustomerWithResponse(ctx, gateway.Id{})

	return err
}

func alwaysRespond(t *testing.T, status int) (*recorder, *gateway.ClientWithResponses) {
	t.Helper()

	var api recorder

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		api.record(req)
		w.WriteHeader(status)
	}))
	t.Cleanup(server.Close)

	client, err := gateway.NewAdminClient(config.GatewayConfig{
		Mode:    config.GatewayModeMock,
		BaseURL: server.URL,
		Timeout: 5 * time.Second,
	})
	require.NoError(t, err)

	return &api, client
}

// Le tableau de bord est un observateur (invariant e) : un observateur qui martèle une passerelle
// dégradée devient un amplificateur d'incident. Ce que ce test tient, c'est le plafond — deux
// requêtes reçues au maximum, et une seule dès que la passerelle demande de reculer ou qu'un
// opérateur est à l'origine de l'appel.
func TestAdminClientReplaysReadsOnce(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		status   int
		call     func(context.Context, *gateway.ClientWithResponses) error
		attempts int
		why      string
	}{
		{
			name:     "rejoue une lecture sur 502, une fois et pas deux",
			status:   http.StatusBadGateway,
			call:     listCustomers,
			attempts: 2,
			why:      "une lecture perdue en chemin se rejoue exactement une fois",
		},
		{
			name:     "rejoue une lecture sur 504",
			status:   http.StatusGatewayTimeout,
			call:     listCustomers,
			attempts: 2,
			why:      "504 est le même accident de chemin que 502",
		},
		{
			name:     "ne rejoue jamais un POST",
			status:   http.StatusBadGateway,
			call:     suspendCustomer,
			attempts: 1,
			why: "une mutation est déclenchée par un opérateur présent à l'écran ; un rejeu " +
				"automatique masque les conflits et rejoue peut-être une suspension déjà appliquée",
		},
		{
			name:     "ne rejoue pas sur 429",
			status:   http.StatusTooManyRequests,
			call:     listCustomers,
			attempts: 1,
			why:      "429 est la passerelle qui dit explicitement de reculer",
		},
		{
			name:     "ne rejoue pas sur 503",
			status:   http.StatusServiceUnavailable,
			call:     listCustomers,
			attempts: 1,
			why: "le contrat dit de réessayer quand elle se rétablit, pas immédiatement ; le " +
				"rétablissement se constate par l'opérateur et son bouton Réessayer",
		},
		{
			name:     "ne rejoue pas sur 500",
			status:   http.StatusInternalServerError,
			call:     listCustomers,
			attempts: 1,
			why:      "500 est une réponse de la passerelle, pas un accident de chemin",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			api, client := alwaysRespond(t, testCase.status)

			require.NoError(t, testCase.call(t.Context(), client))

			assert.Equal(t, testCase.attempts, api.count(), testCase.why)
		})
	}
}

// dropsTheFirstConnection coupe la connexion de la première requête avant toute réponse, et répond
// 200 aux suivantes. C'est l'accident que le rejeu existe pour absorber : une instance de la
// passerelle retirée du load balancer pendant un déploiement roulant.
func dropsTheFirstConnection(t *testing.T) (*recorder, *gateway.ClientWithResponses) {
	t.Helper()

	var (
		api      recorder
		attempts atomic.Int64
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		api.record(req)

		if attempts.Add(1) == 1 {
			hijacked, _, err := http.NewResponseController(w).Hijack()
			if err != nil {
				// t.Errorf et non require : un handler court sur une autre goroutine, où FailNow
				// laisserait le test suspendu au lieu de le faire tomber.
				t.Errorf("la connexion n'a pas pu être coupée : %v", err)

				return
			}

			_ = hijacked.Close()

			return
		}

		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	client, err := gateway.NewAdminClient(config.GatewayConfig{
		Mode:    config.GatewayModeMock,
		BaseURL: server.URL,
		Timeout: 5 * time.Second,
	})
	require.NoError(t, err)

	return &api, client
}

func TestAdminClientReplaysADroppedConnection(t *testing.T) {
	t.Parallel()

	api, client := dropsTheFirstConnection(t)

	// net/http ne rejoue de lui-même que sur une connexion réutilisée : celle-ci est neuve, donc ce
	// qui produit la seconde requête ne peut être que le rejeu de ce package.
	require.NoError(t, listCustomers(t.Context(), client))
	assert.Equal(t, 2, api.count())
}

// Le rejeu attend cent à deux cents millisecondes avant de repartir, et cette attente est la seule
// portion du trajet qui ne consulte rien. Un opérateur qui quitte l'écran, ou un arrêt propre qui
// annule les requêtes en vol, doit rendre la main tout de suite : l'attendre, c'est retenir une
// goroutine et une connexion pour une tentative dont on sait déjà qu'elle échouera sur le contexte.
//
// Ce que ce test observe est le **délai**, et non le nombre de requêtes : celui-ci vaut 1 dans les
// deux cas, parce que net/http refuse d'émettre sur un contexte annulé, avec ou sans attente. Le
// chronomètre part de l'annulation, posée dans le handler, et non du début de l'appel : ce qui est
// mesuré est ce qui vient après elle. Sans la garde, le minuteur impose au moins replayDelay ; avec
// elle, il ne reste qu'un aller-retour de goroutines.
func TestAdminClientStopsWaitingWhenTheCallerGivesUp(t *testing.T) {
	t.Parallel()

	var (
		api        recorder
		cancelled  = make(chan time.Time, 1)
		ctx, renow = context.WithCancel(t.Context())
	)
	defer renow()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		api.record(req)

		// L'opérateur ferme l'onglet pendant que la passerelle répond : le rejeu est décidé, et
		// l'attente qui le précède commence après cette annulation.
		renow()
		cancelled <- time.Now()

		w.WriteHeader(http.StatusBadGateway)
	}))
	t.Cleanup(server.Close)

	client, err := gateway.NewAdminClient(config.GatewayConfig{
		Mode:    config.GatewayModeMock,
		BaseURL: server.URL,
		Timeout: 5 * time.Second,
	})
	require.NoError(t, err)

	require.Error(t, listCustomers(ctx, client),
		"l'appelant a renoncé : l'appel remonte l'annulation, pas une réponse")

	assert.Less(t, time.Since(<-cancelled), 100*time.Millisecond,
		"le rejeu a purgé son délai d'attente alors que l'appelant avait déjà renoncé ; la requête "+
			"suivante ne partira pourtant jamais")
	assert.Equal(t, 1, api.count())
}

// Le croisement que les deux tests voisins laissent ouvert : une **mutation** dont la connexion
// tombe. Chacun n'exerce qu'une moitié — « ne rejoue jamais un POST » sur un 502 de réponse, le
// rejeu d'une connexion coupée sur une lecture — et le défaut qu'on commet vraiment vit précisément
// à l'intersection : « une connexion tombée, ça se rejoue », écrit avant la garde de méthode.
//
// C'est le seul défaut de ce package à effet irréversible côté plan de données : la passerelle
// applique la suspension, puis l'instance quitte le load balancer avant d'écrire la réponse. Rejouer
// suspend deux fois, ou tourne deux fois un identifiant de bind.
func TestAdminClientNeverReplaysAMutationWhoseConnectionDropped(t *testing.T) {
	t.Parallel()

	api, client := dropsTheFirstConnection(t)

	err := suspendCustomer(t.Context(), client)

	assert.Equal(t, 1, api.count(),
		"une connexion coupée ne dit pas si la suspension a été appliquée ; la rejouer parie qu'elle "+
			"ne l'a pas été, et ce pari se paie sur le plan de données")
	require.Error(t, err,
		"la connexion est tombée : l'appel doit remonter l'erreur de transport, pas une réponse")
}
