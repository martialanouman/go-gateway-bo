// Command fakegateway sert `internal/fakegateway` comme processus, pour que les parcours Playwright
// aient un amont : le mock Prism ne sert pas les flux temps réel, que ces parcours seuls exercent
// contre le vrai binaire.
package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"slices"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/fakegateway"
)

var knownFeeds = []string{fakegateway.MetricsFeed, fakegateway.SessionsFeed, fakegateway.BillingFeed}

func main() {
	addr := flag.String("addr", "127.0.0.1:4011", "adresse d'écoute")
	flag.Parse()

	gateway := fakegateway.New()
	mux := http.NewServeMux()
	mux.Handle("/admin/stream/", gateway)
	mux.HandleFunc("GET /control/ready", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /control/emit", func(w http.ResponseWriter, r *http.Request) {
		feed := r.URL.Query().Get("feed")
		if !slices.Contains(knownFeeds, feed) {
			http.Error(w, fmt.Sprintf("flux inconnu : %q", feed), http.StatusBadRequest)

			return
		}

		frame, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err == nil {
			err = gateway.Emit(feed, string(frame), 10*time.Second)
		}

		if err != nil {
			http.Error(w, err.Error(), http.StatusConflict)

			return
		}

		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /control/cut", func(w http.ResponseWriter, r *http.Request) {
		feed := r.URL.Query().Get("feed")
		if !slices.Contains(knownFeeds, feed) {
			http.Error(w, fmt.Sprintf("flux inconnu : %q", feed), http.StatusBadRequest)

			return
		}

		gateway.Cut(feed)
		w.WriteHeader(http.StatusNoContent)
	})

	server := &http.Server{
		Addr:              *addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Fatal(server.ListenAndServe())
}
