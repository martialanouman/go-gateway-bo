package hub

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const wait = 5 * time.Second

func quietHub() *Hub {
	return New(slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
}

func grantAll(context.Context) (bool, []string, error) {
	return true, []string{"sessions:read", "billing:read"}, nil
}

// serveOn expose h.Serve derrière un serveur de test et rend l'URL de la socket.
func serveOn(t *testing.T, h *Hub, access Access) string {
	t.Helper()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}

		h.Serve(r.Context(), conn, access)
	}))
	t.Cleanup(server.Close)

	return "ws" + strings.TrimPrefix(server.URL, "http")
}

func dial(t *testing.T, url string) *websocket.Conn {
	t.Helper()

	ctx, cancel := context.WithTimeout(t.Context(), wait)
	defer cancel()

	//nolint:bodyclose // Dial ferme le corps en échec, et en fait la connexion en succès (dial.go:147-185).
	conn, _, err := websocket.Dial(ctx, url, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.CloseNow() })

	return conn
}

func send(t *testing.T, conn *websocket.Conn, message string) {
	t.Helper()

	ctx, cancel := context.WithTimeout(t.Context(), wait)
	defer cancel()

	require.NoError(t, conn.Write(ctx, websocket.MessageText, []byte(message)))
}

type received struct {
	Topic  string          `json:"topic"`
	Status string          `json:"status"`
	Data   json.RawMessage `json:"data"`
	Error  *Error          `json:"error"`
}

func next(t *testing.T, conn *websocket.Conn) received {
	t.Helper()

	ctx, cancel := context.WithTimeout(t.Context(), wait)
	defer cancel()

	_, raw, err := conn.Read(ctx)
	require.NoError(t, err)

	var message received
	require.NoError(t, json.Unmarshal(raw, &message))

	return message
}

func closeStatusOf(t *testing.T, conn *websocket.Conn) websocket.StatusCode {
	t.Helper()

	ctx, cancel := context.WithTimeout(t.Context(), wait)
	defer cancel()

	for {
		if _, _, err := conn.Read(ctx); err != nil {
			return websocket.CloseStatus(err)
		}
	}
}

func subscribers(h *Hub, topic Topic) int {
	h.mu.Lock()
	defer h.mu.Unlock()

	return len(h.subscribers[topic])
}

func awaitSubscribers(t *testing.T, h *Hub, topic Topic, want int) {
	t.Helper()

	require.Eventually(t, func() bool { return subscribers(h, topic) == want }, wait, 5*time.Millisecond)
}

func TestUpstreamFramesAreRelayedThroughTheirDTO(t *testing.T) {
	t.Parallel()

	for _, testCase := range []struct {
		path, frame, want string
	}{
		{
			path: "/admin/stream/metrics",
			frame: `{"v":1,"feed":"metrics","service":"router","instance":"router-1",` +
				`"emitted_at":"2026-09-26T10:00:00Z","dropped_since_start":4,` +
				`"samples":[{"kind":"messages_routed_total","labels":{"connector":"orange-ci"},"value":120}]}`,
			want: `{"topic":"metrics.traffic","ts":"2026-09-26T10:00:00Z","data":{"instance":"router-1",` +
				`"samples":[{"kind":"messages_routed_total","labels":{"connector":"orange-ci"},"value":120}]}}`,
		},
		{
			path: "/admin/stream/sessions",
			frame: `{"v":1,"feed":"sessions","service":"smpp","instance":"smpp-0",` +
				`"emitted_at":"2026-09-26T10:00:00Z","account_id":"acct-7","system_id":"orange-ci-1",` +
				`"state":"unbound"}`,
			want: `{"topic":"sessions.events","ts":"2026-09-26T10:00:00Z","data":{"accountId":"acct-7",` +
				`"systemId":"orange-ci-1","state":"unbound"}}`,
		},
		{
			path: "/admin/stream/billing-alerts",
			frame: `{"v":1,"feed":"billing-alerts","service":"billing","instance":"billing-0",` +
				`"emitted_at":"2026-09-26T10:00:00Z","customer_id":"cust-1","owner_type":"smpp_account",` +
				`"owner_id":"acct-7","alert":"mo_floor_reached","balance":5000}`,
			want: `{"topic":"billing.alerts","ts":"2026-09-26T10:00:00Z","data":{"customerId":"cust-1",` +
				`"ownerType":"smpp_account","ownerId":"acct-7","alert":"mo_floor_reached","balance":5000}}`,
		},
	} {
		t.Run(testCase.path, func(t *testing.T) {
			t.Parallel()

			relayed, err := feedAt(t, testCase.path).relay([]byte(testCase.frame))
			require.NoError(t, err)
			assert.JSONEq(t, testCase.want, string(relayed))
		})
	}
}

