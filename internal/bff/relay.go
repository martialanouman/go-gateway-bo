package bff

import (
	"errors"
	"net/http"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"
)

// relayError traduit une réponse d'erreur de la passerelle dans la forme du produit (§1.4). `relayed`
// faux laisse l'appelant rendre l'erreur, donc un 500 journalisé : c'est le sort d'une erreur de
// transport et d'un 401 ou 403 amont, qui refusent le jeton machine du BFF et non l'opérateur.
func relayError(err error) (status int, body Error, relayed bool) {
	var upstream gateway.APIError
	if !errors.As(err, &upstream) {
		return 0, Error{}, false
	}

	switch {
	case upstream.Status == http.StatusUnauthorized || upstream.Status == http.StatusForbidden:
		return 0, Error{}, false
	case upstream.Status == http.StatusTooManyRequests || upstream.Status >= http.StatusInternalServerError:
		return http.StatusServiceUnavailable, Error{
			Code: upstream.Code,
			Message: "La passerelle n'a pas pu répondre : l'information n'est pas disponible pour l'instant. " +
				"Réessayez dans un instant.",
		}, true
	case upstream.Status >= http.StatusBadRequest:
		return upstream.Status, Error{Code: upstream.Code, Message: upstream.Message, Errors: fieldErrors(upstream)},
			true
	default:
		return 0, Error{}, false
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
