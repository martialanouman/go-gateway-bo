package bff

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const dashboardOrigin = "https://tableau.exemple.test"

// throughGuard rend le statut qu'obtient une requête composée en-tête par en-tête, et dit si la suite de la
// chaîne a été atteinte. Le second point est ce qui distingue « refusé » de « servi puis refusé
// ailleurs » : un middleware qui laisserait passer et rendrait 403 plus loin serait indiscernable du
// premier sur le seul statut.
func throughGuard(t *testing.T, request *http.Request) (int, bool) {
	t.Helper()

	reached := false
	guard := requireSameOrigin(dashboardOrigin)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	}))

	recorder := httptest.NewRecorder()
	guard.ServeHTTP(recorder, request)

	return recorder.Code, reached
}

func mutation(method, contentType string, headers map[string]string) *http.Request {
	request := httptest.NewRequest(method, "/api/auth/login", strings.NewReader(`{}`))
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}

	for name, value := range headers {
		request.Header.Set(name, value)
	}

	return request
}

// Chaque cas est une **décision** distincte de la garde, pas une valeur de plus dans un mapping : le
// navigateur qui annonce sa destination, celui qui ne l'annonce pas, le sous-domaine voisin, et le
// client qui n'est ni l'un ni l'autre.
func TestUneMutationNEstServieQueDepuisLeTableauDeBord(t *testing.T) {
	t.Parallel()

	for name, testCase := range map[string]struct {
		headers  map[string]string
		expected int
	}{
		"le navigateur annonce une destination de même origine": {
			// Sans `Origin` : c'est le cas du navigateur moderne, qui répond à la question
			// directement. Une garde qui ne lirait que `Origin` refuserait ici.
			headers:  map[string]string{"Sec-Fetch-Site": "same-origin"},
			expected: http.StatusOK,
		},
		"le sous-domaine voisin est refusé malgré une origine recevable": {
			// Le cas qui motive toute la garde : `SameSite=Lax` laisse passer le voisin, et une
			// origine falsifiée ne le sauverait pas — `Sec-Fetch-Site` prime.
			headers: map[string]string{
				"Sec-Fetch-Site": "same-site",
				"Origin":         dashboardOrigin,
			},
			expected: http.StatusForbidden,
		},
		"un autre site est refusé": {
			headers:  map[string]string{"Sec-Fetch-Site": "cross-site"},
			expected: http.StatusForbidden,
		},
		"une navigation directe est refusée": {
			headers:  map[string]string{"Sec-Fetch-Site": "none"},
			expected: http.StatusForbidden,
		},
		"un navigateur sans métadonnées de fetch est servi sur son origine": {
			headers:  map[string]string{"Origin": dashboardOrigin},
			expected: http.StatusOK,
		},
		"une origine étrangère est refusée": {
			headers:  map[string]string{"Origin": "https://voisin.exemple.test"},
			expected: http.StatusForbidden,
		},
		"un client qui n'annonce rien est refusé": {
			headers:  nil,
			expected: http.StatusForbidden,
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			status, reached := throughGuard(t, mutation(http.MethodPost, "application/json", testCase.headers))

			assert.Equal(t, testCase.expected, status)
			assert.Equal(t, testCase.expected == http.StatusOK, reached,
				"la suite de la chaîne devait être atteinte exactement quand la requête est servie")
		})
	}
}

// Une lecture n'est jamais contrôlée : un onglet ouvert depuis un lien extérieur est légitime, et le
// contrôler serait refuser la navigation elle-même.
func TestUneLectureTraverseSansAnnoncerSonOrigine(t *testing.T) {
	t.Parallel()

	for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodOptions} {
		t.Run(method, func(t *testing.T) {
			t.Parallel()

			request := httptest.NewRequest(method, "/api/auth/me", nil)

			status, reached := throughGuard(t, request)

			assert.Equal(t, http.StatusOK, status)
			assert.True(t, reached)
		})
	}
}

func TestUnCorpsDeMutationEstAnnonceEnJSON(t *testing.T) {
	t.Parallel()

	for name, testCase := range map[string]struct {
		contentType string
		expected    int
	}{
		"le type du contrat passe": {
			contentType: "application/json",
			expected:    http.StatusOK,
		},
		"le même avec son paramètre passe": {
			// Ce qu'un client raisonnable envoie, et ce qu'une comparaison textuelle refuserait —
			// une garde qui refuse du légitime finit retirée.
			contentType: "application/json; charset=utf-8",
			expected:    http.StatusOK,
		},
		"le texte brut d'un formulaire inter-site est refusé": {
			contentType: "text/plain",
			expected:    http.StatusUnsupportedMediaType,
		},
		"le formulaire encodé est refusé": {
			contentType: "application/x-www-form-urlencoded",
			expected:    http.StatusUnsupportedMediaType,
		},
		"le multipart est refusé": {
			contentType: "multipart/form-data; boundary=x",
			expected:    http.StatusUnsupportedMediaType,
		},
		"un corps annoncé sans type est refusé": {
			contentType: "",
			expected:    http.StatusUnsupportedMediaType,
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			request := mutation(http.MethodPost, testCase.contentType,
				map[string]string{"Sec-Fetch-Site": "same-origin"})

			status, _ := throughGuard(t, request)

			assert.Equal(t, testCase.expected, status)
		})
	}
}

// Le retrait d'une clé d'accès n'a pas de corps : ce qu'il désigne est dans son chemin. Sans cette
// branche, la seule mutation sans corps du contrat serait refusée.
func TestUneMutationSansCorpsNaRienAAnnoncer(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest(http.MethodDelete, "/api/auth/mfa/webauthn/passkeys/x", nil)
	request.Header.Set("Sec-Fetch-Site", "same-origin")

	status, reached := throughGuard(t, request)

	assert.Equal(t, http.StatusOK, status)
	assert.True(t, reached)
}

// Une origine n'a pas de chemin, et le navigateur n'en envoie jamais avec. Sans le retrait de la
// barre oblique, une configuration qui en porte une refuserait **toutes** les mutations, et rien
// dans le refus ne dirait que la faute est là.
func TestUneBarreObliqueDansLaConfigurationNeRefuseRien(t *testing.T) {
	t.Parallel()

	reached := false
	guard := requireSameOrigin(dashboardOrigin + "/")(http.HandlerFunc(
		func(_ http.ResponseWriter, _ *http.Request) { reached = true }))

	recorder := httptest.NewRecorder()
	guard.ServeHTTP(recorder, mutation(http.MethodPost, "application/json",
		map[string]string{"Origin": dashboardOrigin}))

	assert.True(t, reached, "l'origine du navigateur devait correspondre malgré la barre oblique")
}

// Le refus nomme ce qui manque et par où passer, et ne fuit rien : c'est un DTO déclaré, pas un
// `http.Error` en texte brut.
func TestUnRefusDOrigineEstUnDTODeclare(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	requireSameOrigin(dashboardOrigin)(http.HandlerFunc(
		func(_ http.ResponseWriter, _ *http.Request) {}),
	).ServeHTTP(recorder, mutation(http.MethodPost, "application/json", nil))

	require.Equal(t, http.StatusForbidden, recorder.Code)
	assert.Equal(t, "application/json", recorder.Header().Get("Content-Type"))
	assert.Contains(t, recorder.Body.String(), `"code":"forbidden_origin"`)
	assert.Contains(t, recorder.Body.String(), "recharger l'onglet du tableau de bord")
}
