package gateway

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/martialanouman/go-gateway-bo/internal/token"
)

const issuerURL = "https://dashboard.test"

type seen struct {
	mu            sync.Mutex
	authorization string
	cookie        string
	calls         int
}

func upstream(t *testing.T, status int, s *seen) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		s.calls++
		s.authorization = r.Header.Get("Authorization")
		s.cookie = r.Header.Get("Cookie")
		s.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"code":"x","message":"y"}`))
	}))
}

func mockClient(t *testing.T, baseURL string, logs *bytes.Buffer) (*http.Client, token.KeySet) {
	t.Helper()
	keys, err := token.EphemeralKeySet()
	require.NoError(t, err)
	issuer, err := token.NewIssuer(keys, issuerURL, time.Now)
	require.NoError(t, err)
	client, err := NewStreamClient(config.GatewayConfig{Mode: config.GatewayModeMock, BaseURL: baseURL, Timeout: 2 * time.Second},
		issuer, slog.New(slog.NewJSONHandler(logs, nil)))
	require.NoError(t, err)
	return client, keys
}

func TestACallWithoutACallerNeverLeaves(t *testing.T) {
	s := &seen{}
	srv := upstream(t, http.StatusOK, s)
	defer srv.Close()
	client, _ := mockClient(t, srv.URL, &bytes.Buffer{})

	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/admin/customers", nil)
	_, err := client.Do(req)
	require.ErrorIs(t, err, ErrNoCaller)
	assert.Zero(t, s.calls, "aucune requête n'a atteint la passerelle")
}

func TestAnOperatorWithOnlyLocalKeysNeverLeavesEither(t *testing.T) {
	s := &seen{}
	srv := upstream(t, http.StatusOK, s)
	defer srv.Close()
	client, _ := mockClient(t, srv.URL, &bytes.Buffer{})

	ctx := WithOperator(context.Background(), "4f3c2b1a-9e8d-4c7b-a6f5-0e1d2c3b4a59", []string{"operators:manage"})
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/admin/customers", nil)
	_, err := client.Do(req)
	require.ErrorIs(t, err, ErrNoCaller)
	assert.Zero(t, s.calls)
}

func TestTheOperatorTokenVerifiesAsTheGatewayVerifiesIt(t *testing.T) {
	s := &seen{}
	srv := upstream(t, http.StatusOK, s)
	defer srv.Close()
	client, keys := mockClient(t, srv.URL, &bytes.Buffer{})

	jwks := httptest.NewServer(keys.JWKSHandler())
	defer jwks.Close()
	verifier := oidc.NewVerifier(issuerURL, oidc.NewRemoteKeySet(context.Background(), jwks.URL),
		&oidc.Config{ClientID: token.Audience, SupportedSigningAlgs: []string{oidc.ES256}})

	ctx := WithOperator(context.Background(), "4f3c2b1a-9e8d-4c7b-a6f5-0e1d2c3b4a59", []string{"customers:read", "cdr:read_pii"})
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/admin/customers", nil)
	req.Header.Set("Cookie", "dashboard_session=never-forwarded")
	resp, err := client.Do(req)
	require.NoError(t, err)
	_ = resp.Body.Close()

	raw := s.authorization[len("Bearer "):]
	idToken, err := verifier.Verify(context.Background(), raw)
	require.NoError(t, err)
	var claims struct {
		Scope string `json:"scope"`
	}
	require.NoError(t, idToken.Claims(&claims))
	assert.Equal(t, "4f3c2b1a-9e8d-4c7b-a6f5-0e1d2c3b4a59", idToken.Subject)
	assert.Equal(t, "admin:read msisdn:reveal", claims.Scope)
	assert.Empty(t, s.cookie, "le cookie de session ne part jamais vers la passerelle")
}

func TestTheSystemIdentityReadsOnly(t *testing.T) {
	s := &seen{}
	srv := upstream(t, http.StatusOK, s)
	defer srv.Close()
	client, keys := mockClient(t, srv.URL, &bytes.Buffer{})
	jwks := httptest.NewServer(keys.JWKSHandler())
	defer jwks.Close()
	verifier := oidc.NewVerifier(issuerURL, oidc.NewRemoteKeySet(context.Background(), jwks.URL),
		&oidc.Config{ClientID: token.Audience, SupportedSigningAlgs: []string{oidc.ES256}})

	req, _ := http.NewRequestWithContext(WithSystem(context.Background()), http.MethodGet, srv.URL+"/admin/stream/metrics", nil)
	resp, err := client.Do(req)
	require.NoError(t, err)
	_ = resp.Body.Close()

	idToken, err := verifier.Verify(context.Background(), s.authorization[len("Bearer "):])
	require.NoError(t, err)
	var claims struct {
		Scope string `json:"scope"`
	}
	require.NoError(t, idToken.Claims(&claims))
	assert.Equal(t, SystemSubject, idToken.Subject)
	assert.Equal(t, "admin:read", claims.Scope)
}

func TestARejectedTokenIsLoggedWithoutTheToken(t *testing.T) {
	s := &seen{}
	srv := upstream(t, http.StatusUnauthorized, s)
	defer srv.Close()
	logs := &bytes.Buffer{}
	client, keys := mockClient(t, srv.URL, logs)

	ctx := WithOperator(context.Background(), "4f3c2b1a-9e8d-4c7b-a6f5-0e1d2c3b4a59", []string{"customers:read"})
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/admin/customers", nil)
	resp, err := client.Do(req)
	require.NoError(t, err)
	_ = resp.Body.Close()

	assert.Contains(t, logs.String(), "gateway_token_rejected")
	assert.Contains(t, logs.String(), keys.ActiveID())
	assert.NotContains(t, logs.String(), s.authorization[len("Bearer "):])
}
