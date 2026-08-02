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

// Ce fichier est le seul du paquet à vivre **dans** `bff` plutôt que dans `bff_test` : les
// gestionnaires d'erreur du handler strict ne sont atteignables par aucune requête que le contrat
// autorise — `GET /health` n'a ni paramètre à lier ni implémentation qui échoue. Les exercer depuis
// l'extérieur demanderait de les exporter, c'est-à-dire d'élargir la surface du paquet pour un test.

// internalTopology est l'adresse que porterait une erreur enveloppée par une route future
// (`fmt.Errorf("appel de %s: %w", cfg.Gateway.BaseURL, err)`). Le test cherche cette chaîne dans le
// corps servi : c'est la fuite concrète, pas la forme du DTO, qui rend ce défaut grave.
const internalTopology = "http://passerelle.interne.svc:8443"

type failingAPI struct{}

func (failingAPI) Health(_ context.Context, _ HealthRequestObject) (HealthResponseObject, error) {
	return nil, errors.New("appel de " + internalTopology + "/admin/v1/health: connexion refusée")
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
	HandlerFromMux(newContractHandler(failingAPI{}), router)

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

// La liaison des paramètres n'a aujourd'hui aucun chemin d'échec : `GET /health` n'a ni paramètre de
// chemin, ni paramètre de requête, ni en-tête requis. Le gestionnaire est donc exercé par un appel
// direct — la première opération du contrat qui portera un paramètre l'atteindra pour de bon.
func TestARejectedRequestRendersTheProductDTO(t *testing.T) {
	t.Parallel()

	rec := httptest.NewRecorder()
	rejectRequest(rec, httptest.NewRequest(http.MethodGet, "/health", nil),
		errors.New("Query argument depuis is required, but not found"))

	resp := rec.Result()
	defer resp.Body.Close()

	payload, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	assert.Equal(t, "application/json", resp.Header.Get("Content-Type"))
	assert.JSONEq(t,
		`{"code":"bad_request","message":"Cette requête a été refusée : sa forme ne correspond pas `+
			`à ce que la route attend."}`,
		string(payload))
}
