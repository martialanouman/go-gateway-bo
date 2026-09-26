package hub

import (
	"reflect"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const adminContract = "../../web/node_modules/@martialanouman/gateway-api-contracts/openapi-admin.yaml"

// Les structs de décodage sont recopiés de la passerelle : un champ renommé en amont arriverait vide,
// sans erreur. Ce test les confronte au contrat installé, qui décrit les trames depuis 6.9.0.
func TestLesTramesDecodeesNeLisentQueDesChampsDuContrat(t *testing.T) {
	t.Parallel()

	doc, err := openapi3.NewLoader().LoadFromFile(adminContract)
	require.NoError(t, err)

	for schema, frame := range map[string]any{
		"MetricSnapshot": upstreamSnapshot{},
		"MetricSample":   upstreamSample{},
		"SessionEvent":   upstreamSessionEvent{},
		"BillingAlert":   upstreamBillingAlert{},
	} {
		declared, ok := doc.Components.Schemas[schema]
		require.True(t, ok, "le contrat ne déclare plus %s", schema)

		kind := reflect.TypeOf(frame)
		for i := range kind.NumField() {
			name, _, _ := strings.Cut(kind.Field(i).Tag.Get("json"), ",")
			assert.Contains(t, declared.Value.Properties, name,
				"%s lit %q, que le schéma %s du contrat ne déclare pas", kind.Name(), name, schema)
		}
	}
}

func TestChaqueFluxAnnonceLeSchemaQueSaTrameDecode(t *testing.T) {
	t.Parallel()

	doc, err := openapi3.NewLoader().LoadFromFile(adminContract)
	require.NoError(t, err)

	for path, schema := range map[string]string{
		"/admin/stream/metrics":        "MetricSnapshot",
		"/admin/stream/sessions":       "SessionEvent",
		"/admin/stream/billing-alerts": "BillingAlert",
	} {
		_ = feedAt(t, path)

		operation := doc.Paths.Find(path).Get
		require.NotNil(t, operation, "le contrat ne déclare plus GET %s", path)

		message, ok := operation.Extensions["x-websocket-message"].(map[string]any)
		require.True(t, ok, "%s n'annonce plus le schéma de ses trames", path)
		assert.Equal(t, "#/components/schemas/"+schema, message["$ref"], path)
	}
}
