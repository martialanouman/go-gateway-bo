package bff

import (
	"context"

	"github.com/martialanouman/go-gateway-bo/internal/session"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Me rend l'opérateur connecté et **ce qu'il a le droit de faire**.
//
// C'est le seul endroit d'où le client apprend ses droits : l'interface se rend sur des permissions,
// jamais sur un rôle codé en dur (§4.2). Le corps ne porte aucun rôle, pour que la tentation n'existe
// pas.
//
// Le DTO se compose champ par champ depuis ce que le store rend. Aucun type de domaine ne traverse :
// c'est ce qui met `password_hash` et `mfa_totp_secret` hors d'atteinte par construction, et non par
// vigilance.
func (a API) Me(ctx context.Context, _ MeRequestObject) (MeResponseObject, error) {
	resolved, alive, err := sessionFrom(ctx)
	if err != nil {
		// Une base injoignable n'est pas une session expirée. La propager rend 500 — l'opérateur lit
		// « la panne est côté serveur » plutôt que de se reconnecter en boucle pendant qu'elle dure.
		return nil, err
	}

	if !alive {
		return Me401JSONResponse(notAuthenticated()), nil
	}

	grants, err := a.Sessions.Grants(ctx, resolved.OperatorID)
	if err != nil {
		return nil, err
	}

	factors, err := secondFactorsOf(ctx, a.SecondFactor, resolved.OperatorID)
	if err != nil {
		return nil, err
	}

	return Me200JSONResponse{
		Operator: CurrentOperator{
			Id:          resolved.OperatorID,
			Email:       grants.Email,
			DisplayName: grants.DisplayName,
		},
		Permissions:       grants.Permissions,
		Elevated:          resolved.Elevated,
		SecondFactors:     factors,
		AbsoluteExpiresAt: resolved.ExpiresAt,
	}, nil
}

// Logout ferme la session.
//
// Ce qui protège est la suppression de la ligne, pas le cookie expiré — voir `store.Sessions.Delete`.
// Sans session, le même 204 ; la raison est dans la description de l'opération au contrat.
//
// `Logout204Response` est un struct **sans champ**, que `TestResponseTypesDeclareTheirFields`
// traverse en vert faute d'avoir quoi que ce soit à examiner : ce qui garde cette réponse est le
// scénario qui la confronte au contrat.
func (a API) Logout(ctx context.Context, _ LogoutRequestObject) (LogoutResponseObject, error) {
	postCookie(ctx, session.Cleared())

	resolved, alive, err := sessionFrom(ctx)
	if err != nil {
		return nil, err
	}

	if !alive {
		return Logout204Response{}, nil
	}

	if err = a.Sessions.Close(ctx, resolved.ID); err != nil {
		return nil, err
	}

	if err = a.audited(ctx, store.Event{
		OperatorID: resolved.OperatorID,
		Action:     actionLogout,
	}); err != nil {
		return nil, err
	}

	return Logout204Response{}, nil
}

// notAuthenticated est le refus **unique** d'une session absente. Un seul constructeur, comme le
// refus du premier facteur : il n'y a pas deux messages entre lesquels choisir, donc rien à
// distinguer pour qui teste un cookie afin de savoir ce qu'il vaut encore.
//
// La copie dit la conséquence d'abord et ce qu'il faut faire, sans accuser : une session échue et un
// cookie forgé lisent la même phrase.
func notAuthenticated() Error {
	return Error{
		Code:    "unauthenticated",
		Message: "Cette session n'est plus ouverte : reconnectez-vous pour continuer.",
	}
}
