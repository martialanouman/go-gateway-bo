package main

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func listenLocally(t *testing.T) net.Listener {
	t.Helper()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)

	return ln
}

// Le sujet de ces tests est le serveur, pas ses handlers : le handler lent est l'instrument qui rend
// observable ce que « requête en vol » veut dire.
func TestServeFinishesInFlightRequests(t *testing.T) {
	t.Parallel()

	var (
		entered  = make(chan struct{})
		released = make(chan struct{})
	)

	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(entered)
		<-released
		_, _ = w.Write([]byte("terminé"))
	})

	ln := listenLocally(t)
	url := "http://" + ln.Addr().String() + "/"

	ctx, shutdown := context.WithCancel(t.Context())
	served := make(chan error, 1)
	go func() { served <- serve(ctx, ln, handler, 5*time.Second, silentLogger()) }()

	body := make(chan string, 1)
	go func() {
		resp, err := http.Get(url)
		if err != nil {
			body <- "erreur: " + err.Error()

			return
		}
		defer resp.Body.Close()

		payload, _ := io.ReadAll(resp.Body)
		body <- string(payload)
	}()

	<-entered
	shutdown()
	// Le handler n'est libéré qu'une fois l'arrêt réellement engagé — sinon il aurait pu se terminer
	// avant, et le test resterait vert avec un serveur qui coupe ses connexions au lieu de les
	// attendre.
	requireRefusesConnections(t, ln.Addr().String())
	close(released)

	assert.Equal(t, "terminé", <-body)
	require.NoError(t, <-served)
}

// requireRefusesConnections attend que le listener ait cessé d'accepter : c'est le signe observable
// que l'arrêt a commencé.
func requireRefusesConnections(t *testing.T, addr string) {
	t.Helper()

	require.Eventually(t, func() bool {
		conn, err := net.DialTimeout("tcp", addr, 200*time.Millisecond)
		if err == nil {
			conn.Close()
		}

		return err != nil
	}, 3*time.Second, 20*time.Millisecond)
}

func TestServeReportsAnExpiredGracePeriod(t *testing.T) {
	t.Parallel()

	release := make(chan struct{})
	t.Cleanup(func() { close(release) })

	entered := make(chan struct{})
	handler := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		close(entered)
		<-release
	})

	ln := listenLocally(t)
	url := "http://" + ln.Addr().String() + "/"

	ctx, shutdown := context.WithCancel(t.Context())
	served := make(chan error, 1)
	go func() { served <- serve(ctx, ln, handler, 50*time.Millisecond, silentLogger()) }()

	go func() {
		resp, err := http.Get(url)
		if err == nil {
			resp.Body.Close()
		}
	}()

	<-entered
	shutdown()

	// Une requête qui traîne au-delà du délai n'a pas le droit de retenir le process indéfiniment ;
	// l'arrêt forcé se voit dans le code de sortie plutôt que de passer pour un arrêt propre.
	select {
	case err := <-served:
		require.Error(t, err)
	case <-time.After(3 * time.Second):
		t.Fatal("serve n'a pas rendu la main après l'expiration du délai de grâce")
	}
}
