// Package bff porte les routes HTTP servies au navigateur : leurs gardes de permission, leur
// écriture d'audit et leurs DTO de sortie.
//
// Il est le seul point de contact du client avec le serveur — le navigateur ne joint jamais l'API
// Admin (invariant d), et `internal/` rend cette frontière inatteignable depuis l'extérieur du
// module.
package bff

import (
	"io/fs"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// NewRouter assemble les routes du BFF et le service des assets de la SPA. `assets` a pour racine la
// racine du site : la coquille y est `index.html`, les fichiers hachés sous `assets/`. Le prendre en
// `fs.FS` plutôt qu'en `embed.FS` est ce qui permet de tester le repli sans build client.
//
// Le repli n'est monté qu'en GET et HEAD : une écriture sur une route non montée est une erreur
// d'appelant, à qui chi rend alors 405 plutôt que la coquille en 200.
func NewRouter(assets fs.FS) http.Handler {
	r := chi.NewRouter()

	r.Route("/api", func(api chi.Router) {
		api.Get("/health", handleHealth)

		// Deux raisons, et l'ordre des lignes n'en est pas une. La première est la forme : un
		// `/api/*` inconnu rend le DTO d'erreur du produit, pas le texte brut de chi. La seconde
		// est un filet : chi propage le `NotFound` de la racine à tout sous-routeur qui n'en
		// déclare pas (`mux.go:212-216` à la déclaration, `308-309` au montage). Le jour où le
		// repli ci-dessous passerait de `r.Get("/*")` à `r.NotFound()`, cette ligne serait la seule
		// chose empêchant `/api/inconnu` de rendre 200 + HTML. Vérifié sur chi v5.3.1.
		api.NotFound(handleUnknownAPIRoute)
	})

	// Déclarée avant d'exister (step-043) : sans elle, un client WebSocket tomberait dans le repli
	// et recevrait du HTML en 200 au lieu d'un refus lisible.
	r.HandleFunc("/ws", handleRealtimeNotImplemented)

	asset := serveAsset(assets)
	r.Get("/assets/*", asset)
	r.Head("/assets/*", asset)

	shell := serveShell(assets)
	r.Get("/*", shell)
	r.Head("/*", shell)

	return r
}

func handleUnknownAPIRoute(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotFound, errorResponse{
		Code:    "not_found",
		Message: "Cette route n'existe pas sur ce serveur.",
	})
}

func handleRealtimeNotImplemented(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotImplemented, errorResponse{
		Code:    "not_implemented",
		Message: "Le canal temps réel n'est pas encore disponible.",
	})
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
