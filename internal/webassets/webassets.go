// Package webassets embarque la sortie de build du client React dans le binaire, pour que le
// tableau de bord se livre en un seul déployable.
package webassets

import (
	"embed"
	"io/fs"
)

// Le motif est `all:dist` et non `dist` : sans le préfixe, `//go:embed` écarte les fichiers dont le
// nom commence par un point, et un motif qui ne matche rien est une erreur de compilation. Un clone
// neuf n'a que `.gitkeep` sous `dist/`, donc `dist` seul ferait échouer `go build` partout sauf sur
// le poste qui vient de construire le client.
//
//go:embed all:dist
var embedded embed.FS

// FS rend la racine du site — `index.html`, `assets/…` — et non l'arborescence embarquée, dont
// `dist/` est le premier segment. Le répertoire n'est qu'une contrainte de `//go:embed`, qui
// interprète ses motifs relativement au fichier source et ne peut pas remonter ; aucun consommateur
// n'a à le connaître.
func FS() (fs.FS, error) {
	return fs.Sub(embedded, "dist")
}
