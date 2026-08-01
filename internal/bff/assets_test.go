package bff_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const immutableCache = "public, max-age=31536000, immutable"

// Une URL de navigation n'existe que côté client : le serveur rend la coquille et laisse le routeur
// du navigateur trancher. Les deux cas à un segment sont ceux que le service des fichiers racine peut
// capturer par erreur : `/clients` a la forme d'un nom de fichier, et `/assets` en est un nom réel —
// celui d'un répertoire, que `ServeFileFS` renverrait en 301 vers `assets/`, laquelle rend 404.
func TestNavigationURLServesTheSPAShell(t *testing.T) {
	t.Parallel()

	for name, target := range map[string]string{
		"une URL profonde":           "/une/url/profonde",
		"un segment unique":          "/clients",
		"un répertoire de la racine": "/assets",
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			resp := call(t, http.MethodGet, target)
			defer resp.Body.Close()

			require.Equal(t, http.StatusOK, resp.StatusCode)
			assert.Equal(t, indexHTML, bodyOf(t, resp))
			assert.Equal(t, "text/html; charset=utf-8", resp.Header.Get("Content-Type"))
			assert.Equal(t, "no-cache", resp.Header.Get("Cache-Control"))
		})
	}
}

// DN-5 sert en `no-cache` « `index.html` et tout autre fichier racine ». Substituer la coquille à un
// fichier public existant le rendrait en `text/html` avec 200 : c'est le défaut de DN-6 transposé
// hors de `/assets/`, et il est silencieux — le navigateur ne signale qu'un favicon illisible ou un
// `@font-face` sans effet, très loin de sa cause.
//
// Les deux cas ne diffèrent pas par une valeur mais par la profondeur, qui est justement ce qui est
// en cause : Vite recopie `web/public/` **récursivement**, et une règle qui ne reconnaîtrait que la
// racine rendrait la coquille pour `/fonts/inter.woff2`.
func TestExistingPublicFileIsServedInsteadOfTheShell(t *testing.T) {
	t.Parallel()

	for name, expected := range map[string]struct {
		target      string
		body        string
		contentType string
	}{
		"à la racine": {
			target:      "/favicon.svg",
			body:        faviconSVG,
			contentType: "image/svg+xml",
		},
		"dans un sous-répertoire": {
			target:      "/fonts/inter.woff2",
			body:        interWOFF2,
			contentType: "font/woff2",
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			resp := call(t, http.MethodGet, expected.target)
			defer resp.Body.Close()

			require.Equal(t, http.StatusOK, resp.StatusCode)
			assert.Equal(t, expected.body, bodyOf(t, resp))
			assert.Equal(t, expected.contentType, resp.Header.Get("Content-Type"))
			assert.Equal(t, "no-cache", resp.Header.Get("Cache-Control"))
		})
	}
}

// DN-7 nomme « GET **et** HEAD ». Les deux routes `Head` sont ce qui les sépare d'un 405 : chi
// n'infère pas HEAD depuis GET. Une sonde de disponibilité ou un préchargement conclurait que la
// méthode n'est pas servie.
func TestHeadIsServedLikeGet(t *testing.T) {
	t.Parallel()

	for name, expected := range map[string]struct {
		target       string
		cacheControl string
	}{
		"un asset haché":        {target: "/assets/app-abc123.js", cacheControl: immutableCache},
		"une URL de navigation": {target: "/une/url/profonde", cacheControl: "no-cache"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			resp := call(t, http.MethodHead, expected.target)
			defer resp.Body.Close()

			require.Equal(t, http.StatusOK, resp.StatusCode)
			assert.Equal(t, expected.cacheControl, resp.Header.Get("Cache-Control"))
		})
	}
}

// Caractérisation d'un comportement de `net/http`, pas un défaut d'ici : `serveFile` redirige toute
// URL finissant par `/index.html` vers `./` **avant** d'ouvrir quoi que ce soit
// (`net/http/fs.go:685-688`). La coquille se demande donc par `/`, et la section « Tests » de la
// fiche — « *Quand* `index.html` est demandé, *Alors* il porte `no-cache` » — décrit un cas qui rend
// 301. L'en-tête, lui, survit : `localRedirect` ne purge rien.
func TestIndexHTMLRedirectsToTheSiteRoot(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodGet, "/index.html")
	defer resp.Body.Close()

	require.Equal(t, http.StatusMovedPermanently, resp.StatusCode)
	assert.Equal(t, "./", resp.Header.Get("Location"))
	assert.Equal(t, "no-cache", resp.Header.Get("Cache-Control"))
}

