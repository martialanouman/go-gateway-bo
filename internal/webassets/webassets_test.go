package webassets_test

import (
	"io/fs"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/webassets"
)

// `.gitkeep` est le seul fichier dont un clone neuf dispose sous `internal/webassets/dist/`. Il est
// commité, et une cible de copie qui l'effacerait rendrait le paquet incompilable ailleurs que sur
// le poste qui vient de construire le client : le test tombe alors, ce qui est le but.
const committedSentinel = ".gitkeep"

func rootEntryNames(t *testing.T, site fs.FS) []string {
	t.Helper()

	entries, err := fs.ReadDir(site, ".")
	require.NoError(t, err)

	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}

	return names
}

func TestFS(t *testing.T) {
	t.Parallel()

	t.Run("expose la racine du site et non le répertoire qui la contient", func(t *testing.T) {
		t.Parallel()

		site, err := webassets.FS()
		require.NoError(t, err)

		names := rootEntryNames(t, site)

		assert.Contains(t, names, committedSentinel,
			"la racine rendue devrait lister le contenu de dist/, pas dist/ lui-même")
		assert.NotContains(t, names, "dist",
			"un consommateur qui demande index.html ne doit jamais préfixer par dist/")
	})

	t.Run("sert un fichier par son nom, sans préfixe dist/", func(t *testing.T) {
		t.Parallel()

		site, err := webassets.FS()
		require.NoError(t, err)

		_, err = fs.Stat(site, committedSentinel)
		require.NoError(t, err)

		_, err = fs.Stat(site, "dist/"+committedSentinel)
		assert.Error(t, err, "le préfixe dist/ ne doit plus exister dans le système de fichiers rendu")
	})
}
