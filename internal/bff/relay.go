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

// errIntentNotTraced distingue un journal en panne d'une passerelle injoignable : l'appel n'est pas
// parti, et l'annoncer « réessayez, la passerelle… » enverrait chercher la panne au mauvais endroit.
var errIntentNotTraced = errors.New("l'intention d'une action relayée n'a pas pu être tracée")

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
		return 0, fmt.Errorf("%w (%s) : %w", errIntentNotTraced, event.Action, err)
	}

	status, err := call(ctx, &event)

	outcome := "succeeded"
	if err != nil || status < http.StatusOK || status >= http.StatusMultipleChoices {
		outcome = "failed"
	}

	event.After = event.After.Text("outcome", outcome)
	// `http_status` et non `status` : le statut métier de l'objet, posé par le handler, porte ce nom.
	if status != 0 {
		event.After = event.After.Text("http_status", strconv.Itoa(status))
	}

	// Hors de l'annulation de la requête : un onglet fermé pendant l'appel ne doit pas effacer l'issue.
	if recordErr := record(context.WithoutCancel(ctx), event); recordErr != nil {
		logger.ErrorContext(ctx, "l'issue d'une action relayée n'a pas pu être tracée", "action", event.Action,
			"outcome", outcome, "error", recordErr)
	}

	return status, err
}

// relayedRefusal traduit l'échec d'une opération relayée. Un statut nul rend `err` à l'appelant, qui
// le laisse devenir un 500 journalisé ; tout autre statut vient avec le corps à servir. Un journal
// d'audit en panne n'est pas une passerelle injoignable : l'appel n'est pas parti.
func (a API) relayedRefusal(ctx context.Context, operation string, err error) (int, Error, error) {
	status, body, relayed := relayError(err)
	if !relayed || errors.Is(err, errIntentNotTraced) {
		return 0, Error{}, err
	}

	if status >= http.StatusInternalServerError {
		a.Logger.WarnContext(ctx, "la passerelle a échoué", "operation", operation, "error", err)
	}

	return status, body, err
}
