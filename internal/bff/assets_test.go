package bff_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const immutableCache = "public, max-age=31536000, immutable"

// Une URL profonde n'existe que côté client : le serveur rend la coquille et laisse le routeur du
// navigateur trancher.
func TestDeepLinkServesTheSPAShell(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodGet, "/une/url/profonde")
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, indexHTML, bodyOf(t, resp))
	assert.Equal(t, "text/html; charset=utf-8", resp.Header.Get("Content-Type"))
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
	// déploiement suivant l'a rétabli. Aucune mutation du handler ne fait tomber cette ligne : c'est
	// `ServeFileFS` qui purge `Cache-Control` sur son chemin d'erreur (vérifié). Elle tient donc
	// contre une réécriture qui rendrait ce 404 à la main, pas contre un défaut d'ici.
	assert.NotEqual(t, immutableCache, resp.Header.Get("Cache-Control"))
}

// Un répertoire n'est pas un asset. Sans la garde, `ServeFileFS` redirige vers le chemin barré, qui
// ne peut que rendre 404 à son tour — un aller-retour pour rien ; la garde rend le 404 tout de
// suite. L'assertion de contenu, elle, tient si le handler repassait un jour par un serveur de
// fichiers qui, lui, énumérerait le répertoire.
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
