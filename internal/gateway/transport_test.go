package gateway

import (
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/config"
)

func TestTheTransportHonorsTheEnvironmentProxy(t *testing.T) {
	t.Parallel()

	transport, err := outboundTransport(config.GatewayConfig{Mode: config.GatewayModeMock})
	require.NoError(t, err)

	proxy := transport.(replayReadsOnce).base.(*http.Transport).Proxy
	require.NotNil(t, proxy, "HTTPS_PROXY et NO_PROXY seraient ignorés en silence")
	assert.Equal(t, reflect.ValueOf(http.ProxyFromEnvironment).Pointer(), reflect.ValueOf(proxy).Pointer())
}

func TestConcurrentCallsNeverOpenMoreConnectionsThanTheBound(t *testing.T) {
	t.Parallel()

	var open, peak atomic.Int32

	release := make(chan struct{})
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		<-release
		w.WriteHeader(http.StatusOK)
	}))
	server.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		switch state {
		case http.StateNew:
			peak.Store(max(peak.Load(), open.Add(1)))
		case http.StateClosed, http.StateHijacked:
			open.Add(-1)
		}
	}
	server.Start()
	defer server.Close()

	transport, err := outboundTransport(config.GatewayConfig{Mode: config.GatewayModeMock})
	require.NoError(t, err)

	client := &http.Client{Transport: transport, Timeout: 5 * time.Second}

	var calls sync.WaitGroup
	for range maxConnsPerHost + 16 {
		calls.Go(func() {
			response, err := client.Get(server.URL)
			if err == nil {
				_ = response.Body.Close()
			}
		})
	}

	time.Sleep(300 * time.Millisecond)
	close(release)
	calls.Wait()

	assert.LessOrEqual(t, int(peak.Load()), maxConnsPerHost)
	assert.Positive(t, peak.Load())
}
