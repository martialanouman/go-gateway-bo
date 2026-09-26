package hub

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const sessionFrame = `{"v":1,"feed":"sessions","service":"smpp","instance":"smpp-0",` +
	`"emitted_at":"2026-09-26T10:00:00Z","account_id":"acct-7","system_id":"orange-ci-1","state":"bound","sessions":3}`

// upstream est une passerelle de test : elle compte les connexions par flux et émet sur les
// connexions ouvertes.
type upstream struct {
	server *httptest.Server
	mu     sync.Mutex
	conns  map[string][]*websocket.Conn
	opened map[string]int
	pings  time.Duration
}

func newUpstream(t *testing.T) *upstream {
	t.Helper()

	u := &upstream{conns: map[string][]*websocket.Conn{}, opened: map[string]int{}}
	u.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}

		u.mu.Lock()
		u.conns[r.URL.Path] = append(u.conns[r.URL.Path], conn)
		u.opened[r.URL.Path]++
		pings := u.pings
		u.mu.Unlock()

		ctx := conn.CloseRead(context.Background())
		if pings == 0 {
			<-ctx.Done()

			return
		}

		ticker := time.NewTicker(pings)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = conn.Ping(ctx)
			}
		}
	}))
	t.Cleanup(func() {
		u.server.CloseClientConnections()
		u.server.Close()
	})

	return u
}

func (u *upstream) dial(ctx context.Context, path string, onPing func()) (*websocket.Conn, error) {
	//nolint:bodyclose // Dial ferme le corps en échec, et en fait la connexion en succès (dial.go:147-185).
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(u.server.URL, "http")+path,
		&websocket.DialOptions{OnPingReceived: func(context.Context, []byte) bool {
			onPing()

			return true
		}})

	return conn, err
}

func (u *upstream) openedOn(path string) int {
	u.mu.Lock()
	defer u.mu.Unlock()

	return u.opened[path]
}

func (u *upstream) emit(t *testing.T, path, frame string) {
	t.Helper()

	u.mu.Lock()
	conns := append([]*websocket.Conn(nil), u.conns[path]...)
	u.mu.Unlock()

	require.NotEmpty(t, conns, "aucun consommateur sur %s", path)

	for _, conn := range conns {
		require.NoError(t, conn.Write(t.Context(), websocket.MessageText, []byte(frame)))
	}
}

// fastHub raccourcit toutes les échéances : les valeurs de production donneraient des tests de
// plusieurs dizaines de secondes.
func fastHub() *Hub {
	h := quietHub()
	h.leaseTTL = 600 * time.Millisecond
	h.leaseEvery = 100 * time.Millisecond
	h.heartbeatEvery = 100 * time.Millisecond
	h.heartbeatTimeout = 400 * time.Millisecond

	return h
}

func runHub(t *testing.T, h *Hub, dial Dialer, rdb *redis.Client, namespace string) context.CancelFunc {
	t.Helper()

	ctx, stop := context.WithCancel(t.Context())
	done := make(chan struct{})

	go func() {
		h.Run(ctx, dial, rdb, namespace)
		close(done)
	}()

	t.Cleanup(func() {
		stop()
		<-done
	})

	return stop
}

func subscribeTo(t *testing.T, h *Hub, topic string) *websocket.Conn {
	t.Helper()

	conn := dial(t, serveOn(t, h, grantAll))
	send(t, conn, `{"action":"subscribe","topics":["`+topic+`"]}`)
	awaitSubscribers(t, h, Topic(topic), 1)

	return conn
}

func awaitStatus(t *testing.T, conn *websocket.Conn, topic, status string) {
	t.Helper()

	for {
		message := next(t, conn)
		if message.Topic == topic && message.Status == status {
			return
		}
	}
}

func TestDeuxInstancesNOuvrentQuUneConnexionParFluxEtRediffusentToutes(t *testing.T) {
	t.Parallel()

	rdb, namespace := redisFor(t)
	gateway := newUpstream(t)
	first, second := fastHub(), fastHub()

	runHub(t, first, gateway.dial, rdb, namespace)
	runHub(t, second, gateway.dial, rdb, namespace)

	onFirst := subscribeTo(t, first, "sessions.events")
	onSecond := subscribeTo(t, second, "sessions.events")
	awaitStatus(t, onFirst, "sessions.events", "live")
	awaitStatus(t, onSecond, "sessions.events", "live")

	gateway.emit(t, "/admin/stream/sessions", sessionFrame)

	for _, conn := range []*websocket.Conn{onFirst, onSecond} {
		message := next(t, conn)
		assert.Equal(t, "sessions.events", message.Topic)
		assert.JSONEq(t, `{"accountId":"acct-7","systemId":"orange-ci-1","state":"bound","sessions":3}`,
			string(message.Data))
	}

	assert.Equal(t, 1, gateway.openedOn("/admin/stream/sessions"))
}

