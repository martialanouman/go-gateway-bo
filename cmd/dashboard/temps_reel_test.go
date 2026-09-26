package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/cucumber/godog"
	"github.com/getkin/kin-openapi/openapi3"
)

const (
	metricsFeed  = "/admin/stream/metrics"
	sessionsFeed = "/admin/stream/sessions"
	billingFeed  = "/admin/stream/billing-alerts"
)

// fakeGateway sert les trois flux de l'API Admin. Les trames sont celles de
// `go-gateway/internal/metricstream`, écrites à la main comme la passerelle les sérialise.
type fakeGateway struct {
	server    *httptest.Server
	mu        sync.Mutex
	accepting map[string]bool
	conns     map[string][]*websocket.Conn
	opened    map[string]int
}

func newFakeGateway() *fakeGateway {
	g := &fakeGateway{
		accepting: map[string]bool{metricsFeed: true, sessionsFeed: true, billingFeed: true},
		conns:     map[string][]*websocket.Conn{},
		opened:    map[string]int{},
	}
	g.server = httptest.NewServer(http.HandlerFunc(g.serve))

	return g
}

func (g *fakeGateway) serve(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		http.Error(w, "jeton machine absent", http.StatusUnauthorized)

		return
	}

	g.mu.Lock()
	accepting, known := g.accepting[r.URL.Path]
	g.mu.Unlock()

	if !known {
		http.NotFound(w, r)

		return
	}

	if !accepting {
		http.Error(w, "flux coupé par le scénario", http.StatusServiceUnavailable)

		return
	}

	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}

	g.mu.Lock()
	g.conns[r.URL.Path] = append(g.conns[r.URL.Path], conn)
	g.opened[r.URL.Path]++
	g.mu.Unlock()

	<-conn.CloseRead(context.Background()).Done()

	g.mu.Lock()
	g.conns[r.URL.Path] = slices.DeleteFunc(g.conns[r.URL.Path], func(c *websocket.Conn) bool { return c == conn })
	g.mu.Unlock()
}

// emit attend qu'un consommateur soit branché : le serveur ouvre ses flux au démarrage, et une trame
// émise avant n'atteindrait personne.
func (g *fakeGateway) emit(feed, frame string) error {
	deadline := time.Now().Add(socketWait)

	for {
		g.mu.Lock()
		conns := append([]*websocket.Conn(nil), g.conns[feed]...)
		g.mu.Unlock()

		// Une connexion dont le consommateur est mort sans fermer (instance tuée) échoue à l'écriture
		// avant d'avoir été retirée : elle ne compte pas.
		delivered := 0

		for _, conn := range conns {
			ctx, cancel := context.WithTimeout(context.Background(), socketWait)
			if conn.Write(ctx, websocket.MessageText, []byte(frame)) == nil {
				delivered++
			}
			cancel()
		}

		if delivered > 0 {
			return nil
		}

		if time.Now().After(deadline) {
			return fmt.Errorf("aucun consommateur branché sur %s", feed)
		}

		time.Sleep(20 * time.Millisecond)
	}
}

func (g *fakeGateway) cut(feed string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	g.accepting[feed] = false
	for _, conn := range g.conns[feed] {
		_ = conn.Close(websocket.StatusGoingAway, "coupure du scénario")
	}
	g.conns[feed] = nil
}

func (g *fakeGateway) reopen(feed string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	g.accepting[feed] = true
}

// socketWait borne chaque attente sur la socket. La reprise d'un flux coupé attend le premier palier
// du backoff, une seconde.
const socketWait = 5 * time.Second

// statusWait couvre une bascule : trois battements manqués (6 s), relevés à la tick suivante (2 s),
// et un bail repris au plus 8 s après la mort de son porteur.
const statusWait = 15 * time.Second

type realtimeWorld struct {
	process  *process
	gateway  *fakeGateway
	conn     *websocket.Conn
	expected map[string]any
	contract *openapi3.T
	second   *process
	redis    *redisRelay
}

