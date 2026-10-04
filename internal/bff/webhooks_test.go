package bff

import (
	"encoding/base64"
	"reflect"
	"strings"
	"testing"

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
// Les tags et non la sortie : un champ facultatif serait `omitempty`, absent tant que personne ne le
// remplit, et le test resterait vert le jour où il naîtrait.
func TestTheListedWebhookDeclaresNoSecret(t *testing.T) {
	webhook := reflect.TypeFor[Webhook]()
	for field := range webhook.Fields() {
		name, _, _ := strings.Cut(field.Tag.Get("json"), ",")
		require.NotEqual(t, "secret", name, "le DTO Webhook déclare un champ secret")
	}
}