func feedAt(t *testing.T, path string) feed {
	t.Helper()

	for _, f := range feeds {
		if f.path == path {
			return f
		}
	}

	t.Fatalf("aucun flux sur %s", path)

	return feed{}
}

// Le seul rempart entre un changement de format amont et une lecture fausse en silence.
func TestAFrameOfAnUnknownVersionIsNotRelayed(t *testing.T) {
	t.Parallel()

	for _, f := range feeds {
		_, err := f.relay([]byte(`{"v":2,"emitted_at":"2026-09-26T10:00:00Z"}`))
		assert.Error(t, err, f.path)
	}
}

func TestUnknownTopicsAndUnreadableMessagesAreRefusedWithoutClosingTheSocket(t *testing.T) {
	t.Parallel()

	conn := dial(t, serveOn(t, quietHub(), grantAll))

	send(t, conn, `{"action":"subscribe","topics":["audit.events"]}`)
	refusal := next(t, conn)
	assert.Equal(t, "audit.events", refusal.Topic)
	require.NotNil(t, refusal.Error)
	assert.Equal(t, "unknown_topic", refusal.Error.Code)

	send(t, conn, `pas du JSON`)
	refusal = next(t, conn)
	require.NotNil(t, refusal.Error)
	assert.Equal(t, "invalid_message", refusal.Error.Code)

	send(t, conn, `{"action":"subscribe","topics":["metrics.traffic"]}`)
	assert.Equal(t, "stale", next(t, conn).Status)
}

func TestUnsubscribingStopsTheBroadcast(t *testing.T) {
	t.Parallel()

	h := quietHub()
	conn := dial(t, serveOn(t, h, grantAll))

	send(t, conn, `{"action":"subscribe","topics":["sessions.events"]}`)
	awaitSubscribers(t, h, SessionsTopic, 1)

	send(t, conn, `{"action":"unsubscribe","topics":["sessions.events"]}`)
	awaitSubscribers(t, h, SessionsTopic, 0)
}

// La file est bornée : un client qui ne lit plus est coupé, et la mémoire du serveur ne suit pas son
// retard.
func TestASlowClientIsCut(t *testing.T) {
	t.Parallel()

	h := quietHub()
	conn := dial(t, serveOn(t, h, grantAll))

	send(t, conn, `{"action":"subscribe","topics":["metrics.traffic"]}`)
	awaitSubscribers(t, h, TrafficTopic, 1)

	frame := []byte(`{"topic":"metrics.traffic","data":"` + strings.Repeat("x", 64<<10) + `"}`)
	for range 10_000 {
		if subscribers(h, TrafficTopic) == 0 {
			break
		}

		h.publish(TrafficTopic, frame)
	}

	// Le 1008 part derrière des trames que ce client ne lit pas : il ne l'atteint pas. Ce qui se
	// prouve, c'est la coupure, au plus writeTimeout après le débordement.
	start := time.Now()
	require.Eventually(t, func() bool { return subscribers(h, TrafficTopic) == 0 },
		writeTimeout+time.Second, 10*time.Millisecond)
	assert.Less(t, time.Since(start), writeTimeout+time.Second)
}

// Un client qui lit, débordé par une rafale, peut encore recevoir le 1008 : c'est ce qui lui permet
// de distinguer « trop lent » d'une coupure réseau.
func TestAClientOverflowedByABurstReceivesThePolicyViolationCode(t *testing.T) {
	t.Parallel()

	h := quietHub()
	conn := dial(t, serveOn(t, h, grantAll))

	send(t, conn, `{"action":"subscribe","topics":["metrics.traffic"]}`)
	awaitSubscribers(t, h, TrafficTopic, 1)

	for range 10 * queueSize {
		h.publish(TrafficTopic, []byte(`{"topic":"metrics.traffic"}`))
	}

	assert.Equal(t, websocket.StatusPolicyViolation, closeStatusOf(t, conn))
}

func TestAnEndedSessionClosesTheSocket(t *testing.T) {
	t.Parallel()

	h := quietHub()
	h.revalidateEvery = 20 * time.Millisecond

	var calls atomic.Int32

	conn := dial(t, serveOn(t, h, func(context.Context) (bool, []string, error) {
		return calls.Add(1) == 1, nil, nil
	}))

	assert.Equal(t, statusSessionEnded, closeStatusOf(t, conn))
}

