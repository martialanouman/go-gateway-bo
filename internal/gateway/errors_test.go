package gateway_test

import (
	"bytes"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"
)

// L'enveloppe du contrat est plate et le statut n'y est pas dupliqué : ce que le BFF doit retenir,
// c'est le couple (ligne de statut, corps), avec le détail champ par champ qui alimentera les
// erreurs de formulaire.
func TestErrorFromKeepsTheFlatEnvelope(t *testing.T) {
	t.Parallel()

	body := []byte(`{"code":"validation_error","message":"la requête est invalide",` +
		`"errors":[{"field":"msisdn","message":"format E.164 attendu"},` +
		`{"field":"text","message":"trop long"}]}`)

	err := gateway.ErrorFrom(http.StatusUnprocessableEntity, body)

	var apiErr *gateway.APIError
	require.ErrorAs(t, err, &apiErr)

	assert.Equal(t, http.StatusUnprocessableEntity, apiErr.Status)
	assert.Equal(t, "validation_error", apiErr.Code)
	assert.Equal(t, "la requête est invalide", apiErr.Message)
	assert.Equal(t, []gateway.FieldError{
		{Field: "msisdn", Message: "format E.164 attendu"},
		{Field: "text", Message: "trop long"},
	}, apiErr.Fields,
		"c'est errors[] qui alimente les erreurs de formulaire ; un message global à sa place est un défaut")
}

// Un corps qui n'est pas l'enveloppe du contrat est un cas mesuré, pas théorique : Prism répond du
// RFC 7807 aux routes inconnues et un proxy intermédiaire répond du HTML. Le décodeur nomme alors
// l'illisibilité au lieu d'inventer un code ou de propager du vide.
func TestErrorFromNamesAnUnreadableBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
	}{
		{
			name: "RFC 7807, ce que Prism rend sur une route inconnue",
			body: `{"type":"https://stoplight.io/prism/errors#NO_PATH_MATCHED_ERROR",` +
				`"title":"Route not resolved","status":404,"detail":"aucune route"}`,
		},
		{name: "du HTML, ce que rend un proxy intermédiaire", body: "<html><body>502</body></html>"},
		{name: "un corps vide", body: ""},
		{name: "un JSON valide sans code", body: `{"message":"quelque chose a échoué"}`},
		{name: "un code présent mais vide", body: `{"code":"","message":"quelque chose a échoué"}`},
		{name: "null", body: "null"},
		{
			// Le JSON est syntaxiquement valide et `code` s'y décode : sans la garde sur l'erreur de
			// décodage, l'enveloppe passerait pour lue et `errors[]` disparaîtrait en silence.
			name: "un code lisible mais un errors[] mal typé",
			body: `{"code":"validation_error","message":"x","errors":"pas un tableau"}`,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			err := gateway.ErrorFrom(http.StatusBadGateway, []byte(testCase.body))

			var apiErr *gateway.APIError
			require.ErrorAs(t, err, &apiErr)

			assert.Equal(t, gateway.CodeUpstreamUnreadable, apiErr.Code,
				"un corps illisible se nomme, il ne se devine pas et ne reste pas vide")
			assert.Equal(t, http.StatusBadGateway, apiErr.Status,
				"la ligne de statut reste lisible même quand le corps ne l'est pas")
		})
	}
}

// Le code que le BFF frappe lui-même ne doit pas pouvoir se lire comme un code de la passerelle :
// un opérateur qui le grep dans les logs doit savoir d'où il vient.
func TestUnreadableCodeIsNotAGatewayCode(t *testing.T) {
	t.Parallel()

	assert.True(t, strings.HasPrefix(gateway.CodeUpstreamUnreadable, "bff_"),
		"le préfixe nomme l'émetteur, et l'émetteur est le BFF")
}

// smsBody tient lieu de ce que l'invariant (a) protège : du texte libre amont dont rien ne garantit
// qu'il ne recopie pas le corps d'un message. `message` et `errors[].message` sont écrits par la
// passerelle, pas par nous.
const smsBody = "RDV demain 14h, apporte les analyses"