func TestRootServesTheSPAShell(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodGet, "/")
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, indexHTML, bodyOf(t, resp))
	assert.Equal(t, "no-cache", resp.Header.Get("Cache-Control"))
}

// Le nom haché change à chaque build : l'ancien contenu ne sera jamais réémis sous ce nom, donc le
// navigateur peut le garder un an sans jamais revalider.
func TestHashedAssetIsCachedForever(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodGet, "/assets/app-abc123.js")
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, appJS, bodyOf(t, resp))
	assert.Equal(t, immutableCache, resp.Header.Get("Cache-Control"))
}

// Le repli ne s'applique pas sous `/assets/` : un `<script src>` qui recevrait du HTML en 200
// échouerait sur une erreur de syntaxe, très loin de sa cause.
func TestMissingAssetIsNotFound(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodGet, "/assets/inconnu.js")
	defer resp.Body.Close()

	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	assert.NotContains(t, bodyOf(t, resp), "<!doctype html")
	// Un 404 gardé un an, c'est un asset qui reste introuvable dans cet onglet bien après que le
	// déploiement suivant l'a rétabli. Cette ligne protège l'**ordre** du handler, et rien d'autre :
	// ici c'est `http.NotFound` qui répond, et `http.Error` ne supprime que `Content-Length`
	// (`net/http/server.go:2301-2311`) : le seul rempart est que `Cache-Control` n'est pas encore
	// posé. Mutation mesurée — hisser le `w.Header().Set` en tête de `serveAsset` fait rougir cette
	// assertion, et le 404 part alors avec un cache d'un an.
	assert.NotEqual(t, immutableCache, resp.Header.Get("Cache-Control"))
}

// Un répertoire n'est pas un asset. Des trois cas, la garde `IsDir` n'en protège qu'un — mesuré en la
// retirant : `/assets/vendor`, où `fs.Stat` réussit et où `ServeFileFS` redirigerait sinon vers le
// chemin barré (301) qui ne peut que rendre 404 à son tour. Les deux autres portent une barre finale
// que `TrimPrefix` conserve, `fs.ValidPath` la refuse, et la branche `err != nil` sort avant même
// d'évaluer `IsDir()` : avec ou sans la garde, c'est un 404 direct.
//
// Ces trois verdicts sont bien ceux de la production, mesurés sur sa forme exacte — `fs.Sub` d'un FS
// n'exposant que `Open`, soit un `*fs.subFS` : 404/404/404 comme ici, et 404/301/404 comme ici une
// fois `IsDir` retiré. La divergence entre les deux FS est réelle mais n'appartient pas à `IsDir` :
// les deux cas barrés rendent `ErrNotExist` sur `fstest.MapFS` et `ErrInvalid` sur `subFS`
// (`io/fs/sub.go:61-63`), et c'est la branche `err != nil` — pas `IsDir` — qui empêche `toHTTPError`
// de jamais la voir. Retirer cette branche-là, et elle seule, rend 404 ici mais **500** en
// production (`net/http/fs.go:769-781`).
//
// L'assertion de contenu, elle, tient si le handler repassait un jour par un serveur de fichiers qui,
// lui, énumérerait le répertoire.
func TestAssetDirectoryIsNotListed(t *testing.T) {
	t.Parallel()

	for name, target := range map[string]string{
		"la racine des assets":     "/assets/",
		"un sous-répertoire":       "/assets/vendor",
		"un sous-répertoire barré": "/assets/vendor/",
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			resp := call(t, http.MethodGet, target)
			defer resp.Body.Close()

			assert.Equal(t, http.StatusNotFound, resp.StatusCode)
			assert.NotContains(t, bodyOf(t, resp), "chunk-def456.js")
		})
	}
}

// `/assets/` ne donne accès qu'à ce qui est sous `assets/` : un `..` ne remonte nulle part, pas même
// vers la coquille, qui est pourtant le voisin immédiat dans la même arborescence.
func TestAssetPathCannotEscapeItsDirectory(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodGet, "/assets/../index.html")
	defer resp.Body.Close()

	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	assert.NotContains(t, bodyOf(t, resp), "<!doctype html")
}

// Une écriture sur une route non montée est une erreur d'appelant, pas une navigation : lui rendre
// la coquille en 200 la ferait passer pour un succès.
func TestFallbackRefusesWriteMethods(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodPost, "/une/url/profonde")
	defer resp.Body.Close()

	assert.Equal(t, http.StatusMethodNotAllowed, resp.StatusCode)
}
