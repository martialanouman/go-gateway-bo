// Package fakegateway simule les trois flux temps réel de l'API Admin pour les scénarios godog et,
// servi comme processus par `scripts/fakegateway`, pour les parcours Playwright.
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
