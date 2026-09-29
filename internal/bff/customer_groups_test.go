package bff

import (
	"context"
	"log/slog"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"
)

func TestATakenGroupNameIsPlacedUnderTheNameField(t *testing.T) {
	t.Parallel()

	status, body, _ := API{Logger: slog.New(slog.DiscardHandler)}.relayedRefusal(context.Background(),
		operationCreateCustomerGroup,
		&gateway.APIError{Status: http.StatusConflict, Code: "conflict", Message: "name already taken"})

	assert.Equal(t, http.StatusConflict, status)
	assert.Equal(t, "conflict", body.Code)
	assert.NotContains(t, body.Message, "taken")
	if assert.NotNil(t, body.Errors) {
		assert.Equal(t, "name", (*body.Errors)[0].Field)
		assert.Contains(t, (*body.Errors)[0].Message, "porte déjà ce nom")
	}
}

func TestAnUnknownGroupIsRefusedInFrench(t *testing.T) {
	t.Parallel()

	status, body, _ := API{Logger: slog.New(slog.DiscardHandler)}.relayedRefusal(context.Background(),
		operationUpdateCustomerGroup,
		&gateway.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "customer group not found"})

	assert.Equal(t, http.StatusNotFound, status)
	assert.Equal(t, Error{Code: "not_found", Message: "Aucun groupe ne porte cet identifiant. Rechargez la liste."},
		body)
}
