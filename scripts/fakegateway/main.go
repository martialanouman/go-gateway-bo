// Command fakegateway sert `internal/fakegateway` comme processus, pour que les parcours Playwright
// aient un amont : le mock Prism ne sert pas les flux temps réel, que ces parcours seuls exercent
// contre le vrai binaire, et ne garde pas l'état des groupes et des clients qu'un parcours crée.
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

	customers := &fakegateway.Customers{}
	groups := &fakegateway.Groups{Members: customers}
	mux.Handle(fakegateway.GroupsPath, groups)
	mux.Handle(fakegateway.GroupsPath+"/{id}", groups)
	mux.Handle(fakegateway.CustomersPath, customers)
	mux.Handle(fakegateway.CustomersPath+"/{id}", customers)
	mux.Handle(fakegateway.CustomersPath+"/{id}/{action}", customers)
	mux.Handle(fakegateway.CustomersPath+"/{id}/{action}/{senderId}", customers)
	mux.HandleFunc("/admin/smpp-accounts", customers.ServeAccounts)
	mux.HandleFunc("/admin/smpp-accounts/{id}", customers.ServeAccount)
	mux.HandleFunc("/admin/smpp-accounts/{id}/{action}", customers.ServeAccount)
	mux.HandleFunc("/admin/smpp-accounts/{id}/{action}/{itemId}", customers.ServeAccount)
	mux.HandleFunc("/admin/smpp-accounts/{id}/{action}/{itemId}/{verb}", customers.ServeAccount)
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
