package bff

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// neverPersonal ne quitte jamais le BFF dans un jeton personnel : le corps d'un message ne se lit que
// dans l'onglet qui l'affiche (invariant a), et un effacement ne s'exécute que derrière la confirmation
// de l'écran.
var neverPersonal = []string{
	permissions.ScopeContentRead, permissions.ScopeContentErase, permissions.ScopeGDPRErase,
}

func (a API) IssueGatewayToken(ctx context.Context,
	request IssueGatewayTokenRequestObject,
) (IssueGatewayTokenResponseObject, error) {
	resolved, _, err := sessionFrom(ctx)
	if err != nil {
		return nil, err
	}

	grants, err := a.Sessions.Grants(ctx, resolved.OperatorID)
	if err != nil {
		return nil, err
	}

	held := slices.DeleteFunc(permissions.GatewayScopes(grants.Permissions), func(scope string) bool {
		return slices.Contains(neverPersonal, scope)
	})
	if len(held) == 0 {
		return IssueGatewayToken403JSONResponse(noGatewayAccess()), nil
	}

	scopes := held
	if request.Body != nil && request.Body.Scopes != nil {
		scopes = *request.Body.Scopes
		for _, scope := range scopes {
			if !slices.Contains(held, scope) {
				return IssueGatewayToken403JSONResponse(scopeNotHeld(scope)), nil
			}
		}
	}

	raw, expiresAt, err := a.Tokens.Personal(resolved.OperatorID, scopes)
	if err != nil {
		return nil, err
	}

	scopes = slices.Compact(slices.Sorted(slices.Values(scopes)))

	err = a.Audit.Record(ctx, a.event(ctx, store.Event{
		OperatorID: resolved.OperatorID,
		Action:     actionGatewayTokenIssue,
		After: store.NewFields().
			Text("scopes", strings.Join(scopes, " ")).
			Text("expiresAt", expiresAt.UTC().Format(time.RFC3339)),
	}))
	if err != nil {
		return nil, err
	}

	return IssueGatewayToken200JSONResponse{Token: raw, Scopes: scopes, ExpiresAt: expiresAt}, nil
}

func noGatewayAccess() Error {
	return Error{
		Code: "permission_denied",
		Message: "Aucun jeton n'a été délivré : votre compte ne détient aucune permission qui ouvre " +
			"l'API Admin. Un administrateur peut vous en accorder une.",
	}
}

func scopeNotHeld(scope string) Error {
	return Error{
		Code: "forbidden_scope",
		Message: "Aucun jeton n'a été délivré : le scope « " + scope + " » dépasse ce qu'un jeton " +
			"personnel peut porter pour votre compte. Le retirer de la demande.",
	}
}
