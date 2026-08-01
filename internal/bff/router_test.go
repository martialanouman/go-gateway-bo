package bff_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/bff"
)

// call rend la réponse telle qu'elle part sur le fil, et non l'enregistreur : `rec.Header()` est la
// map vivante que le handler a modifiée, pas ce que le client reçoit. Un en-tête posé après
// `WriteHeader` — qui n'atteint donc jamais personne — y apparaît quand même.
func call(t *testing.T, method, target string) *http.Response {
	t.Helper()

	rec := httptest.NewRecorder()
	bff.NewRouter().ServeHTTP(rec, httptest.NewRequest(method, target, nil))

	return rec.Result()
}

func bodyOf(t *testing.T, resp *http.Response) string {
	t.Helper()

	payload, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	return string(payload)
}

func TestHealthProbe(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodGet, "/api/health")
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "application/json; charset=utf-8", resp.Header.Get("Content-Type"))
	assert.JSONEq(t, `{"status":"ok"}`, bodyOf(t, resp))
}

// Un `/api/*` inconnu rend 404 et jamais du HTML : c'est ce que step-002 vérifiera sur le binaire
// une fois la SPA embarquée, et l'ordonnancement qui le garantit commence ici.
func TestUnknownAPIRouteIsNotFound(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodGet, "/api/inconnu")
	defer resp.Body.Close()

	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	assert.NotContains(t, bodyOf(t, resp), "<!doctype html")
}

func TestHealthProbeRefusesOtherMethods(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodPost, "/api/health")
	defer resp.Body.Close()

	assert.Equal(t, http.StatusMethodNotAllowed, resp.StatusCode)
}
