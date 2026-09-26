package gateway_test

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/martialanouman/go-gateway-bo/internal/gateway"
)

// Le serveur propose HTTP/2 par ALPN, comme la passerelle derrière son ingress : la montée ne passe
// que parce que net/http la garde en HTTP/1.1.
func TestStreamClientUpgradesOverMutualTLSWithTheMachineToken(t *testing.T) {
	t.Parallel()

	pki := newTestPKI(t)
	tokens := &tokenEndpoint{lifetimes: []int{3600}}
	tokenServer := pki.serveTLS(t, tokens.handle)

	var api recorder

	apiServer := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		api.record(req)

		conn, err := websocket.Accept(w, req, nil)
		if err != nil {
			return
		}

		_ = conn.Close(websocket.StatusNormalClosure, "")
	}))
	apiServer.EnableHTTP2 = true
	apiServer.TLS = &tls.Config{
		Certificates: []tls.Certificate{pki.serverCertificate},
		ClientAuth:   tls.VerifyClientCertIfGiven,
		ClientCAs:    pki.authorities,
		MinVersion:   tls.VersionTLS12,
	}
	apiServer.StartTLS()
	t.Cleanup(apiServer.Close)

	client, err := gateway.NewStreamClient(config.GatewayConfig{
		Mode:         config.GatewayModeReal,
		BaseURL:      apiServer.URL,
		TokenURL:     tokenServer.URL,
		ClientID:     "tableau-de-bord",
		ClientSecret: "secret-de-test",
		ClientCert:   pki.clientCertFile,
		ClientKey:    pki.clientKeyFile,
		CACert:       pki.caFile,
		Timeout:      5 * time.Second,
	})
	require.NoError(t, err)

	//nolint:bodyclose // Dial ferme le corps en échec, et en fait la connexion en succès (dial.go:147-185).
	conn, _, err := websocket.Dial(t.Context(), apiServer.URL+"/admin/stream/metrics",
		&websocket.DialOptions{HTTPClient: client})
	require.NoError(t, err)
	_ = conn.CloseNow()

	received := api.snapshot()
	require.Len(t, received, 1)
	assert.Positive(t, received[0].clientCerts, "le flux a été ouvert sans certificat client")
	assert.Equal(t, "Bearer jeton-machine-1", received[0].authorization)
}

func TestStreamClientRefusesAPlaintextGatewayInRealMode(t *testing.T) {
	t.Parallel()

	_, err := gateway.NewStreamClient(config.GatewayConfig{
		Mode:     config.GatewayModeReal,
		BaseURL:  "http://passerelle.exemple.test",
		TokenURL: "https://jeton.exemple.test",
	})
	require.Error(t, err)
}
