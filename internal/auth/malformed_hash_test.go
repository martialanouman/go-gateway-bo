package auth

import (
	"bytes"
	"context"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

func TestAMalformedPasswordHashIsLoggedWithoutTheHash(t *testing.T) {
	t.Parallel()

	var journal bytes.Buffer

	authenticator := NewAuthenticator(nil, nil, slog.New(slog.NewJSONHandler(&journal, nil)))
	operator := &store.Operator{ID: "operateur-abime", PasswordHash: "pas-un-hachage-phc", Status: store.StatusActive}

	matches, err := authenticator.passwordMatches(context.Background(), operator, "un mot de passe")

	require.NoError(t, err)
	assert.False(t, matches)
	assert.Contains(t, journal.String(), "operateur-abime")
	assert.NotContains(t, journal.String(), "pas-un-hachage-phc")
}
