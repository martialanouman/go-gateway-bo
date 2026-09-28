package bff

import (
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"
)

func TestAnUpstreamValidationErrorKeepsItsFields(t *testing.T) {
	t.Parallel()

	status, body, relayed := relayError(&gateway.APIError{
		Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "invalid status",
		Fields: []gateway.FieldError{{Field: "status", Message: "unknown customer group status"}},
	})

	assert.True(t, relayed)
	assert.Equal(t, http.StatusUnprocessableEntity, status)
	assert.Equal(t, Error{
		Code: "validation_failed", Message: "invalid status",
		Errors: &[]FieldError{{Field: "status", Message: "unknown customer group status"}},
	}, body)
}

func TestAnUnavailableGatewayIsRelayedAsRetryable(t *testing.T) {
	t.Parallel()

	for _, upstream := range []int{http.StatusInternalServerError, http.StatusServiceUnavailable,
		http.StatusTooManyRequests} {
		status, body, relayed := relayError(&gateway.APIError{Status: upstream, Code: gateway.CodeUpstreamUnreadable})

		assert.True(t, relayed)
		assert.Equal(t, http.StatusServiceUnavailable, status)
		assert.Equal(t, gateway.CodeUpstreamUnreadable, body.Code)
		assert.Contains(t, body.Message, "Réessayez")
		assert.Nil(t, body.Errors)
	}
}

// Un 401 ou un 403 amont refuse le jeton machine du BFF, pas l'opérateur : le relayer renverrait
// l'écran à la connexion pour une faute de configuration du serveur.
func TestARefusalOfTheMachineTokenIsNotRelayed(t *testing.T) {
	t.Parallel()

	for _, upstream := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		_, _, relayed := relayError(&gateway.APIError{Status: upstream, Code: "unauthorized"})
		assert.False(t, relayed)
	}

	_, _, relayed := relayError(errors.New("connexion refusée"))
	assert.False(t, relayed)
}
