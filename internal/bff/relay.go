package bff

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// relayError traduit une erreur de la passerelle dans la forme du produit (§1.4). Une passerelle
// injoignable ou qui expire, un 429 ou un 5xx amont deviennent un 503 à réessayer. `relayed` faux
// laisse l'appelant rendre l'erreur, donc un 500 journalisé : c'est le sort d'un 401 ou 403 amont,
// qui refusent le jeton machine du BFF et non l'opérateur.
func relayError(err error) (status int, body Error, relayed bool) {
	var upstream gateway.APIError
	if !errors.As(err, &upstream) {
		return http.StatusServiceUnavailable, unavailable(gateway.CodeUpstreamUnreachable), true
	}

	switch {
	case upstream.Status == http.StatusUnauthorized || upstream.Status == http.StatusForbidden:
		return 0, Error{}, false
	case upstream.Status == http.StatusTooManyRequests || upstream.Status >= http.StatusInternalServerError:
		return http.StatusServiceUnavailable, unavailable(upstream.Code), true
	case upstream.Status >= http.StatusBadRequest:
		return upstream.Status, Error{Code: upstream.Code, Message: upstream.Message, Errors: fieldErrors(upstream)},
			true
	default:
		return 0, Error{}, false
	}
}

func unavailable(code string) Error {
	return Error{
		Code: code,
		Message: "La passerelle n'a pas pu répondre : l'information n'est pas disponible pour l'instant. " +
			"Réessayez dans un instant.",
	}
}

func fieldErrors(upstream gateway.APIError) *[]FieldError {
	if len(upstream.Fields) == 0 {
		return nil
	}

	fields := make([]FieldError, 0, len(upstream.Fields))
	for _, field := range upstream.Fields {
		fields = append(fields, FieldError{Field: field.Field, Message: field.Message})
	}

	return &fields
}

// auditRelayed trace une action que la passerelle exécute : la transaction commune avec l'audit est
// impossible, puisque l'action vit ailleurs. L'intention s'écrit donc **avant** l'appel, et une
// écriture qui échoue l'empêche de partir. L'issue s'écrit après ; une panne entre les deux laisse
// `attempted` seul, qui se lit « issue inconnue » et non « rien ».
//
// `event.After` est complété sur place. `call` rend le statut amont, et peut compléter l'événement
// de ce que seule la réponse connaît — l'identifiant d'un groupe créé. La seconde écriture ne fait
// pas échouer la route : l'action est faite, et l'annoncer ratée ferait recommencer l'opérateur.
func auditRelayed(ctx context.Context, record func(context.Context, store.Event) error, logger *slog.Logger,
	event store.Event,
	call func(context.Context, *store.Event) (int, error),
) (int, error) {
	event.After = event.After.Text("outcome", "attempted")
	if err := record(ctx, event); err != nil {
		return 0, fmt.Errorf("l'intention de %s n'a pas pu être tracée : %w", event.Action, err)
	}

	status, err := call(ctx, &event)

	outcome := "succeeded"
	if err != nil || status < http.StatusOK || status >= http.StatusMultipleChoices {
		outcome = "failed"
	}

	event.After = event.After.Text("outcome", outcome)
	if status != 0 {
		event.After = event.After.Text("status", strconv.Itoa(status))
	}

	// Hors de l'annulation de la requête : un onglet fermé pendant l'appel ne doit pas effacer l'issue.
	if recordErr := record(context.WithoutCancel(ctx), event); recordErr != nil {
		logger.ErrorContext(ctx, "l'issue d'une action relayée n'a pas pu être tracée", "action", event.Action,
			"outcome", outcome, "error", recordErr)
	}

	return status, err
}
