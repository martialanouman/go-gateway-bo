package bff

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Ce fichier est le seul du paquet à vivre **dans** `bff` plutôt que dans `bff_test`, et la raison
// diffère pour chacun des deux tests. Le premier a besoin de substituer l'implémentation montée, ce
// que `mountContract` accepte et que `NewRouter` ne propose pas. Le second appelle `rejectRequest`
// directement, faute de requête qui l'atteigne : `GET /health` n'a ni paramètre, ni en-tête, ni
// corps. Les exercer depuis l'extérieur demanderait d'exporter les deux, c'est-à-dire d'élargir la
// surface du paquet pour un test.

// internalTopology est l'adresse que porterait une erreur enveloppée par une route future
// (`fmt.Errorf("appel de %s: %w", cfg.Gateway.BaseURL, err)`). Le test cherche cette chaîne dans le
// corps servi : c'est la fuite concrète, pas la forme du DTO, qui rend ce défaut grave.
const internalTopology = "http://passerelle.interne.svc:8443"

type failingAPI struct{}

func (failingAPI) Health(_ context.Context, _ HealthRequestObject) (HealthResponseObject, error) {
	return nil, errors.New("appel de " + internalTopology + "/admin/v1/health: connexion refusée")
}

// Login n'est pas exercé par cette suite : ce qu'elle observe est le gestionnaire d'erreur du
// montage, et `Health` suffit à le déclencher. La méthode est là parce que l'interface stricte
// l'exige — c'est précisément ce qu'on lui demande, refuser de compiler une implémentation partielle.
func (failingAPI) Login(_ context.Context, _ LoginRequestObject) (LoginResponseObject, error) {
	return nil, errors.New("appel de " + internalTopology + "/admin/v1/login: connexion refusée")
}

// Une implémentation qui rend une erreur ne fait pas partir le message Go au navigateur.
//
// Le défaut que ce test rejoue est celui des défauts d'oapi-codegen (`bff.gen.go`,
// `NewStrictHandler`) : `http.Error(w, err.Error(), 500)`, donc `text/plain` et le message brut. Deux
// conséquences distinctes, et le test les sépare — le client n'a de type que pour du JSON, et
// l'adresse interne de l'API Admin s'affiche dans le navigateur.
func TestAFailingOperationDoesNotLeakTheGoErrorToTheBrowser(t *testing.T) {
	t.Parallel()

	router := chi.NewRouter()
	mountContract(router, failingAPI{})

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	resp := rec.Result()
	defer resp.Body.Close()

	payload, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	assert.Equal(t, http.StatusInternalServerError, resp.StatusCode)
	assert.Equal(t, "application/json", resp.Header.Get("Content-Type"),
		"le client n'a de type que pour du JSON : un text/plain lui casse dans les mains")
	assert.NotContains(t, string(payload), internalTopology,
		"la topologie interne s'affiche dans le navigateur")
	assert.JSONEq(t,
		`{"code":"internal_error","message":"Le serveur n'a pas pu produire cette réponse. `+
			`Réessayez ; si elle persiste, la panne est côté serveur."}`,
		string(payload))
}

// La liaison n'a aujourd'hui aucun chemin d'échec atteignable : `GET /health` n'a ni paramètre de
// chemin, ni paramètre de requête, ni en-tête requis, ni corps. Le gestionnaire est donc exercé par un
// appel direct, avec les valeurs d'erreur **que le code engendré construit lui-même** plutôt qu'un
// `errors.New` inventé — c'est ce qui rattache le refus du produit à sa source.
//
// Les deux valeurs ci-dessous ne viennent pas du même étage, et le savoir est le correctif : le
// wrapper engendré les construit et appelle `ServerInterfaceWrapper.ErrorHandlerFunc`, que
// `mountContract` pose. Le `RequestErrorHandlerFunc` du handler strict, lui, ne voit que le décodage
// d'un corps de requête. La première opération du contrat qui portera un paramètre passera donc par le
// premier chemin, jamais par le second.
func TestARejectedRequestRendersTheProductDTO(t *testing.T) {
	t.Parallel()

	for _, refusal := range []struct {
		name    string
		binding error
	}{
		{"un paramètre requis absent", &RequiredParamError{ParamName: "depuis"}},
		{
			"un format illisible",
			&InvalidParamFormatError{
				ParamName: "depuis",
				Err:       errors.New(`strconv.ParseInt: parsing "pasunentier": invalid syntax`),
			},
		},
	} {
		t.Run(refusal.name, func(t *testing.T) {
			t.Parallel()

			rec := httptest.NewRecorder()
			rejectRequest(rec, httptest.NewRequest(http.MethodGet, "/health", nil), refusal.binding)

			resp := rec.Result()
			defer resp.Body.Close()

			payload, err := io.ReadAll(resp.Body)
			require.NoError(t, err)

			assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
			assert.Equal(t, "application/json", resp.Header.Get("Content-Type"))
			assert.NotContains(t, string(payload), refusal.binding.Error(),
				"le message du générateur nomme des champs internes : il ne part pas au navigateur")
			assert.JSONEq(t,
				`{"code":"bad_request","message":"Cette requête a été refusée : sa forme ne correspond pas `+
					`à ce que la route attend."}`,
				string(payload))
		})
	}
}