func TestAnUncheckableSessionClosesTheSocket(t *testing.T) {
	t.Parallel()

	h := quietHub()
	h.revalidateEvery = 20 * time.Millisecond

	var calls atomic.Int32

	conn := dial(t, serveOn(t, h, func(context.Context) (bool, []string, error) {
		if calls.Add(1) == 1 {
			return true, nil, nil
		}

		return false, nil, errors.New("base injoignable")
	}))

	assert.Equal(t, websocket.StatusInternalError, closeStatusOf(t, conn))
}

func TestARevokedPermissionUnsubscribesItsTopicAndSaysSo(t *testing.T) {
	t.Parallel()

	h := quietHub()
	h.revalidateEvery = 20 * time.Millisecond

	var revoked atomic.Bool

	conn := dial(t, serveOn(t, h, func(context.Context) (bool, []string, error) {
		if revoked.Load() {
			return true, nil, nil
		}

		return true, []string{"sessions:read"}, nil
	}))

	send(t, conn, `{"action":"subscribe","topics":["sessions.events"]}`)
	assert.Equal(t, "stale", next(t, conn).Status)
	revoked.Store(true)

	refusal := next(t, conn)
	require.NotNil(t, refusal.Error)
	assert.Equal(t, "sessions.events", refusal.Topic)
	assert.Contains(t, refusal.Error.Message, "sessions:read")
	awaitSubscribers(t, h, SessionsTopic, 0)
}

func TestStoppingTheHubClosesTheSockets(t *testing.T) {
	t.Parallel()

	rdb, namespace := redisFor(t)
	h := fastHub()
	stop := runHub(t, h, func(ctx context.Context, _ string, _ func()) (*websocket.Conn, error) {
		<-ctx.Done()

		return nil, ctx.Err()
	}, rdb, namespace)

	conn := subscribeTo(t, h, "metrics.traffic")

	stop()

	assert.Equal(t, websocket.StatusGoingAway, closeStatusOf(t, conn))
}

// Pas de t.Parallel : le compte de goroutines est celui du processus entier.
func TestNoGoroutineOutlivesClosedSockets(t *testing.T) {
	h := quietHub()
	url := serveOn(t, h, grantAll)

	before := goroutines()

	conns := make([]*websocket.Conn, 0, 500)
	for range 500 {
		conn := dial(t, url)
		send(t, conn, `{"action":"subscribe","topics":["metrics.traffic","sessions.events"]}`)
		conns = append(conns, conn)
	}

	awaitSubscribers(t, h, TrafficTopic, 500)

	for _, conn := range conns {
		_ = conn.Close(websocket.StatusNormalClosure, "")
	}

	awaitSubscribers(t, h, TrafficTopic, 0)
	awaitSubscribers(t, h, SessionsTopic, 0)
	awaitGoroutines(t, before)
}

// Un amont qui accepte la montée puis ferme aussitôt n'est pas rappelé chaque seconde : le sujet
// clignoterait entre live et stale.
func TestAFeedThatDropsRightAfterOpeningDoesNotResetTheBackoff(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err == nil {
			_ = conn.Close(websocket.StatusGoingAway, "")
		}
	}))
	t.Cleanup(upstream.Close)

	var dials atomic.Int32

	ctx, stop := context.WithTimeout(t.Context(), firstBackoff*5/2)
	defer stop()

	h := quietHub()
	h.consume(ctx, feedAt(t, "/admin/stream/metrics"),
		func(ctx context.Context, path string, _ func()) (*websocket.Conn, error) {
			dials.Add(1)

			//nolint:bodyclose // Dial ferme le corps en échec, et en fait la connexion en succès (dial.go:147-185).
			conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(upstream.URL, "http")+path, nil)

			return conn, err
		}, newLeaderView(func([]byte) {}))

	assert.LessOrEqual(t, dials.Load(), int32(2), "le flux a été rappelé à chaque seconde")
}

func goroutines() int { return runtime.NumGoroutine() }

// awaitGoroutines attend le retour au compte initial. Une boucle et non assert.Eventually, dont la
// goroutine de sondage entrerait dans le compte.
func awaitGoroutines(t *testing.T, before int) {
	t.Helper()

	deadline := time.Now().Add(wait)
	for runtime.NumGoroutine() > before && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}

	if after := runtime.NumGoroutine(); after > before {
		dump := make([]byte, 1<<20)
		t.Fatalf("%d goroutines avant, %d après\n%s", before, after, dump[:runtime.Stack(dump, true)])
	}
}
