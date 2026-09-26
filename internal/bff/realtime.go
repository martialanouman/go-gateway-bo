package bff

import (
	"context"
	"net/http"

	"github.com/coder/websocket"

	"github.com/martialanouman/go-gateway-bo/internal/hub"
	"github.com/martialanouman/go-gateway-bo/internal/session"
)

// serveRealtime refuse en HTTP, avant la montée : une fois la socket ouverte, un refus n'a plus de
// statut pour le dire.
func serveRealtime(realtime *hub.Hub, sessions *session.Manager, origin string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// `requireSameOrigin` laisse passer les GET, et une socket en est un : sans ce contrôle, une
		// page tierce l'ouvrirait avec le cookie de l'opérateur.
		if origin == "" || !comesFromDashboard(r, origin) {
			writeJSON(w, http.StatusForbidden, Error{
				Code: "forbidden_origin",
				Message: "Le temps réel a été refusé : la connexion n'a pas été demandée depuis le " +
					"tableau de bord. Recharger l'onglet du tableau de bord rétablit la connexion.",
			})

			return
		}

		resolved, alive, err := sessionFrom(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, unexpectedError())

			return
		}

		if !alive {
			writeJSON(w, http.StatusUnauthorized, notAuthenticated())

			return
		}

		if !resolved.Elevated {
			writeJSON(w, http.StatusForbidden, secondFactorRequired())

			return
		}

		// L'origine est déjà jugée contre la configuration ; celle de coder/websocket la comparerait
		// à `Host`, qui diffère derrière un proxy.
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}

		realtime.Serve(r.Context(), conn, func(ctx context.Context) (bool, []string, error) {
			alive, err := sessions.Alive(ctx, resolved.ID)
			if err != nil || !alive {
				return false, nil, err
			}

			grants, err := sessions.Grants(ctx, resolved.OperatorID)

			return true, grants.Permissions, err
		})
	}
}
