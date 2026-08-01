// Package bff porte les routes HTTP servies au navigateur : leurs gardes de permission, leur
// écriture d'audit et leurs DTO de sortie.
//
// Il est le seul point de contact du client avec le serveur — le navigateur ne joint jamais l'API
// Admin (invariant d), et `internal/` rend cette frontière inatteignable depuis l'extérieur du
// module.
package bff

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// NewRouter assemble les routes du BFF. Tout ce qu'il monte vit sous `/api` : le repli vers la SPA
// s'ordonne après lui (step-002), pour qu'un `/api/*` inconnu rende 404 et jamais du HTML.
func NewRouter() http.Handler {
	r := chi.NewRouter()

	r.Route("/api", func(api chi.Router) {
		api.Get("/health", handleHealth)
	})

	return r
}

// healthResponse est le DTO de sortie de la sonde. Chaque réponse du BFF déclare le sien : un champ
// absent du struct ne peut pas fuir (§1.11).
type healthResponse struct {
	Status string `json:"status"`
}

// handleHealth ne touche ni la base ni la passerelle : c'est une sonde de **vivacité**, qui répond
// « le process est en vie », pas « le service est disponible ». Y brancher une dépendance ferait
// redémarrer un serveur sain parce qu'une autre brique est tombée.
func handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
}
