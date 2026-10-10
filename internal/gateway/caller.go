package gateway

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
	"github.com/martialanouman/go-gateway-bo/internal/token"
)

// SystemSubject est l'identité des flux temps réel du hub, qu'aucun opérateur ne porte. Une
// constante et non une ligne en base : l'amorçage n'accepte qu'une table operators vide.
const SystemSubject = "7b0e3f5a-2c4d-4e6f-9a1b-3c5d7e9f0a2b"

var ErrNoCaller = errors.New("appel à l'API Admin sans appelant ni scope : refusé avant le réseau")

type caller struct {
	subject string
	scopes  []string
}

type callerKey struct{}

func WithOperator(ctx context.Context, operatorID string, held []string) context.Context {
	return context.WithValue(ctx, callerKey{}, caller{subject: operatorID, scopes: permissions.GatewayScopes(held)})
}

func WithSystem(ctx context.Context) context.Context {
	return context.WithValue(ctx, callerKey{}, caller{subject: SystemSubject, scopes: []string{permissions.ScopeAdminRead}})
}

type signedTransport struct {
	base   http.RoundTripper
	issuer *token.Issuer
	logger *slog.Logger
}

func (t signedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	who, ok := req.Context().Value(callerKey{}).(caller)
	if !ok || who.subject == "" || len(who.scopes) == 0 {
		return nil, ErrNoCaller
	}
	raw, err := t.issuer.Token(who.subject, who.scopes)
	if err != nil {
		return nil, err
	}
	outgoing := req.Clone(req.Context())
	outgoing.Header.Del("Cookie")
	outgoing.Header.Set("Authorization", "Bearer "+raw)

	response, err := t.base.RoundTrip(outgoing)
	if err != nil {
		return nil, err
	}
	switch response.StatusCode {
	case http.StatusUnauthorized:
		t.logger.ErrorContext(req.Context(), "gateway_token_rejected",
			"kid", t.issuer.ActiveKeyID(), "iss", t.issuer.Issuer(), "sub", who.subject, "at", time.Now().UTC())
	case http.StatusServiceUnavailable:
		t.logger.WarnContext(req.Context(), "gateway_unavailable",
			"hint", "si le code est service_unavailable, vérifier le JWKS du tableau de bord",
			"kid", t.issuer.ActiveKeyID())
	}
	return response, nil
}
