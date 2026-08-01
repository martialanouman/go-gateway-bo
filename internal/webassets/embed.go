// Package webassets porte les assets du client, embarqués dans le binaire.
//
// Le répertoire `dist/` est la **sortie de build de Vite** : `web/vite.config.ts`
// y écrit directement plutôt que dans `web/dist`, pour qu'il n'y ait qu'un seul
// artefact et aucune étape de copie à maintenir. Il est ignoré par git à
// l'exception d'un `.gitkeep`, sans lequel `//go:embed` refuserait de compiler
// sur un clone jamais construit — et `go test ./...` avec lui.
package webassets

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var embarques embed.FS

// FS rend l'arborescence servie, racinée sur le contenu de `dist/`.
func FS() fs.FS {
	sous, err := fs.Sub(embarques, "dist")
	if err != nil {
		// Impossible : `dist` est embarqué au moment de la compilation.
		panic(err)
	}

	return sous
}
