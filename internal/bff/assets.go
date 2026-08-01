package bff

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

const (
	// Les assets portent un condensat dans leur nom : leur contenu ne change
	// jamais sous une même URL.
	cacheImmuable = "public, max-age=31536000, immutable"
	// `index.html` porte les références aux chunks hashés. Mis en cache, un
	// onglet ouvert après un déploiement demanderait des chunks disparus.
	cacheJamais = "no-cache"
)

const prefixeAssets = "assets/"

// serveClient rend l'application : un asset s'il existe, l'index sinon.
//
// Il prend un `fs.FS` plutôt que l'`embed.FS` directement : les tests injectent
// une arborescence en mémoire et n'ont donc pas besoin d'un build client.
func serveClient(assets fs.FS) http.HandlerFunc {
	fichiers := http.FileServer(http.FS(assets))

	return func(w http.ResponseWriter, r *http.Request) {
		nom := strings.TrimPrefix(path.Clean(r.URL.Path), "/")

		if strings.HasPrefix(nom, prefixeAssets) {
			// Un asset absent rend 404 et **pas** l'index : servir l'application
			// à la place d'un chunk manquant donnerait du HTML là où le
			// navigateur attend du JavaScript, et l'erreur deviendrait
			// incompréhensible.
			if _, err := fs.Stat(assets, nom); err != nil {
				http.NotFound(w, r)
				return
			}

			w.Header().Set("Cache-Control", cacheImmuable)
			fichiers.ServeHTTP(w, r)
			return
		}

		serveIndex(w, assets)
	}
}

// serveIndex rend `index.html` pour toute URL non-asset : c'est ce qui fait
// fonctionner les liens profonds sans rendu serveur.
func serveIndex(w http.ResponseWriter, assets fs.FS) {
	index, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		http.Error(w, "application indisponible", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", cacheJamais)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(index)
}
