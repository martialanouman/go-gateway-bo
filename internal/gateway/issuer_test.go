package gateway_test

import (
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/token"
)

func newIssuer() (*token.Issuer, error) {
	keys, err := token.EphemeralKeySet()
	if err != nil {
		return nil, err
	}

	return token.NewIssuer(keys, "https://dashboard.test", time.Now)
}

func testIssuer(t *testing.T) *token.Issuer {
	t.Helper()

	issuer, err := newIssuer()
	require.NoError(t, err)

	return issuer
}

func quietLogger() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}
