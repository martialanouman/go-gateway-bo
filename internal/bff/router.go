// Package bff porte les routes HTTP servies au navigateur : leurs gardes de permission, leur
// écriture d'audit et leurs DTO de sortie.
//
// Il est le seul point de contact du client avec le serveur — le navigateur ne joint jamais l'API
// Admin (invariant d), et `internal/` rend cette frontière inatteignable depuis l'extérieur du
// module.
package bff

import (
	"context"
	"io/fs"
	"net/http"
	"net/netip"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/martialanouman/go-gateway-bo/internal/hub"
	"github.com/martialanouman/go-gateway-bo/internal/session"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Dependencies porte ce que les routes du BFF ne savent pas fabriquer.
//
// Une struct plutôt que des options variadiques, et c'est un choix : des options laisseraient
// compiler un routeur amputé de sa dépendance, qui rendrait 500 sur la seule route qui compte, en
// production, sans que rien ne l'ait dit au démarrage. La struct force le compilateur à revisiter
// chaque site d'appel le jour où une dépendance obligatoire apparaît — ce qui est arrivé ici.
type Dependencies struct {
	// API porte les cinq collaborateurs que les routes du contrat exercent. Il est **embarqué** et non
	// recopié champ par champ : deux listes des mêmes cinq dépendances divergeraient à la sixième.
	API
	// Assets a pour racine la racine du site : la coquille y est `index.html`, les fichiers hachés
	// sous `assets/`. Le prendre en `fs.FS` plutôt qu'en `embed.FS` est ce qui permet de tester le
	// repli sans build client.
	Assets fs.FS
	// TrustedProxies alimente la dérivation de l'adresse cliente. Vide veut dire « aucun proxy », et
	// c'est désormais une valeur **écrite** — voir `config.NoTrustedProxy`, `withClientAddress` et
	// `internal/auth.ClientAddress`.
	TrustedProxies []netip.Prefix
	// Origin est l'origine depuis laquelle une mutation est acceptée, telle que la configuration la
	// déclare. C'est la **même valeur** que l'origine des cérémonies WebAuthn, et non une seconde :
	// deux origines pour un seul déploiement divergeraient, et celle qui ne sert qu'à refuser
	// divergerait en silence.
	Origin string
	// Realtime relaie les flux de la passerelle sur `/ws`.
	Realtime *hub.Hub
}

// NewRouter assemble les routes du BFF et le service des assets de la SPA.
//
// Le repli n'est monté qu'en GET et HEAD : une écriture sur une route non montée est une erreur
// d'appelant, à qui chi rend alors 405 plutôt que la coquille en 200.
func NewRouter(deps Dependencies) http.Handler {
	assets := deps.Assets

	r := chi.NewRouter()

	// À la racine, donc sur les trois surfaces : la coquille, les fichiers hachés et `/api`. Un seul
	// montage, et aucune route future à ne pas oublier.
	r.Use(withHardeningHeaders)

	// L'ordre des lignes **est** l'ordre d'exécution : `chain` de chi enveloppe depuis la queue, donc
	// le premier enregistré est le plus extérieur.
	r.Route("/api", func(api chi.Router) {
		api.Use(withoutCaching)
		// Avant la base, le décodeur et le compteur d'échecs : une mutation qui ne vient pas du
		// tableau de bord ne doit atteindre aucun des trois. Seul `withoutCaching` la précède, et il
		// ne fait que poser deux en-têtes.
		api.Use(requireSameOrigin(deps.Origin))
		api.Use(withAPIDeadlines)
		// Borne la lecture du corps **avant** le décodage : la `maxLength` du contrat s'applique après,
		// donc sur une valeur déjà entièrement chargée en mémoire.
		api.Use(middleware.RequestSize(maximumLoginBodyBytes))
		api.Use(withClientAddress(deps.TrustedProxies))
		// Après les deux précédents : celui-ci est le seul qui puisse interroger la base, et il ne le
		// fait que sur une requête déjà bornée et porteuse d'un cookie scellé.
		api.Use(withSession(deps.Sessions))

		mountContract(api, deps.API, deps.Sessions, deps.Audit)

		// Deux raisons, et l'ordre des lignes n'en est pas une. La première est la forme : un
		// `/api/*` inconnu rend le DTO d'erreur du produit, pas le texte brut de chi. La seconde
		// est un filet : chi propage le `NotFound` de la racine à tout sous-routeur qui n'en
		// déclare pas — vérifié dans `mux.go` sur chi v5.3.1. Le jour où le repli ci-dessous
		// passerait de `r.Get("/*")` à `r.NotFound()`, cette ligne serait la seule chose empêchant
		// `/api/inconnu` de rendre 200 + HTML.
		api.NotFound(handleUnknownAPIRoute)
	})

	// Hors de `/api` : ni `withAPIDeadlines`, dont le contexte de 30 s couperait la socket, ni la borne
	// de corps. Le contrôle d'origine est dans le handler, puisque c'est un GET.
	r.With(withoutCaching, withSession(deps.Sessions)).
		Get("/ws", serveRealtime(deps.Realtime, deps.Sessions, deps.Origin))

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
// Le contrat n'a aujourd'hui qu'un seul paramètre lié de la sorte — le `passkeyId` du retrait d'une
// clé d'accès, une chaîne requise qu'une requête assez bien formée pour atteindre la route ne peut
// pas faire échouer. Aucune requête n'exerce donc ce gestionnaire, et c'est
// `TestTheContractMountInstallsTheProductErrorHandler` qui garde le montage. Sans l'option,
// `HandlerFromMux` rendrait le message Go en `text/plain` — mesuré le 02/08/2026 sur un contrat muté
// avec un paramètre de requête requis, puis restauré.
func mountContract(api chi.Router, impl StrictServerInterface, sessions *session.Manager, audit *store.Audit) {
	HandlerWithOptions(newContractHandler(impl, sessions, audit), ChiServerOptions{
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
// voit ni paramètre, ni en-tête, ni cookie. Une opération qui porte un corps de requête l'atteint
// donc, et `POST /auth/login` est la première du contrat dans ce cas — un JSON illisible envoyé sur
// cette route rend son 400. C'est pourquoi le contrat déclare ce statut : sans lui, le scénario qui
// valide la réponse échouerait sur un statut que le YAML ne connaît pas.
// `ResponseErrorHandlerFunc`, lui, est atteint dès
// qu'une implémentation rend une erreur — le seul des trois qu'une requête exerce pour de bon ici,
// par `TestAFailingOperationDoesNotLeakTheGoErrorToTheBrowser`. Une route future qui enveloppe son
// erreur — `fmt.Errorf("appel de %s: %w", cfg.Gateway.BaseURL, err)` — servirait sans lui l'adresse
// interne de l'API Admin au navigateur.
//
// L'erreur n'est ni journalisée ni propagée, et c'est un manque assumé plutôt qu'un oubli : aucun
// journal n'atteint ce paquet, la `Dependencies` de `NewRouter` ne portant pas de `*slog.Logger`, qui
// s'arrête à `cmd/dashboard`. Un 500 servi ici ne laisse donc **aucune trace côté serveur**, y
// compris sur une route qui travaille : un `password_hash` corrompu en base fait refuser la connexion
// sans que rien ne le dise. Le premier appel réel à la passerelle (step-060) devra apporter les deux
// à la fois.
//
// **L'ordre du slice compte.** La boucle du wrapper engendré enveloppe successivement, donc le
// **dernier** élément est le plus extérieur : la garde s'exécute avant tout le reste, et son refus
// court-circuite la machinerie de cookie — qui ne pose rien, ne posant que sur
// `err == nil && pending.cookie != nil`.
func newContractHandler(impl StrictServerInterface, sessions *session.Manager, audit *store.Audit,
) ServerInterface {
	return NewStrictHandlerWithOptions(impl,
		[]StrictMiddlewareFunc{writePendingCookie(), requirePermission(authorization, grantsFrom(sessions), audit.Record)},
		StrictHTTPServerOptions{
			RequestErrorHandlerFunc:  rejectRequest,
			ResponseErrorHandlerFunc: reportFailedResponse,
		})
}

// grantsFrom branche la garde sur la vraie source des permissions. C'est la seule adaptation entre
// `session.Manager`, qui rend de quoi nommer l'opérateur **et** ses permissions, et la garde, qui ne
// veut que les secondes : lui passer les trois champs l'inviterait à nommer l'opérateur dans un
// message de refus, ce que la charte n'a aucune raison de demander.
func grantsFrom(sessions *session.Manager) grantsOf {
	return func(ctx context.Context, operatorID string) ([]string, error) {
		held, err := sessions.Grants(ctx, operatorID)

		return held.Permissions, err
	}
}

// rejectRequest répond à une requête que le code engendré n'a pas su lier au contrat. Il sert les deux
// étages : un paramètre ou un en-tête que le wrapper n'a pas su lier (`mountContract`), un corps de
// requête que le handler strict n'a pas su décoder (`newContractHandler`).
//
// Le message d'origine est écarté plutôt que rendu : il nomme des champs internes — `Query argument
// depuis is required, but not found`, `strconv.ParseInt: parsing "pasunentier"` — et il part avec,
// faute de journal ici (voir `newContractHandler`).
func rejectRequest(w http.ResponseWriter, _ *http.Request, _ error) {
	writeJSON(w, http.StatusBadRequest, Error{
		Code:    "bad_request",
		Message: "Cette requête a été refusée : sa forme ne correspond pas à ce que la route attend.",
	})
}

func reportFailedResponse(w http.ResponseWriter, _ *http.Request, _ error) {
	writeJSON(w, http.StatusInternalServerError, unexpectedError())
}

func unexpectedError() Error {
	return Error{
		Code:    "internal_error",
		Message: "La demande n'a pas abouti : le serveur a rencontré une erreur imprévue. Réessayez dans un instant ; si l'erreur revient, prévenez un administrateur du tableau de bord.",
	}
}

func handleUnknownAPIRoute(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotFound, Error{
		Code:    "not_found",
		Message: "Cette route n'existe pas sur ce serveur.",
	})
}
