package bff_test

import (
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/bff"
)

const (
	// La coquille porte les références aux noms hachés : c'est elle qui interdit de la mettre en
	// cache, et c'est son doctype qu'on cherche là où du HTML n'a rien à faire.
	indexHTML = `<!doctype html><html lang="fr"><body>` +
		`<script src="/assets/app-abc123.js"></script></body></html>`
	appJS = "console.log('spa')"
	// Vite recopie `web/public/` à la racine du site sans hacher les noms, et **récursivement** :
	// step-008 y versera `fonts/`, d'où le fichier imbriqué ci-dessous.
	faviconSVG = `<svg xmlns="http://www.w3.org/2000/svg"></svg>`
	// `wOF2` est la signature d'un WOFF2 : le `Content-Type` de ce fichier vaut `font/woff2` que
	// la table MIME du système connaisse l'extension ou non — sinon `DetectContentType` la retrouve
	// (`net/http/sniff.go:178`). Sans ces quatre octets, l'assertion dépendrait de la machine.
	interWOFF2 = "wOF2\x00\x01\x00\x00fausse police"
)

// testAssets reproduit la racine du site telle que Vite la produit : la coquille et les fichiers
// publics recopiés depuis `web/public/`, à la racine comme en sous-répertoire, tout ce qui est haché
// sous `assets/`.
func testAssets() fs.FS {
	return fstest.MapFS{
		"index.html":                    {Data: []byte(indexHTML)},
		"favicon.svg":                   {Data: []byte(faviconSVG)},
		"fonts/inter.woff2":             {Data: []byte(interWOFF2)},
		"assets/app-abc123.js":          {Data: []byte(appJS)},
		"assets/vendor/chunk-def456.js": {Data: []byte("console.log('vendor')")},
	}
}

// call rend la réponse composée, et non l'enregistreur : `rec.Header()` est la map vivante que le
// handler a modifiée, où un en-tête posé après `WriteHeader` — qui n'atteindra jamais personne —
// apparaît quand même.
func call(t *testing.T, method, target string) *http.Response {
	t.Helper()

	rec := httptest.NewRecorder()
	bff.NewRouter(testAssets()).ServeHTTP(rec, httptest.NewRequest(method, target, nil))

	return rec.Result()
}

func bodyOf(t *testing.T, resp *http.Response) string {
	t.Helper()

	payload, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	return string(payload)
}

func TestHealthProbe(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodGet, "/api/health")
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "application/json; charset=utf-8", resp.Header.Get("Content-Type"))
	assert.JSONEq(t, `{"status":"ok"}`, bodyOf(t, resp))
}

// Un `/api/*` inconnu rend 404 et jamais du HTML. Ce qui le garantit est le **montage** : le repli
// est une route `/*`, et chi fait gagner le segment statique `/api` sur elle — retirer le
// `api.NotFound` ci-dessous rend d'ailleurs 404 `text/plain`, pas la coquille. Ce que le `NotFound`
// explicite porte, c'est la **forme** de l'erreur, plus un filet le jour où le repli repasserait en
// `r.NotFound()` : cette variante-là, mesurée, rend bien 200 + `<!doctype html`.
func TestUnknownAPIRouteIsNotFound(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodGet, "/api/inconnu")
	defer resp.Body.Close()

	assert.Equal(t, http.StatusNotFound, resp.StatusCode)

	payload := bodyOf(t, resp)
	assert.NotContains(t, payload, "<!doctype html")
	assert.Equal(t, "application/json; charset=utf-8", resp.Header.Get("Content-Type"))
	assert.JSONEq(t, `{"code":"not_found","message":"Cette route n'existe pas sur ce serveur."}`, payload)
}

// `/ws` est déclarée avant d'exister (step-043) : sans elle, la requête tomberait dans le repli et
// un client WebSocket recevrait 200 + du HTML au lieu d'un refus lisible.
func TestWebSocketEndpointIsNotImplementedYet(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodGet, "/ws")
	defer resp.Body.Close()

	assert.Equal(t, http.StatusNotImplemented, resp.StatusCode)
	assert.NotContains(t, bodyOf(t, resp), "<!doctype html")
}

func TestHealthProbeRefusesOtherMethods(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodPost, "/api/health")
	defer resp.Body.Close()

	assert.Equal(t, http.StatusMethodNotAllowed, resp.StatusCode)
}
