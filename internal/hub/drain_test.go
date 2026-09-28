package hub

import (
	"context"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
)

func idleUpstream(ctx context.Context, _ string, _ func()) (*websocket.Conn, error) {
	<-ctx.Done()

	return nil, ctx.Err()
}

// startHub lance Run et rend l'annulation et le signal de retour de Run.
func startHub(t *testing.T, h *Hub, grace time.Duration) (context.CancelFunc, <-chan struct{}) {
	t.Helper()

	rdb, namespace := redisFor(t)
	ctx, stop := context.WithCancel(t.Context())
	done := make(chan struct{})

	go func() {
		h.Run(ctx, idleUpstream, rdb, namespace, grace)
		close(done)
	}()

	t.Cleanup(func() {
		stop()
		<-done
	})

	return stop, done
}

// Le client ne lit pas encore : la poignée de fermeture reste pendante, et Run doit l'attendre.
func TestRunWaitsForEverySocketToReceiveGoingAway(t *testing.T) {
	t.Parallel()

	h := fastHub()
	stop, done := startHub(t, h, 5*time.Second)
	conn := subscribeTo(t, h, "metrics.traffic")

	stop()

	select {
	case <-done:
		t.Fatal("Run a rendu la main avant que la socket ait reçu son 1001")
	case <-time.After(300 * time.Millisecond):
	}

	assert.Equal(t, websocket.StatusGoingAway, closeStatusOf(t, conn))

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run ne rend pas la main une fois la socket fermée")
	}
}

func TestAnUpgradeServedDuringShutdownIsClosedGoingAway(t *testing.T) {
	t.Parallel()

	h := fastHub()
	stop, done := startHub(t, h, 5*time.Second)

	stop()
	<-done

	conn := dial(t, serveOn(t, h, grantAll))

	assert.Equal(t, websocket.StatusGoingAway, closeStatusOf(t, conn))
}

// Un client qui ne lit jamais ne répond pas à la fermeture : l'arrêt s'en tient au délai.
func TestADeafClientDoesNotHoldRunBeyondTheGrace(t *testing.T) {
	t.Parallel()

	h := fastHub()
	stop, done := startHub(t, h, 300*time.Millisecond)
	_ = subscribeTo(t, h, "metrics.traffic")

	began := time.Now()
	stop()

	select {
	case <-done:
		assert.Less(t, time.Since(began), 2*time.Second)
	case <-time.After(4 * time.Second):
		t.Fatal("Run attend un client muet au-delà du délai de grâce")
	}
}
