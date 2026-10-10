package bff

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

func (a API) IssueGatewayToken(ctx context.Context,
	request IssueGatewayTokenRequestObject,
) (IssueGatewayTokenResponseObject, error) {
	resolved, alive, err := sessionFrom(ctx)
	if err != nil {
		return nil, err
	}

	if !alive {
		return IssueGatewayToken401JSONResponse(notAuthenticated()), nil
	}

	if !resolved.Elevated {
		return IssueGatewayToken409JSONResponse(elevationRequiredToIssueAToken()), nil
	}

	grants, err := a.Sessions.Grants(ctx, resolved.OperatorID)
	if err != nil {
		return nil, err
	}

	held := permissions.GatewayScopes(grants.Permissions)
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

func elevationRequiredToIssueAToken() Error {
	return Error{
		Code: "mfa_elevation_required",
		Message: "Délivrer un jeton personnel demande d'avoir franchi le second facteur sur cette " +
			"session. Le franchir, puis reprendre la délivrance.",
	}
}

func noGatewayAccess() Error {
	return Error{
		Code: "forbidden_scope",
		Message: "Aucun jeton n'a été délivré : votre compte ne détient aucune permission qui ouvre " +
			"l'API Admin. Un administrateur peut vous en accorder une.",
	}
}

func scopeNotHeld(scope string) Error {
	return Error{
		Code: "forbidden_scope",
		Message: "Aucun jeton n'a été délivré : le scope « " + scope + " » dépasse ce que vos " +
			"permissions ouvrent. Le retirer de la demande, ou demander la permission à un administrateur.",
	}
}
