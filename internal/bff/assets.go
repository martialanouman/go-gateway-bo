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
		// G703 suit la teinture de l'URL jusqu'ici. Ce qui la rend inoffensive n'est pas le `fs.Stat`
		// ci-dessus — `io/fs.Stat` ne valide rien, il délègue à `Open` — mais le contrat de `fs.FS`,
		// dont l'`Open` doit rejeter tout nom que `fs.ValidPath` refuse, et l'implémentation
		// réellement injectée : `fs.Sub` rend un `subFS`, qui les rejette dans `fullName`
		// (`io/fs/sub.go:60-65`). Un `..` n'a donc aucun parent où remonter.
		//
		// Aucun test ne descend jusqu'à `fullName`, et ce n'est pas un manque :
		// `TestAssetPathCannotEscapeItsDirectory` mesure le résultat — un `..` ne sort pas — et
		// s'arrête au `fs.Stat` ci-dessus. Même sans lui, `ServeFileFS` refuse `..` sur
		// `r.URL.Path` par 400 (`net/http/fs.go:849-857`) sans jamais atteindre `fullName`.
		http.ServeFileFS(w, r, assets, name) //nolint:gosec // G703 : voir juste au-dessus
	}
}

// serveShell tranche entre un fichier et une URL de navigation sur la seule question qui décide :
// le chemin demandé désigne-t-il un fichier existant ? Si oui il est servi ; sinon c'est la
// coquille, car les URL de navigation n'existent que côté client et c'est le routeur du navigateur
// qui les tranche. La profondeur n'entre pas dans la règle : Vite recopie `web/public/` sans hacher
// les noms et **récursivement**, donc `fonts/inter.woff2` est un fichier public autant que
// `favicon.svg`. Rendre la coquille à la place de l'un ou de l'autre le servirait en `text/html`
// avec 200 — le défaut de DN-6 hors de `/assets/`, silencieux jusqu'au `@font-face` sans effet.
//
// La réciproque est assumée : un fichier du bundle masque la route SPA homonyme, à n'importe quelle
// profondeur. C'est déjà vrai en production sans que personne l'ait choisi — `//go:embed all:dist`
// embarque le `.gitkeep` du dépôt, et `GET /.gitkeep` rend donc 200 avec un corps vide.
func serveShell(assets fs.FS) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := shellName
		if requested := strings.TrimPrefix(r.URL.Path, "/"); isFile(assets, requested) {
			name = requested
		}

		w.Header().Set("Cache-Control", shellCacheControl)
		http.ServeFileFS(w, r, assets, name) //nolint:gosec // G703 : même garantie que serveAsset
	}
}

// isFile écarte l'inexistant — un nom que `fs.ValidPath` refuse, `/` compris, y tombe aussi — et les
// répertoires. Sans `!IsDir`, `/assets` rendrait 301 vers `assets/` au lieu de la coquille.
func isFile(assets fs.FS, name string) bool {
	info, err := fs.Stat(assets, name)

	return err == nil && !info.IsDir()
}
