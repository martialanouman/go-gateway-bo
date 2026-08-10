package bff

import (
	"context"
	"net/http"

	"github.com/martialanouman/go-gateway-bo/internal/session"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// pendingCookieKey et sessionKey sont des clés privées : rien hors de ce paquet ne peut poser une
// session dans un contexte, donc aucun appelant ne se choisit une identité.
type (
	pendingCookieKey struct{}
	sessionKey       struct{}
)

// pendingCookie est la boîte qu'un handler remplit et que le middleware strict vide. Le handler
// n'écrit pas lui-même : il n'a pas le `ResponseWriter`, c'est le prix du mode strict, et c'est ce
// prix qui tient la convention du DTO de sortie.
type pendingCookie struct {
	cookie *http.Cookie
}

// writePendingCookie pose sur la réponse le cookie que le handler a déposé.
//
// **Un middleware strict et non un middleware chi**, et ce n'est pas un détail de style : le statut
// et les en-têtes partent dans `Visit…Response(w)`, à l'intérieur du handler engendré (`bff.gen.go`,
// `strictHandler.Login`). Un middleware chi ne reprendrait la main qu'après, sur une réponse déjà
// écrite ; celui-ci est appelé **autour** du handler. C'est le mécanisme que step-025 emploiera pour
// ses gardes de permission. Pourquoi le cookie n'est pas déclaré au contrat : voir la description de
// `/auth/login` dans `api/openapi-bff.yaml`.
//
// Rien n'est posé sur une erreur : un 500 accompagné d'un `Set-Cookie` ouvrirait une session que le
// client croirait échouée.
func writePendingCookie() StrictMiddlewareFunc {
	return func(next StrictHandlerFunc, _ string) StrictHandlerFunc {
		return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request any) (any, error) {
			pending := &pendingCookie{}

			response, err := next(context.WithValue(ctx, pendingCookieKey{}, pending), w, r, request)
			if err == nil && pending.cookie != nil {
				http.SetCookie(w, pending.cookie)
			}

			return response, err
		}
	}
}

// postCookie dépose un cookie que la réponse portera. Sans boîte dans le contexte, le handler a été
// appelé hors de son montage : ne rien faire est le seul comportement sûr — poser un cookie exige un
// `ResponseWriter` qu'on n'a pas.
func postCookie(ctx context.Context, cookie *http.Cookie) {
	if pending, ok := ctx.Value(pendingCookieKey{}).(*pendingCookie); ok {
		pending.cookie = cookie
	}
}

// resolution est ce que le middleware apprend, y compris quand il n'apprend rien. L'échec est porté
// plutôt qu'avalé : une base injoignable ne doit pas se lire comme une session expirée, sans quoi
// l'opérateur se reconnecte en boucle pendant que la panne est ailleurs. Même arbitrage qu'en
// step-021, où une base tombée pendant un login rend 500 et non 401.
type resolution struct {
	session store.Session
	alive   bool
	err     error
}

// withSession résout la session que porte le cookie et la pose dans le contexte.
//
// **Il résout, il ne refuse jamais**, et c'est ce qui garde `GET /health` conforme à sa fiche : la
// sonde ne touche ni la base ni la passerelle. Une requête sans cookie n'entraîne aucune requête SQL,
// et la sonde répond même sur une base tombée — un middleware qui refuserait ferait redémarrer un
// process sain. Le refus appartient aux routes qui exigent une session : `GET /auth/me` aujourd'hui,
// la garde de permission de step-025 demain.
func withSession(manager *session.Manager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie(session.CookieName)
			if err != nil {
				next.ServeHTTP(w, r)

				return
			}

			resolved, alive, err := manager.Resolve(r.Context(), cookie.Value)
			ctx := context.WithValue(r.Context(), sessionKey{},
				resolution{session: resolved, alive: alive, err: err})

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// sessionFrom rend la session vivante de la requête. L'erreur remonte au handler, qui la propage :
// le gestionnaire du handler strict la traduit alors en 500 sans en citer le message.
func sessionFrom(ctx context.Context) (store.Session, bool, error) {
	resolved, ok := ctx.Value(sessionKey{}).(resolution)
	if !ok {
		return store.Session{}, false, nil
	}

	return resolved.session, resolved.alive, resolved.err
}
