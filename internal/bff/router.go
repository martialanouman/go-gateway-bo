// Package bff porte la surface HTTP du tableau de bord et son cycle de vie.
package bff

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// NewRouter monte la surface du BFF. Tout vit sous /api : step-002 posera le
// repli SPA, et l'ordre entre les deux est ce qui empêche un /api inconnu de
// rendre du HTML.
func NewRouter() http.Handler {
	router := chi.NewRouter()

	router.Route("/api", func(api chi.Router) {
		api.Get("/health", handleHealth)
	})

	return router
}

// Sonde de **vivacité**, pas de disponibilité : elle ne touche ni la base ni la
// passerelle. La sonde de disponibilité arrive en step-186.
func handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}
