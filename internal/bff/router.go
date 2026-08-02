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
		// Les routes du contrat sont montées par le code qu'il engendre : le chemin, la méthode et le
		// type de la réponse viennent tous du YAML, aucun n'est réécrit ici. La valeur de retour est
		// sans usage — c'est le routeur passé qu'elle garnit (`bff.gen.go`, `HandlerWithOptions`), et
		// le préfixe `/api` vient de ce `Route`, pas de `servers.url`.
		HandlerFromMux(newContractHandler(API{}), api)

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

// newContractHandler enveloppe l'implémentation stricte, et remplace les deux gestionnaires d'erreur
// qu'oapi-codegen installe par défaut. Ceux-là écrivent `http.Error(w, err.Error(), …)`
// (`bff.gen.go`, `NewStrictHandler`) : le message Go **brut**, en `text/plain`. Une route future qui
// enveloppe son erreur — `fmt.Errorf("appel de %s: %w", cfg.Gateway.BaseURL, err)` — servirait alors
// l'adresse interne de l'API Admin au navigateur, dans un corps dont le client n'a aucun type.
//
// L'erreur n'est ni journalisée ni propagée, et c'est un manque assumé plutôt qu'un oubli : aucun
// journal n'atteint ce paquet aujourd'hui — `NewRouter` ne prend que les assets, et le `*slog.Logger`
// s'arrête à `cmd/dashboard`. Un 500 servi ici ne laisse donc **aucune trace côté serveur**. Le
// premier appel réel à la passerelle (step-060) devra apporter les deux à la fois.
func newContractHandler(impl StrictServerInterface) ServerInterface {
	return NewStrictHandlerWithOptions(impl, nil, StrictHTTPServerOptions{
		RequestErrorHandlerFunc:  rejectRequest,
		ResponseErrorHandlerFunc: reportFailedResponse,
	})
}

// rejectRequest répond à une requête que le code engendré n'a pas su lier au contrat — un paramètre
// requis absent, un format illisible. Le message d'origine est écarté plutôt que rendu : il nomme des
// champs internes, et il part avec, faute de journal ici (voir `newContractHandler`).
func rejectRequest(w http.ResponseWriter, _ *http.Request, _ error) {
	writeJSON(w, http.StatusBadRequest, errorResponse{
		Code:    "bad_request",
		Message: "Cette requête a été refusée : sa forme ne correspond pas à ce que la route attend.",
	})
}

func reportFailedResponse(w http.ResponseWriter, _ *http.Request, _ error) {
	writeJSON(w, http.StatusInternalServerError, errorResponse{
		Code:    "internal_error",
		Message: "Le serveur n'a pas pu produire cette réponse. Réessayez ; si elle persiste, la panne est côté serveur.",
	})
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