type socketMessage struct {
	Topic  string         `json:"topic"`
	Status string         `json:"status"`
	Data   map[string]any `json:"data"`
	Error  *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func (w *realtimeWorld) registerSteps(ctx *godog.ScenarioContext) {
	ctx.Given(`^une passerelle qui diffuse ses trois flux$`, w.startGateway)
	ctx.When(`^le navigateur ouvre la socket$`, func() error { return w.requestUpgrade(configuredOrigin) })
	ctx.When(`^le navigateur ouvre la socket depuis l'origine "([^"]*)"$`, w.requestUpgrade)
	ctx.Given(`^la socket est ouverte$`, w.openSocket)
	ctx.Given(`^l'opérateur s'abonne à "([^"]*)"$`, w.subscribe)
	ctx.When(`^l'opérateur s'abonne à "([^"]*)"$`, w.subscribe)
	ctx.Step(`^le sujet "([^"]*)" est annoncé "([^"]*)"$`, w.statusIs)
	ctx.When(`^la passerelle émet un événement de session$`, w.emitSessionEvent)
	ctx.When(`^la passerelle émet une alerte de facturation$`, w.emitBillingAlert)
	ctx.When(`^la passerelle émet un instantané de métriques$`, w.emitSnapshot)
	ctx.When(`^la passerelle coupe le flux des sessions$`, func() error {
		w.gateway.cut(sessionsFeed)

		return nil
	})
	ctx.When(`^la passerelle rouvre le flux des sessions$`, func() error {
		w.gateway.reopen(sessionsFeed)

		return nil
	})
	ctx.Then(`^la socket reçoit (?:cet événement|cet instantané) sur "([^"]*)"$`, w.receivesExpected)
	ctx.Then(`^la socket refuse "([^"]*)" en nommant "([^"]*)"$`, w.refuses)
	ctx.Then(`^aucune trame "([^"]*)" n'arrive$`, w.nothingArrives)
	ctx.Given(`^deux instances démarrées, la première portant le bail$`, w.startTwoInstances)
	ctx.Given(`^la socket est ouverte sur la seconde instance$`, func() error {
		return w.openSocketAt(w.second.addr)
	})
	ctx.Then(`^la passerelle compte (\d+) connexions? sur le flux des sessions$`, w.gatewayCounts)
	ctx.When(`^la première instance est tuée$`, func() error {
		w.process.kill()

		return nil
	})
	ctx.When(`^Redis devient injoignable$`, func() error {
		w.redis.cut()

		return nil
	})
	ctx.Then(`^le refus a la forme d'erreur du contrat$`, func() error {
		return w.conformsTo("Error", []byte(w.process.received.body))
	})

	ctx.After(func(ctx context.Context, _ *godog.Scenario, err error) (context.Context, error) {
		if w.conn != nil {
			_ = w.conn.CloseNow()
		}

		if w.second != nil {
			w.second.kill()
		}

		if w.redis != nil {
			w.redis.cut()
		}

		if w.gateway != nil {
			w.gateway.server.CloseClientConnections()
			w.gateway.server.Close()
		}

		return ctx, err
	})
}

func (w *realtimeWorld) startGateway() error {
	w.gateway = newFakeGateway()

	if w.process.env == nil {
		w.process.env = completeConfiguration()
	}
	w.process.env["DASHBOARD_GATEWAY_BASE_URL"] = w.gateway.server.URL

	return nil
}

// requestUpgrade demande la socket sans l'ouvrir : un refus arrive avant la montée, en HTTP, et c'est
// cette réponse que le contrat décrit.
func (w *realtimeWorld) requestUpgrade(origin string) error {
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet,
		w.process.url("/ws"), nil)
	if err != nil {
		return err
	}

	request.Header.Set("Origin", origin)
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Upgrade", "websocket")
	request.Header.Set("Sec-WebSocket-Version", "13")
	request.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")

	return w.process.exchange(request)
}

func (w *realtimeWorld) openSocket() error {
	return w.openSocketAt(w.process.addr)
}

func (w *realtimeWorld) openSocketAt(addr string) error {
	header := http.Header{"Origin": {configuredOrigin}}
	for name, value := range w.process.cookies {
		header.Add("Cookie", (&http.Cookie{Name: name, Value: value}).String())
	}

	ctx, cancel := context.WithTimeout(context.Background(), socketWait)
	defer cancel()

	//nolint:bodyclose // Dial ferme le corps en échec, et en fait la connexion en succès (dial.go:147-185).
	conn, resp, err := websocket.Dial(ctx, "ws://"+addr+"/ws",
		&websocket.DialOptions{HTTPHeader: header})
	if err != nil {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}

		return fmt.Errorf("ouvrir la socket (%d) : %w", status, err)
	}

	w.conn = conn

	return nil
}

