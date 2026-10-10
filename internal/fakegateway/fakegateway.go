// Package fakegateway simule les trois flux temps réel de l'API Admin pour les scénarios godog.
// `scripts/fakegateway` le sert aussi comme processus, pour les parcours Playwright.
package fakegateway

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coreos/go-oidc/v3/oidc"
)

const (
	MetricsFeed  = "/admin/stream/metrics"
	SessionsFeed = "/admin/stream/sessions"
	BillingFeed  = "/admin/stream/billing-alerts"
)

// Gateway sert les trois flux de l'API Admin. Les trames sont celles de
// `go-gateway/internal/metricstream`, écrites à la main comme la passerelle les sérialise.
type Gateway struct {
	mu        sync.Mutex
	accepting map[string]bool
	conns     map[string][]*websocket.Conn
	opened    map[string]int
}

func New() *Gateway {
	return &Gateway{
		accepting: map[string]bool{MetricsFeed: true, SessionsFeed: true, BillingFeed: true},
		conns:     map[string][]*websocket.Conn{},
		opened:    map[string]int{},
	}
}

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		http.Error(w, "jeton absent", http.StatusUnauthorized)

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

// Emit attend qu'un consommateur soit branché : le serveur ouvre ses flux au démarrage, et une trame
// émise avant n'atteindrait personne.
func (g *Gateway) Emit(feed, frame string, within time.Duration) error {
	deadline := time.Now().Add(within)

	for {
		g.mu.Lock()
		conns := append([]*websocket.Conn(nil), g.conns[feed]...)
		g.mu.Unlock()

		// Une connexion dont le consommateur est mort sans fermer (instance tuée) échoue à l'écriture
		// avant d'avoir été retirée : elle ne compte pas.
		delivered := 0

		for _, conn := range conns {
			ctx, cancel := context.WithTimeout(context.Background(), within)
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

func (g *Gateway) Cut(feed string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	g.accepting[feed] = false
	for _, conn := range g.conns[feed] {
		_ = conn.Close(websocket.StatusGoingAway, "coupure du scénario")
	}
	g.conns[feed] = nil
}

func (g *Gateway) Reopen(feed string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	g.accepting[feed] = true
}

func (g *Gateway) Opened(feed string) int {
	g.mu.Lock()
	defer g.mu.Unlock()

	return g.opened[feed]
}

// Verifier juge chaque requête comme la passerelle (go-oidc, iss, aud, ES256) avant de servir les flux
// de Gateway ou une liste vide de groupes, et retient qui a appelé.
type Verifier struct {
	streams  *Gateway
	verifier *oidc.IDTokenVerifier
	mu       sync.Mutex
	seen     []Principal
}

type Principal struct{ Path, Subject, Scope, Cookie, Token string }

func Verifying(issuer, jwksURL string) *Verifier {
	keys := oidc.NewRemoteKeySet(context.Background(), jwksURL)

	return &Verifier{streams: New(), verifier: oidc.NewVerifier(issuer, keys,
		&oidc.Config{ClientID: "gateway-admin", SupportedSigningAlgs: []string{oidc.ES256}})}
}

func (v *Verifier) Seen() []Principal {
	v.mu.Lock()
	defer v.mu.Unlock()

	return slices.Clone(v.seen)
}

func (v *Verifier) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	idToken, err := v.verifier.Verify(r.Context(), raw)

	var claims struct {
		Scope string `json:"scope"`
	}

	if err != nil || idToken.Claims(&claims) != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"code":"unauthenticated","message":"jeton refusé"}`))

		return
	}

	v.mu.Lock()
	v.seen = append(v.seen, Principal{
		Path: r.URL.Path, Subject: idToken.Subject, Scope: claims.Scope,
		Cookie: r.Header.Get("Cookie"), Token: raw,
	})
	v.mu.Unlock()

	if strings.HasPrefix(r.URL.Path, "/admin/stream/") {
		v.streams.ServeHTTP(w, r)

		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`[]`))
}