// Un porteur qui a perdu son bail doit lâcher la passerelle avant qu'un successeur ne la joigne.
func TestLaPerteDuBailFermeLesFluxAmont(t *testing.T) {
	t.Parallel()

	rdb, namespace := redisFor(t)
	gateway := newUpstream(t)
	h := fastHub()

	runHub(t, h, gateway.dial, rdb, namespace)
	conn := subscribeTo(t, h, "sessions.events")
	awaitStatus(t, conn, "sessions.events", "live")

	require.NoError(t, rdb.Set(t.Context(), namespace+":realtime:leader", "une-autre-instance", time.Minute).Err())

	awaitStatus(t, conn, "sessions.events", "stale")
	require.Eventually(t, func() bool {
		gateway.mu.Lock()
		defer gateway.mu.Unlock()

		for _, c := range gateway.conns["/admin/stream/sessions"] {
			if c.Ping(t.Context()) == nil {
				return false
			}
		}

		return true
	}, wait, 20*time.Millisecond, "la connexion amont est restée ouverte après la perte du bail")
}

// Sans battement de cœur, une instance ne sait plus si ce qu'elle affiche est frais.
func TestUnBattementDeCoeurManqueRendLesSujetsStale(t *testing.T) {
	t.Parallel()

	rdb, namespace := redisFor(t)
	// Un bail tenu ailleurs : cette instance ne fait que suivre.
	require.NoError(t, rdb.Set(t.Context(), namespace+":realtime:leader", "ailleurs", time.Minute).Err())

	h := fastHub()
	runHub(t, h, func(context.Context, string, func()) (*websocket.Conn, error) {
		t.Error("une instance sans bail a joint la passerelle")

		return nil, context.Canceled
	}, rdb, namespace)

	conn := subscribeTo(t, h, "metrics.traffic")
	assert.Equal(t, "stale", next(t, conn).Status)

	beat := func() {
		require.NoError(t, rdb.Publish(t.Context(), namespace+":realtime",
			`{"heartbeat":[{"topic":"metrics.traffic","status":"live"}]}`).Err())
	}

	require.Eventually(t, func() bool {
		beat()

		return h.status(TrafficTopic) == "live"
	}, wait, 50*time.Millisecond)
	awaitStatus(t, conn, "metrics.traffic", "live")

	awaitStatus(t, conn, "metrics.traffic", "stale")
}

// Dette 058 : une passerelle qui se tait sans fermer ne doit pas laisser le sujet live.
func TestUnFluxAmontMuetPasseStale(t *testing.T) {
	t.Parallel()

	rdb, namespace := redisFor(t)
	gateway := newUpstream(t)
	h := fastHub()
	h.upstreamSilence = 300 * time.Millisecond

	runHub(t, h, gateway.dial, rdb, namespace)
	conn := subscribeTo(t, h, "billing.alerts")
	awaitStatus(t, conn, "billing.alerts", "live")
	awaitStatus(t, conn, "billing.alerts", "stale")
}

func TestLesPingsAmontGardentLeFluxLive(t *testing.T) {
	t.Parallel()

	rdb, namespace := redisFor(t)
	gateway := newUpstream(t)
	gateway.pings = 50 * time.Millisecond
	h := fastHub()
	h.upstreamSilence = 300 * time.Millisecond

	runHub(t, h, gateway.dial, rdb, namespace)
	conn := subscribeTo(t, h, "billing.alerts")
	awaitStatus(t, conn, "billing.alerts", "live")

	ctx, cancel := context.WithTimeout(t.Context(), 4*h.upstreamSilence)
	defer cancel()

	for {
		_, raw, err := conn.Read(ctx)
		if err != nil {
			break
		}

		assert.NotContains(t, string(raw), `"stale"`, "les pings n'ont pas réarmé l'échéance")
	}
}

// Le battement republie tous les états toutes les 2 s : un client ne doit recevoir qu'un changement.
func TestUnEtatInchangeNEstPasRediffuse(t *testing.T) {
	t.Parallel()

	h := quietHub()
	conn := subscribeTo(t, h, "metrics.traffic")
	assert.Equal(t, "stale", next(t, conn).Status)

	beat := []byte(`{"heartbeat":[{"topic":"metrics.traffic","status":"live"}]}`)
	h.receive(beat)
	h.receive(beat)
	h.publish(TrafficTopic, []byte(`{"topic":"metrics.traffic","data":{}}`))

	assert.Equal(t, "live", next(t, conn).Status)
	assert.NotNil(t, next(t, conn).Data, "un état inchangé a été rediffusé")
}

