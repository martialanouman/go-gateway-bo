package bff

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

func TestAnUpstreamValidationErrorKeepsItsFields(t *testing.T) {
	t.Parallel()

	status, body, relayed := relayError(&gateway.APIError{
		Status: http.StatusUnprocessableEntity, Code: "validation_error", Message: "invalid status",
		Fields: []gateway.FieldError{{Field: "status", Message: "unknown customer group status"}},
	})

	assert.True(t, relayed)
	assert.Equal(t, http.StatusUnprocessableEntity, status)
	assert.Equal(t, Error{
		Code: "validation_error", Message: "invalid status",
		Errors: &[]FieldError{{Field: "status", Message: "unknown customer group status"}},
	}, body)
}

func TestAnUnavailableGatewayIsRelayedAsRetryable(t *testing.T) {
	t.Parallel()

	for _, upstream := range []int{
		http.StatusInternalServerError, http.StatusServiceUnavailable,
		http.StatusTooManyRequests,
	} {
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
}

func TestAnUnreachableGatewayIsRelayedAsRetryable(t *testing.T) {
	t.Parallel()

	status, body, relayed := relayError(errors.New("dial tcp 10.0.0.1:8443: connect: connection refused"))

	assert.True(t, relayed)
	assert.Equal(t, http.StatusServiceUnavailable, status)
	assert.Equal(t, gateway.CodeUpstreamUnreachable, body.Code)
	assert.NotContains(t, body.Message, "10.0.0.1")
}

type auditLine struct {
	action string
	after  string
}

type auditTrail struct {
	lines  []auditLine
	broken bool
}

func (a *auditTrail) record(_ context.Context, event store.Event) error {
	if a.broken {
		return errors.New("partition manquante")
	}

	after, err := event.After.JSON()
	if err != nil {
		return err
	}

	a.lines = append(a.lines, auditLine{action: event.Action, after: string(after)})

	return nil
}

func TestARelayedActionIsAuditedBeforeTheCall(t *testing.T) {
	t.Parallel()

	trail := &auditTrail{}

	var seenBeforeTheCall int

	status, err := auditRelayed(context.Background(), trail.record, slog.New(slog.DiscardHandler),
		store.Event{Action: "group.create", After: store.NewFields().Text("name", "Revendeurs")},
		func(context.Context) (int, error) {
			seenBeforeTheCall = len(trail.lines)

			return http.StatusCreated, nil
		})

	require.NoError(t, err)
	assert.Equal(t, http.StatusCreated, status)
	assert.Equal(t, 1, seenBeforeTheCall, "l'intention n'était pas écrite quand l'appel est parti")
	require.Len(t, trail.lines, 2)
	assert.JSONEq(t, `{"name":"Revendeurs","outcome":"attempted"}`, trail.lines[0].after)
	assert.JSONEq(t, `{"name":"Revendeurs","outcome":"succeeded","status":"201"}`, trail.lines[1].after)
}

func TestARelayedActionIsNotCalledWhenItCannotBeAudited(t *testing.T) {
	t.Parallel()

	called := false

	_, err := auditRelayed(context.Background(), (&auditTrail{broken: true}).record, slog.New(slog.DiscardHandler),
		store.Event{Action: "group.delete"},
		func(context.Context) (int, error) {
			called = true

			return http.StatusNoContent, nil
		})

	require.Error(t, err)
	assert.False(t, called, "une action est partie sans trace")
}

func TestARefusedRelayedActionIsAuditedAsFailed(t *testing.T) {
	t.Parallel()

	trail := &auditTrail{}

	_, err := auditRelayed(context.Background(), trail.record, slog.New(slog.DiscardHandler),
		store.Event{Action: "group.update"},
		func(context.Context) (int, error) { return http.StatusUnprocessableEntity, nil })

	require.NoError(t, err)
	require.Len(t, trail.lines, 2)
	assert.JSONEq(t, `{"outcome":"failed","status":"422"}`, trail.lines[1].after)
}
