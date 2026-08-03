package bddtest

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
)

// SyncBuffer recueille la sortie d'un processus que le harnais surveille — Prism, le binaire du
// tableau de bord. Celui-ci écrit depuis sa propre goroutine pendant que le test lit : sans verrou,
// `-race` signale la course avant même que quoi que ce soit n'échoue.
type SyncBuffer struct {
	mu       sync.Mutex
	contents strings.Builder
}

func (b *SyncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.contents.Write(p)
}

func (b *SyncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.contents.String()
}

// RepositoryRoot rend la racine du module, celle qui porte `go.mod`. Les chemins que les suites
// composent à partir d'elle — le binaire de Prism, les contrats installés par pnpm — sont écrits
// depuis la racine et non depuis le répertoire du paquet appelant.
//
// Elle remonte l'arbre jusqu'au `go.mod` plutôt que d'appeler `git rev-parse --show-toplevel` :
// aucune dépendance à un binaire externe, et aucune supposition que l'arbre soit un dépôt git — un
// export en archive casserait la seconde forme. `TestTheRootMatchesWhatGitReports` mesure que les
// deux coïncident ici, puisque les deux vivaient dans le dépôt.
func RepositoryRoot(t *testing.T) string {
	t.Helper()

	directory, err := os.Getwd()
	require.NoError(t, err)

	for {
		if _, err := os.Stat(filepath.Join(directory, "go.mod")); err == nil {
			return directory
		}

		parent := filepath.Dir(directory)
		require.NotEqualf(t, parent, directory, "aucun go.mod au-dessus de %s", directory)

		directory = parent
	}
}
