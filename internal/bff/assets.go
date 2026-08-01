package bff

import (
	"io/fs"
	"net/http"
	"strings"
)

const (
	// Vite place sous `assets/` tout ce dont il hache le nom. Un nom haché ne désigne jamais deux
	// contenus : le navigateur peut le garder un an sans jamais revalider.
	immutableCacheControl = "public, max-age=31536000, immutable"
	// La coquille porte les références aux noms hachés. Mise en cache, un onglet ouvert après un
	// déploiement demanderait des chunks qui n'existent plus.
	shellCacheControl = "no-cache"

	shellName = "index.html"
)

// serveAsset sert un fichier haché. Un nom absent rend 404 et jamais la coquille : un
// `<script src>` qui recevrait du HTML en 200 échouerait sur une erreur de syntaxe, très loin de sa
// cause.
func serveAsset(assets fs.FS) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/")

		info, err := fs.Stat(assets, name)
		if err != nil || info.IsDir() {
			http.NotFound(w, r)

			return
		}

		w.Header().Set("Cache-Control", immutableCacheControl)
		// gosec suit la teinture de l'URL jusqu'ici sans voir ce que le `fs.Stat` ci-dessus a déjà
		// tranché : un `fs.FS` refuse tout nom que `fs.ValidPath` rejette — dont le moindre `..` —
		// donc `name` désigne un fichier existant *dans* l'arborescence, et il n'y a pas de parent
		// à remonter. Vérifié sur `fs.Stat`, pas déduit de la doc.
		http.ServeFileFS(w, r, assets, name) //nolint:gosec // chemin déjà validé par fs.Stat
	}
}

// serveShell rend la coquille de la SPA pour toute URL qui n'est pas une route du serveur : elles
// n'existent que côté client, et c'est le routeur du navigateur qui les tranche.
func serveShell(assets fs.FS) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", shellCacheControl)
		http.ServeFileFS(w, r, assets, shellName)
	}
}
