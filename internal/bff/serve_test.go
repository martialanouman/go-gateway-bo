package bff_test

import (
	"context"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/bff"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Le filet du déploiement roulant de step-186 : sans lui, rien ne dit qu'un
// SIGTERM en pleine requête ne coupe pas la réponse au milieu.
func TestServeFinishesInFlightRequestAndRefusesNewOnes(t *testing.T) {
	handlerStarted := make(chan struct{})
	releaseHandler := make(chan struct{})

	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(handlerStarted)
		<-releaseHandler
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("réponse complète"))
	})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	baseURL := "http://" + listener.Addr().String()

	ctx, stop := context.WithCancel(context.Background())
	served := make(chan error, 1)
	go func() { served <- bff.Serve(ctx, listener, handler, 5*time.Second) }()

	type outcome struct {
		status int
		body   string
		err    error
	}
	inFlight := make(chan outcome, 1)
	go func() {
		response, err := http.Get(baseURL + "/lent") //nolint:noctx // l'annulation est le sujet du test
		if err != nil {
			inFlight <- outcome{err: err}
			return
		}
		defer func() { _ = response.Body.Close() }()
		body, err := io.ReadAll(response.Body)
		inFlight <- outcome{status: response.StatusCode, body: string(body), err: err}
	}()

	<-handlerStarted
	stop()

	// Shutdown est asynchrone : on attend que l'écoute cesse réellement plutôt
	// que de dormir un délai arbitraire.
	refusing := &http.Client{Transport: &http.Transport{DisableKeepAlives: true}, Timeout: time.Second}
	require.Eventually(t, func() bool {
		response, err := refusing.Get(baseURL + "/health") //nolint:noctx // idem
		if err != nil {
			return true
		}
		_ = response.Body.Close()
		return false
	}, 5*time.Second, 10*time.Millisecond, "le serveur accepte encore des connexions après l'ordre d'arrêt")

	close(releaseHandler)

	result := <-inFlight
	require.NoError(t, result.err, "la requête en vol a été coupée")
	assert.Equal(t, http.StatusOK, result.status)
	assert.Equal(t, "réponse complète", result.body, "la réponse en vol doit arriver entière")

	require.NoError(t, <-served)
}
