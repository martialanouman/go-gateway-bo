// Package bff porte la surface HTTP du tableau de bord et son cycle de vie.
package bff

import (
	"encoding/json"
	"io/fs"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// NewRouter monte la surface du BFF puis le repli SPA.
//
// **L'ordre entre les deux est le cœur de step-002.** Un repli monté avant les
// routes d'API rendrait 200 + HTML sur `/api/inconnu` ; le client lit
// `response.ok` puis appelle `.json()`, il lève, et l'écran affiche
// « indisponible » au lieu de « introuvable ».
func NewRouter(assets fs.FS) http.Handler {
	router := chi.NewRouter()

	router.Route("/api", func(api chi.Router) {
		// **Déclaration indispensable, pas défensive.** chi propage le
		// `NotFound` du routeur parent à ses sous-routeurs : sans cette ligne,
		// le repli SPA attraperait `/api/inconnu` et rendrait l'index.
		api.NotFound(handleUnknownAPI)

		api.Get("/health", handleHealth)
	})

	router.NotFound(serveClient(assets))

	return router
}

// errorResponse reprend l'enveloppe plate de l'API Admin (§1.4) : une seule
// forme d'erreur dans tout le produit.
type errorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func handleUnknownAPI(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotFound, errorResponse{
		Code:    "not_found",
		Message: "Cette opération n'existe pas.",
	})
}

// healthResponse est un struct déclaré et non un littéral JSON : c'est la
// convention §1.11 qui porte l'invariant (a), et le premier handler du dépôt
// fixe le précédent pour tous les suivants. Un littéral échapperait au test de
// DTO de step-026 aussi sûrement qu'une `map[string]any`, mais sans qu'aucune
// règle ne puisse le voir.
type healthResponse struct {
	Status string `json:"status"`
}

// Sonde de **vivacité**, pas de disponibilité : elle ne touche ni la base ni la
// passerelle. La sonde de disponibilité arrive en step-186.
func handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
}

// Sérialise **avant** d'écrire le statut : encoder directement dans le
// `ResponseWriter` laisse partir un 200 dont le corps est tronqué si le
// marshalling échoue en route (un `NaN`, un `MarshalJSON` fautif), et le client
// voit un écran vide sans que rien ne le signale.
//
// Le paramètre reste `any` : Go ne sait pas exprimer « un struct déclaré », et
// c'est le test de DTO de step-026 qui refusera `map[string]any` et l'embedding.
// Aucun test de step-000 ne rougit si quelqu'un passe une map ici — noté plutôt
// que masqué par une garde qui n'en serait pas une.
func writeJSON(w http.ResponseWriter, status int, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		http.Error(w, `{"code":"internal"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}