func (w *realtimeWorld) subscribe(topic string) error {
	ctx, cancel := context.WithTimeout(context.Background(), socketWait)
	defer cancel()

	return w.conn.Write(ctx, websocket.MessageText,
		fmt.Appendf(nil, `{"action":"subscribe","topics":[%q]}`, topic))
}

// readUntil lit la socket jusqu'au premier message que match accepte, en écartant les autres.
func (w *realtimeWorld) readUntil(within time.Duration, match func(socketMessage) bool) (socketMessage, error) {
	ctx, cancel := context.WithTimeout(context.Background(), within)
	defer cancel()

	for {
		_, raw, err := w.conn.Read(ctx)
		if err != nil {
			return socketMessage{}, err
		}

		var message socketMessage
		if err = json.Unmarshal(raw, &message); err != nil {
			return socketMessage{}, fmt.Errorf("message illisible %s : %w", raw, err)
		}

		if err = w.conformsTo(schemaOf(message), raw); err != nil {
			return socketMessage{}, err
		}

		if match(message) {
			return message, nil
		}
	}
}

func (w *realtimeWorld) statusIs(topic, status string) error {
	_, err := w.readUntil(statusWait, func(m socketMessage) bool {
		return m.Topic == topic && m.Status == status
	})
	if err != nil {
		return fmt.Errorf("%s n'a pas été annoncé %q : %w", topic, status, err)
	}

	return nil
}

func (w *realtimeWorld) emitSessionEvent() error {
	w.expected = map[string]any{
		"accountId": "acct-7", "systemId": "orange-ci-1", "state": "bound", "sessions": float64(3),
	}

	return w.gateway.emit(sessionsFeed, `{"v":1,"feed":"sessions","service":"smpp-server",`+
		`"instance":"smpp-0","emitted_at":"2026-09-26T10:00:00Z","account_id":"acct-7",`+
		`"system_id":"orange-ci-1","state":"bound","sessions":3}`)
}

func (w *realtimeWorld) emitBillingAlert() error {
	return w.gateway.emit(billingFeed, `{"v":1,"feed":"billing-alerts","service":"billing",`+
		`"instance":"billing-0","emitted_at":"2026-09-26T10:00:00Z","customer_id":"cust-1",`+
		`"owner_type":"customer","owner_id":"cust-1","alert":"mo_floor_reached","balance":5000}`)
}

func (w *realtimeWorld) emitSnapshot() error {
	w.expected = map[string]any{"instance": "router-1"}

	return w.gateway.emit(metricsFeed, `{"v":1,"feed":"metrics","service":"router",`+
		`"instance":"router-1","emitted_at":"2026-09-26T10:00:00Z",`+
		`"samples":[{"kind":"messages_routed_total","labels":{"connector":"orange-ci"},"value":120}]}`)
}

func (w *realtimeWorld) receivesExpected(topic string) error {
	message, err := w.readUntil(socketWait, func(m socketMessage) bool {
		return m.Topic == topic && m.Data != nil
	})
	if err != nil {
		return fmt.Errorf("rien n'est arrivé sur %s : %w", topic, err)
	}

	for field, want := range w.expected {
		if message.Data[field] != want {
			return fmt.Errorf("%s : %s vaut %v, %v attendu (%v)", topic, field, message.Data[field], want,
				message.Data)
		}
	}

	return nil
}

func (w *realtimeWorld) refuses(topic, key string) error {
	message, err := w.readUntil(socketWait, func(m socketMessage) bool {
		return m.Topic == topic && m.Error != nil
	})
	if err != nil {
		return fmt.Errorf("%s n'a pas été refusé : %w", topic, err)
	}

	if !strings.Contains(message.Error.Message, key) {
		return fmt.Errorf("le refus ne nomme pas %s : %q", key, message.Error.Message)
	}

	return nil
}

// nothingArrives attend une seconde : les trois flux sont consommés en parallèle, et aucun ordre ne
// lie la trame refusée à une autre qu'on attendrait à sa place.
func (w *realtimeWorld) nothingArrives(topic string) error {
	message, err := w.readUntil(time.Second, func(m socketMessage) bool {
		return m.Topic == topic && m.Data != nil
	})
	if errors.Is(err, context.DeadlineExceeded) {
		return nil
	}

	if err != nil {
		return err
	}

	return fmt.Errorf("une trame %s est arrivée : %v", topic, message.Data)
}

