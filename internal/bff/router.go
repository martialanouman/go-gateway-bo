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
		mountContract(api, API{})

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

// mountContract monte sur `api` les routes du contrat, servies par `impl`. Le chemin, la méthode et le
// type de la réponse viennent tous du YAML, aucun n'est réécrit ici ; le préfixe `/api` vient du
// `r.Route` ci-dessus, pas de `servers.url`. La valeur de retour de `HandlerWithOptions` est sans
// usage — c'est le routeur passé qu'elle garnit.
//
// oapi-codegen installe **trois** gestionnaires d'erreur par défaut, sur deux étages distincts, et
// tous les trois écrivent `http.Error(w, err.Error(), …)` : le message Go brut, en `text/plain`, dans
// un corps dont le client n'a aucun type. `newContractHandler` en remplace deux ; celui-ci est le
// troisième, et c'est le plus exposé des trois.
//
// C'est lui — `ServerInterfaceWrapper.ErrorHandlerFunc` — que le wrapper engendré appelle quand la
// liaison échoue sur un paramètre de requête, un paramètre de chemin, un en-tête ou un cookie
// (`chi-middleware.tmpl` d'oapi-codegen v2.8.0, 14 sites d'appel). `HandlerFromMux` ne permet pas de
// le poser : il délègue à `HandlerWithOptions` sans l'option, donc avec le défaut.
//
// Mesuré le 02/08/2026, contrat muté avec un paramètre de requête `depuis` requis, régénéré, requête
// réelle à travers `NewRouter` : `HandlerFromMux` rend `400 text/plain; charset=utf-8` et le corps
// `Query argument depuis is required, but not found` ; la forme ci-dessous rend `400
// application/json` et le DTO d'erreur du produit. Le contrat a ensuite été restauré et régénéré.
// `GET /health` n'ayant ni paramètre ni en-tête requis, aucune requête que le contrat autorise
// n'atteint ce gestionnaire aujourd'hui : c'est `TestTheContractMountInstallsTheProductErrorHandler`
// qui garde le montage, faute de pouvoir l'exercer.
func mountContract(api chi.Router, impl StrictServerInterface) {
	HandlerWithOptions(newContractHandler(impl), ChiServerOptions{
		BaseRouter:       api,
		ErrorHandlerFunc: rejectRequest,
	})
}

// newContractHandler enveloppe l'implémentation stricte, et remplace les deux gestionnaires d'erreur
// que le **handler strict** installe par défaut (`bff.gen.go`, `NewStrictHandler`). Ce sont deux des
// trois d'oapi-codegen ; le troisième vit un étage plus bas et se pose dans `mountContract`.
//
// Ce que ces deux-là couvrent exactement, lu dans le gabarit plutôt que supposé
// (`strict-http.tmpl` d'oapi-codegen v2.8.0) : `RequestErrorHandlerFunc` n'a que huit sites d'appel,
// **tous** dans le décodage du **corps** de la requête — JSON, formdata, multipart, texte brut. Il ne
// voit ni paramètre, ni en-tête, ni cookie, et il est donc sans site d'appel dans `bff.gen.go`
// aujourd'hui, `GET /health` n'ayant pas de corps. `ResponseErrorHandlerFunc`, lui, est atteint dès
// qu'une implémentation rend une erreur — le seul des trois qu'une requête exerce pour de bon ici,
// par `TestAFailingOperationDoesNotLeakTheGoErrorToTheBrowser`. Une route future qui enveloppe son
// erreur — `fmt.Errorf("appel de %s: %w", cfg.Gateway.BaseURL, err)` — servirait sans lui l'adresse
// interne de l'API Admin au navigateur.
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

// rejectRequest répond à une requête que le code engendré n'a pas su lier au contrat. Il sert les deux
// étages : un paramètre ou un en-tête que le wrapper n'a pas su lier (`mountContract`), un corps de
// requête que le handler strict n'a pas su décoder (`newContractHandler`).
//
// Le message d'origine est écarté plutôt que rendu : il nomme des champs internes — `Query argument
// depuis is required, but not found`, `strconv.ParseInt: parsing "pasunentier"` — et il part avec,
// faute de journal ici (voir `newContractHandler`).
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
