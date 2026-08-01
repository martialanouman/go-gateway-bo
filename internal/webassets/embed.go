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
	"fmt"
	"io/fs"
)

//go:embed all:dist
var embarques embed.FS

// FS rend l'arborescence servie, racinée sur le contenu de `dist/`.
//
// Elle échoue quand le client n'a pas été construit — `go build ./cmd/dashboard`
// sans `make build` compile, puisque le `.gitkeep` suffit au pattern d'embed, et
// produirait sinon un binaire qui rend 500 sur toute URL d'application sans rien
// journaliser. Un opérateur y lirait un incident produit là où c'est une erreur
// de construction.
func FS() (fs.FS, error) {
	sous, err := fs.Sub(embarques, "dist")
	if err != nil {
		return nil, fmt.Errorf("assets embarqués illisibles : %w", err)
	}

	if _, err := fs.Stat(sous, "index.html"); err != nil {
		return nil, fmt.Errorf(
			"assets du client absents du binaire : lancer `make build` et non `go build` seul (%w)", err)
	}

	return sous, nil
}