// Pas de t.Parallel : le compte de goroutines est celui du processus entier.
func TestAucuneGoroutineNeSurvitALArretDuRelais(t *testing.T) {
	rdb, namespace := redisFor(t)
	gateway := newUpstream(t)
	before := goroutines()

	h := fastHub()
	ctx, stop := context.WithCancel(t.Context())
	done := make(chan struct{})

	go func() {
		h.Run(ctx, gateway.dial, rdb, namespace)
		close(done)
	}()

	require.Eventually(t, func() bool { return gateway.openedOn("/admin/stream/metrics") == 1 },
		wait, 20*time.Millisecond)

	stop()
	<-done
	gateway.server.CloseClientConnections()

	assert.Zero(t, rdb.Exists(t.Context(), namespace+":realtime:leader").Val(),
		"le bail n'a pas été rendu à l'arrêt : le successeur attendrait son expiration")
	awaitGoroutines(t, before)
}

// frozenRedis relaie TCP vers le Redis de test et sait geler le chemin : les octets sont avalés et
// rien n'est fermé, comme une partition ou une connexion à moitié morte. go-redis n'y voit alors
// qu'un appel qui ne rend pas la main.
type frozenRedis struct {
	listener net.Listener
	frozen   atomic.Bool
}

func newFrozenRedis(t *testing.T) (*frozenRedis, *redis.Client) {
	t.Helper()

	options, err := redis.ParseURL(redisURL)
	require.NoError(t, err)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = listener.Close() })

	relay := &frozenRedis{listener: listener}
	target := options.Addr

	go func() {
		for {
			client, err := listener.Accept()
			if err != nil {
				return
			}

			server, err := net.Dial("tcp", target)
			if err != nil {
				_ = client.Close()

				continue
			}

			t.Cleanup(func() { _ = client.Close(); _ = server.Close() })

			go relay.pipe(server, client)
			go relay.pipe(client, server)
		}
	}()

	options.Addr = listener.Addr().String()
	client := redis.NewClient(options)
	t.Cleanup(func() { _ = client.Close() })

	return relay, client
}

func (r *frozenRedis) pipe(dst, src net.Conn) {
	buffer := make([]byte, 32<<10)

	for {
		n, err := src.Read(buffer)
		if err != nil {
			return
		}

		if r.frozen.Load() {
			continue
		}

		if _, err = dst.Write(buffer[:n]); err != nil {
			return
		}
	}
}

// Le bloquant de la revue : un porteur coupé de Redis sans que la connexion tombe restait bloqué
// dans son renouvellement, pendant qu'un successeur prenait le bail et joignait la passerelle.
func TestUnPorteurCoupeDeRedisLacheLaPasserelleAvantLExpirationDuBail(t *testing.T) {
	t.Parallel()

	_, namespace := redisFor(t)
	relay, rdb := newFrozenRedis(t)
	gateway := newUpstream(t)
	h := fastHub()

	runHub(t, h, gateway.dial, rdb, namespace)
	require.Eventually(t, func() bool { return gateway.openedOn("/admin/stream/sessions") == 1 },
		wait, 20*time.Millisecond)

	relay.frozen.Store(true)
	frozenAt := time.Now()

	require.Eventually(t, func() bool {
		gateway.mu.Lock()
		defer gateway.mu.Unlock()

		for _, c := range gateway.conns["/admin/stream/sessions"] {
			if c.Ping(t.Context()) == nil {
				return false
			}
		}

		return true
	}, wait, 20*time.Millisecond)

	assert.Less(t, time.Since(frozenAt), h.leaseTTL,
		"les flux amont ont survécu à l'expiration du bail : un successeur les aurait doublés")
}

// Un état live reçu sans battement de cœur ensuite — au démarrage, ou quand Redis retombe avant le
// premier battement — doit finir stale : le chien de garde ne se désarme jamais.
func TestUnEtatLiveSansBattementFinitStale(t *testing.T) {
	t.Parallel()

	rdb, namespace := redisFor(t)
	require.NoError(t, rdb.Set(t.Context(), namespace+":realtime:leader", "ailleurs", time.Minute).Err())

	h := fastHub()
	runHub(t, h, func(context.Context, string, func()) (*websocket.Conn, error) {
		return nil, context.Canceled
	}, rdb, namespace)

	conn := subscribeTo(t, h, "metrics.traffic")
	assert.Equal(t, "stale", next(t, conn).Status)

	require.Eventually(t, func() bool {
		require.NoError(t, rdb.Publish(t.Context(), namespace+":realtime",
			`{"topic":"metrics.traffic","status":"live"}`).Err())

		return h.status(TrafficTopic) == "live"
	}, wait, 50*time.Millisecond)

	awaitStatus(t, conn, "metrics.traffic", "live")
	awaitStatus(t, conn, "metrics.traffic", "stale")
}
