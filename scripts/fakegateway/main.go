// Command fakegateway sert `internal/fakegateway` comme processus, pour que les parcours Playwright
// aient un amont : le mock Prism ne sert pas les flux temps réel, que ces parcours seuls exercent
// contre le vrai binaire.
package main

import (
	"flag"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/fakegateway"
)

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
		frame, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err == nil {
			err = gateway.Emit(r.URL.Query().Get("feed"), string(frame), 10*time.Second)
		}

		if err != nil {
			http.Error(w, err.Error(), http.StatusConflict)

			return
		}

		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /control/cut", func(w http.ResponseWriter, r *http.Request) {
		gateway.Cut(r.URL.Query().Get("feed"))
		w.WriteHeader(http.StatusNoContent)
	})

	server := &http.Server{
		Addr:              *addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Fatal(server.ListenAndServe())
}
