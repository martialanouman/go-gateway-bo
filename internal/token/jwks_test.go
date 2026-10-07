package token

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTheJWKSPublishesOnlyPublicFields(t *testing.T) {
	set, err := EphemeralKeySet()
	require.NoError(t, err)

	recorder := httptest.NewRecorder()
	set.JWKSHandler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/.well-known/jwks.json", nil))

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "application/json", recorder.Header().Get("Content-Type"))

	var raw struct{ Keys []map[string]any `json:"keys"` }
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &raw))
	require.Len(t, raw.Keys, 1)
	key := raw.Keys[0]
	assert.ElementsMatch(t, []string{"kty", "crv", "x", "y", "kid", "alg", "use"}, keysOf(key))
	assert.Equal(t, "EC", key["kty"])
	assert.Equal(t, "P-256", key["crv"])
	assert.Equal(t, "ES256", key["alg"])
	assert.Equal(t, "sig", key["use"])
	assert.Equal(t, set.ActiveID(), key["kid"])
}

func keysOf(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
