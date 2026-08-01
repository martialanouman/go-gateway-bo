package bff_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/bff"
)

func call(t *testing.T, method, target string) *httptest.ResponseRecorder {
	t.Helper()

	rec := httptest.NewRecorder()
	bff.NewRouter().ServeHTTP(rec, httptest.NewRequest(method, target, nil))

	return rec
}

func TestHealthProbe(t *testing.T) {
	t.Parallel()

	rec := call(t, http.MethodGet, "/api/health")

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "application/json; charset=utf-8", rec.Header().Get("Content-Type"))
	assert.JSONEq(t, `{"status":"ok"}`, rec.Body.String())
}

// Un `/api/*` inconnu rend 404 et jamais du HTML : c'est ce que step-002 vérifiera sur le binaire
// une fois la SPA embarquée, et l'ordonnancement qui le garantit commence ici.
func TestUnknownAPIRouteIsNotFound(t *testing.T) {
	t.Parallel()

	rec := call(t, http.MethodGet, "/api/inconnu")

	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.NotContains(t, rec.Body.String(), "<!doctype html")
}

func TestHealthProbeRefusesOtherMethods(t *testing.T) {
	t.Parallel()

	rec := call(t, http.MethodPost, "/api/health")

	assert.Equal(t, http.StatusMethodNotAllowed, rec.Code)
}