func schemaOf(message socketMessage) string {
	switch {
	case message.Error != nil:
		return "RealtimeRefusal"
	case message.Status != "":
		return "RealtimeStatus"
	default:
		return "RealtimeData"
	}
}

func (w *realtimeWorld) conformsTo(schema string, raw []byte) error {
	if w.contract == nil {
		contract, err := (&openapi3.Loader{Context: context.Background()}).LoadFromFile(contractPath)
		if err != nil {
			return fmt.Errorf("lecture du contrat %s : %w", contractPath, err)
		}

		w.contract = contract
	}

	ref, declared := w.contract.Components.Schemas[schema]
	if !declared {
		return fmt.Errorf("le contrat ne déclare pas %s", schema)
	}

	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return fmt.Errorf("%s illisible : %w", schema, err)
	}

	if err := ref.Value.VisitJSON(value); err != nil {
		return fmt.Errorf("%s ne valide pas %s : %w", raw, schema, err)
	}

	return nil
}

// startTwoInstances démarre la première seule, et attend qu'elle ait ouvert les trois flux : c'est
// elle qui porte le bail. Les deux joignent Redis à travers un relais que le harnais sait couper.
func (w *realtimeWorld) startTwoInstances() error {
	relay, err := newRedisRelay(suiteRedisURL)
	if err != nil {
		return err
	}

	w.redis = relay
	w.process.env["DASHBOARD_REDIS_URL"] = relay.url

	if err = w.process.startAndServe(); err != nil {
		return err
	}

	for _, feed := range []string{metricsFeed, sessionsFeed, billingFeed} {
		if err = w.awaitOpened(feed, 1); err != nil {
			return fmt.Errorf("la première instance n'a pas pris le bail : %w", err)
		}
	}

	w.second = &process{visited: w.process.visited, env: maps.Clone(w.process.env)}

	return w.second.startAndServe()
}

func (w *realtimeWorld) awaitOpened(feed string, want int) error {
	deadline := time.Now().Add(statusWait)

	for {
		w.gateway.mu.Lock()
		opened := w.gateway.opened[feed]
		w.gateway.mu.Unlock()

		if opened == want {
			return nil
		}

		if opened > want || time.Now().After(deadline) {
			return fmt.Errorf("%d connexion(s) sur %s, %d attendue(s)", opened, feed, want)
		}

		time.Sleep(50 * time.Millisecond)
	}
}

// gatewayCounts laisse passer un battement de bail avant de compter : une seconde connexion ouverte
// par l'instance sans bail arriverait dans ce délai.
func (w *realtimeWorld) gatewayCounts(want int) error {
	if err := w.awaitOpened(sessionsFeed, want); err != nil {
		return err
	}

	time.Sleep(3 * time.Second)

	return w.awaitOpened(sessionsFeed, want)
}

// redisRelay relaie TCP vers le Redis de la suite. Le couper ferme les connexions ouvertes et refuse
// les suivantes : c'est une panne de Redis vue des instances, sans toucher au Redis partagé.
type redisRelay struct {
	url      string
	listener net.Listener
	mu       sync.Mutex
	conns    []net.Conn
	closed   bool
}

func newRedisRelay(target string) (*redisRelay, error) {
	parsed, err := url.Parse(target)
	if err != nil {
		return nil, fmt.Errorf("adresse du Redis de la suite : %w", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("relais Redis : %w", err)
	}

	upstream := parsed.Host
	parsed.Host = listener.Addr().String()
	relay := &redisRelay{url: parsed.String(), listener: listener}

	go func() {
		for {
			client, err := listener.Accept()
			if err != nil {
				return
			}

			server, err := net.Dial("tcp", upstream)
			if err != nil {
				_ = client.Close()

				continue
			}

			if !relay.track(client, server) {
				return
			}

			go func() { _, _ = io.Copy(server, client); _ = server.Close() }()
			go func() { _, _ = io.Copy(client, server); _ = client.Close() }()
		}
	}()

	return relay, nil
}

func (r *redisRelay) track(conns ...net.Conn) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.closed {
		for _, conn := range conns {
			_ = conn.Close()
		}

		return false
	}

	r.conns = append(r.conns, conns...)

	return true
}

func (r *redisRelay) cut() {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.closed {
		return
	}

	r.closed = true
	_ = r.listener.Close()

	for _, conn := range r.conns {
		_ = conn.Close()
	}
}