// Invariant (a) : le corps d'un message ne sort pas de l'onglet qui l'affiche — ni log, ni trace, ni
// message d'erreur. Ce que `Error()` rend est précisément ce qui finit dans une chaîne enveloppée et
// dans un log, donc il ne porte que ce que nous contrôlons : le statut, le code, et les noms de
// champs.
func TestErrorRendersNoUpstreamFreeText(t *testing.T) {
	t.Parallel()

	body := []byte(`{"code":"validation_error","message":"` + smsBody + `",` +
		`"errors":[{"field":"text","message":"` + smsBody + `"}]}`)

	err := gateway.ErrorFrom(http.StatusUnprocessableEntity, body)

	var logged bytes.Buffer

	slog.New(slog.NewJSONHandler(&logged, nil)).Error("appel de l'API Admin", "err", err)

	renderings := map[string]string{
		"Error()":            err.Error(),
		"%v":                 fmt.Sprintf("%v", err),
		"%s":                 fmt.Sprintf("%s", err),
		"%+v":                fmt.Sprintf("%+v", err),
		"enveloppée par %w":  fmt.Errorf("lecture des clients : %w", err).Error(),
		"journalisée (slog)": logged.String(),
	}

	for name, rendered := range renderings {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			assert.NotContains(t, rendered, smsBody,
				"le texte libre de la passerelle n'a aucun chemin vers un log")
			assert.Contains(t, rendered, "validation_error", "le code reste greppable")
			assert.Contains(t, rendered, "422", "le statut reste lisible")
			assert.Contains(t, rendered, "text", "le nom du champ fautif oriente le débogage")
		})
	}

	var apiErr *gateway.APIError

	require.ErrorAs(t, err, &apiErr)
	assert.Equal(t, smsBody, apiErr.Message,
		"le texte reste accessible à l'onglet qui l'affichera ; c'est le rendu qui l'exclut")
}

// La plupart des erreurs n'ont pas d'`errors[]` — le contrat ne l'exige pas. Ce que lit un opérateur
// dans un log ne doit pas traîner de mention de champs vide derrière chacune d'elles.
func TestErrorRendersNoFieldListWhenThereIsNone(t *testing.T) {
	t.Parallel()

	err := gateway.ErrorFrom(http.StatusForbidden,
		[]byte(`{"code":"forbidden_scope","message":"portée insuffisante"}`))

	assert.Equal(t, "réponse d'erreur de l'API Admin : 403 forbidden_scope", err.Error())
}

// Un corps illisible n'est pas recopié dans l'erreur : c'est le seul endroit où du HTML ou du JSON
// inconnu — donc n'importe quoi — pourrait entrer dans le BFF sans être lu par personne.
func TestErrorFromDropsAnUnreadableBody(t *testing.T) {
	t.Parallel()

	err := gateway.ErrorFrom(http.StatusBadGateway, []byte("<html><body>"+smsBody+"</body></html>"))

	var apiErr *gateway.APIError

	require.ErrorAs(t, err, &apiErr)
	assert.Empty(t, apiErr.Message, "un corps qu'on n'a pas su lire ne se transporte pas tel quel")
	assert.Empty(t, apiErr.Fields)
	assert.NotContains(t, err.Error(), smsBody)
}

// DN-8 : 503 est une erreur, avec Réessayer — jamais un module désactivé.
//
// Mesuré sur le contrat 1.2.0 (`web/node_modules/@martialanouman/gateway-api-contracts`, le
// 02/08/2026) : il ne déclare **aucune** réponse 503, aucun composant `ServiceUnavailable`, ni 501,
// ni en-tête, ni code d'erreur pour un module désactivé. Les seuls signaux voisins sont des booléens
// par ressource, qui voyagent dans des réponses 200. Interpréter 503 comme « ce module est éteint »
// fabriquerait un signal que la passerelle n'émet pas, et remplacerait un état d'erreur réessayable
// par un écran qui n'invite à rien.
func TestServiceUnavailableStaysAnError(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
		code string
	}{
		{
			name: "503 portant l'enveloppe du contrat",
			body: `{"code":"service_unavailable","message":"réessayez quand elle se rétablit"}`,
			code: "service_unavailable",
		},
		{
			name: "503 d'un intermédiaire, sans enveloppe",
			body: "<html><body>503 Service Unavailable</body></html>",
			code: gateway.CodeUpstreamUnreadable,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			err := gateway.ErrorFrom(http.StatusServiceUnavailable, []byte(testCase.body))

			var apiErr *gateway.APIError

			require.ErrorAs(t, err, &apiErr,
				"503 est une erreur : ni un succès, ni un « rien à afficher », ni un module désactivé")
			assert.Equal(t, http.StatusServiceUnavailable, apiErr.Status)
			assert.Equal(t, testCase.code, apiErr.Code,
				"le code vient du corps ou nomme son illisibilité ; le BFF n'en invente aucun autre")
		})
	}
}

// Un décodeur qui rend une erreur sur un succès ferait échouer toutes les lectures du BFF.
func TestErrorFromReturnsNilOnSuccess(t *testing.T) {
	t.Parallel()

	for _, status := range []int{http.StatusOK, http.StatusCreated, http.StatusAccepted, http.StatusNoContent} {
		assert.NoError(t, gateway.ErrorFrom(status, nil), "%d est un succès", status)
	}
}
