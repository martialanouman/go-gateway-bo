package bff

import (
	"encoding/base64"
	"encoding/json"
	"testing"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"

	"github.com/stretchr/testify/require"
)

func TestAWebhookSecretCarriesThirtyTwoRandomBytes(t *testing.T) {
	first, err := newWebhookSecret()
	require.NoError(t, err)

	second, err := newWebhookSecret()
	require.NoError(t, err)

	decoded, err := base64.RawURLEncoding.DecodeString(first)
	require.NoError(t, err)
	require.Len(t, decoded, 32)
	require.NotEqual(t, first, second)
}

// Le DTO de la liste ne peut pas fuir un champ qu'il ne déclare pas : seul `WebhookSecret` le porte.
func TestTheListedWebhookCarriesNoSecret(t *testing.T) {
	serialized, err := json.Marshal(webhookDTO(gateway.Webhook{EventType: "dlr", Url: "https://client.example"}))
	require.NoError(t, err)

	var fields map[string]any
	require.NoError(t, json.Unmarshal(serialized, &fields))
	require.NotContains(t, fields, "secret")
}
