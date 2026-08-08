package gateway_test

import (
	"bytes"
	"encoding/json"
	"errors"
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
// message d'erreur. Ce que rendent Error(), MarshalJSON() et GoString() est précisément ce qui finit
// dans une chaîne enveloppée et dans un log, donc rien d'autre que ce que nous contrôlons n'y entre :
// le statut, le code, et les noms de champs.
//
// Chaque rendu est exercé **sur le pointeur et sur la valeur**. `errors.As` rend un pointeur, et le
// déréférencer pour « logger la struct » ne coûte qu'un caractère : une garantie portée par les
// seules méthodes à récepteur pointeur laisserait `slog.Error("…", "err", *apiErr)` écrire le texte
// libre de la passerelle dans le journal JSON.
func TestErrorRendersNoUpstreamFreeText(t *testing.T) {
	t.Parallel()

	body := []byte(`{"code":"validation_error","message":"` + smsBody + `",` +
		`"errors":[{"field":"text","message":"` + smsBody + `"}]}`)

	err := gateway.ErrorFrom(http.StatusUnprocessableEntity, body)

	var apiErr *gateway.APIError

	require.ErrorAs(t, err, &apiErr)

	renderings := map[string]string{
		"Error()":                  err.Error(),
		"%v":                       fmt.Sprintf("%v", err),
		"%s":                       fmt.Sprintf("%s", err),
		"%+v":                      fmt.Sprintf("%+v", err),
		"%#v":                      fmt.Sprintf("%#v", err),
		"enveloppée par %w":        fmt.Errorf("lecture des clients : %w", err).Error(),
		"json.Marshal":             marshaled(t, err),
		"journalisée (slog JSON)":  loggedAsJSON(err),
		"journalisée (slog texte)": loggedAsText(err),

		"la valeur, %v":                       fmt.Sprintf("%v", *apiErr),
		"la valeur, %s":                       fmt.Sprintf("%s", *apiErr),
		"la valeur, %+v":                      fmt.Sprintf("%+v", *apiErr),
		"la valeur, %#v":                      fmt.Sprintf("%#v", *apiErr),
		"la valeur, json.Marshal":             marshaled(t, *apiErr),
		"la valeur, journalisée (slog JSON)":  loggedAsJSON(*apiErr),
		"la valeur, journalisée (slog texte)": loggedAsText(*apiErr),
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

	assert.Equal(t, smsBody, apiErr.Message,
		"le texte reste accessible à l'onglet qui l'affichera ; c'est le rendu qui l'exclut")
}

// `%#v` promet une représentation en **syntaxe Go**, et la rédaction ne dispense pas de la tenir :
// `Fields:["phone"]` — ce que rendait un `%q` sur les seuls noms — ne se recompile pas et donne à
// `Fields` l'air d'un `[]string` alors qu'il porte des FieldError. Le message, lui, reste hors du
// rendu : c'est du texte libre amont.
func TestGoStringStaysGoSyntax(t *testing.T) {
	t.Parallel()

	err := gateway.ErrorFrom(http.StatusUnprocessableEntity,
		[]byte(`{"code":"validation_error","message":"`+smsBody+`",`+
			`"errors":[{"field":"phone","message":"`+smsBody+`"}]}`))

	assert.Equal(t,
		`gateway.APIError{Status:422, Code:"validation_error", `+
			`Fields:[]gateway.FieldError{gateway.FieldError{Field:"phone", Message:""}}}`,
		fmt.Sprintf("%#v", err))
}

// `errors.As` accepte deux cibles ici, et **une seule** attrapait : `ErrorFrom` range un
// `*APIError` dans la chaîne, donc une cible `var apiErr APIError` — la valeur — ne lui est pas
// assignable et rend `false` avec une struct nulle.
//
// Ce n'est pas une faute théorique : c'est la forme qu'invite le passage des trois rendus au
// récepteur valeur. Avant lui, la valeur n'implémentait pas `error`, et `go vet` — que `go test`
// lance par défaut — refusait de compiler l'appel : *« second argument to errors.As must be a
// non-nil pointer to either a type that implements error »*. Depuis, l'appel compile, vet se tait,
// et le refus 422 tombe dans la branche générique : les messages ne se placent plus sous les champs.
// Mesuré le 02/08/2026 dans les deux états.
//
// La réponse est un `As` explicite plutôt qu'une phrase de doc : la phrase suppose qu'on la lise
// avant d'écrire l'appel, et l'appel se lit correct.
func TestErrorAsCatchesBothSpellings(t *testing.T) {
	t.Parallel()

	err := gateway.ErrorFrom(http.StatusUnprocessableEntity,
		[]byte(`{"code":"validation_error","message":"la requête est invalide",`+
			`"errors":[{"field":"phone","message":"format E.164 attendu"}]}`))

	expected := gateway.APIError{
		Status:  http.StatusUnprocessableEntity,
		Code:    "validation_error",
		Message: "la requête est invalide",
		Fields:  []gateway.FieldError{{Field: "phone", Message: "format E.164 attendu"}},
	}

	t.Run("la cible pointeur", func(t *testing.T) {
		t.Parallel()

		var apiErr *gateway.APIError

		require.ErrorAs(t, err, &apiErr)
		assert.Equal(t, expected, *apiErr)
	})

	t.Run("la cible valeur", func(t *testing.T) {
		t.Parallel()

		var apiErr gateway.APIError

		require.ErrorAs(t, err, &apiErr,
			"la cible valeur compile et se lit correcte : si elle n'attrape pas, un 422 tombe dans la "+
				"branche générique et le formulaire perd ses erreurs par champ")
		assert.Equal(t, expected, apiErr)
	})

	t.Run("la cible valeur, sous une erreur enveloppée", func(t *testing.T) {
		t.Parallel()

		var apiErr gateway.APIError

		require.ErrorAs(t, fmt.Errorf("lecture des clients : %w", err), &apiErr)
		assert.Equal(t, expected, apiErr)
	})

	t.Run("ne rend pas vrai sur une erreur étrangère", func(t *testing.T) {
		t.Parallel()

		var apiErr gateway.APIError

		assert.NotErrorAs(t, errors.New("une panne réseau"), &apiErr,
			"un As qui attrape tout ferait passer n'importe quelle panne pour un refus de la passerelle")
	})

	// L'autre moitié : la chaîne porte bien une APIError, et la cible vise autre chose. Un As qui
	// rendrait vrai sans rien écrire remplirait la cible de l'appelant de zéros et arrêterait la
	// remontée de la chaîne — un `*json.SyntaxError` nul, qu'il déréférencerait.
	t.Run("ne détourne pas la cible d'un autre type", func(t *testing.T) {
		t.Parallel()

		var syntaxErr *json.SyntaxError

		assert.NotErrorAs(t, err, &syntaxErr)
		assert.Nil(t, syntaxErr)
	})
}

func marshaled(t *testing.T, value any) string {
	t.Helper()

	encoded, err := json.Marshal(value)
	require.NoError(t, err)

	return string(encoded)
}

func loggedAsJSON(value any) string {
	var out bytes.Buffer

	slog.New(slog.NewJSONHandler(&out, nil)).Error("appel de l'API Admin", "err", value)

	return out.String()
}

func loggedAsText(value any) string {
	var out bytes.Buffer

	slog.New(slog.NewTextHandler(&out, nil)).Error("appel de l'API Admin", "err", value)

	return out.String()
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
// Mesuré sur le contrat **4.0.2**, celui que la branche installe
// (`web/node_modules/@martialanouman/gateway-api-contracts`), le 08/08/2026 : il déclare un 503 sur
// 4 de ses 133 opérations (openapi-admin.yaml:1429, 1442, 1455 et 1531) et un composant
// `ServiceUnavailable` (ligne 1672), dont la description est *« A dependency (e.g. billing-svc) is
// unreachable or timed out; retry once it recovers »* — un réessai, pas une extinction.
//
// La quatrième est arrivée avec la 4.0.0 et mérite d'être nommée, parce qu'elle touche ce DN de plus
// près que les trois autres : *« Export storage is not configured in this deployment »*. C'est ce que
// le contrat porte de plus proche d'un module désactivé — une capacité absente de ce déploiement-ci —
// et il l'exprime quand même par un **503**, donc par une erreur avec Réessayer. Le contrat ne
// déclare toujours ni 501, ni en-tête, ni code d'erreur pour un module désactivé : les seuls signaux
// voisins sont des booléens par ressource, qui voyagent dans des réponses 200. Interpréter 503 comme
// « ce module est éteint » fabriquerait donc un signal que la passerelle n'émet pas, et remplacerait
// un état d'erreur réessayable par un écran qui n'invite à rien.
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
