package bddtest

import (
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Le tampon existe parce qu'un processus tiers — Prism, le binaire — écrit depuis sa propre goroutine
// pendant que le harnais lit. Sans verrou, `-race` signale la course avant même que quoi que ce soit
// n'échoue. Ce test ne prouve rien seul : c'est `-race` qui le rend probant, et `test-go` le passe.
func TestTheBufferSurvivesConcurrentWritesAndReads(t *testing.T) {
	t.Parallel()

	buffer := &SyncBuffer{}

	var writers sync.WaitGroup
	for range 8 {
		writers.Add(1)

		go func() {
			defer writers.Done()

			_, _ = buffer.Write([]byte("x"))
			_ = buffer.String()
		}()
	}

	writers.Wait()

	assert.Len(t, buffer.String(), 8, "des écritures se sont perdues en route")
}

// La racine se cherche en remontant jusqu'à un `go.mod`, et non par `git rev-parse --show-toplevel`.
// Les deux implémentations coexistaient dans le dépôt ; celle-ci ne dépend d'aucun binaire externe et
// ne suppose pas que l'arbre soit un dépôt git — un export en archive casserait l'autre.
//
// Le commentaire qui justifiait `git` disait qu'y renoncer « coderait la profondeur de ce package ».
// C'est faux de cette implémentation-ci, qui remonte jusqu'à trouver le fichier et ne code aucune
// profondeur : elle rend la même racine depuis n'importe quel répertoire de l'arbre, ce que le second
// cas ci-dessous mesure.
func TestTheRepositoryRootIsFoundFromAnywhereInTheTree(t *testing.T) {
	root := RepositoryRoot(t)

	require.FileExists(t, filepath.Join(root, "go.mod"))

	t.Chdir(filepath.Join(root, "internal", "bddtest"))

	assert.Equal(t, root, RepositoryRoot(t),
		"la racine dépend du répertoire d'où on la demande — donc de la profondeur de l'appelant")
}

// Les deux implémentations que ce package remplace doivent rendre la même racine, sans quoi le
// remplacement changerait le comportement de l'une des suites sans le dire.
func TestTheRootMatchesWhatGitReports(t *testing.T) {
	show := exec.Command("git", "rev-parse", "--show-toplevel")

	reported, err := show.Output()
	if err != nil {
		t.Skipf("git ne rend pas la racine ici (%v) — c'est précisément la dépendance que "+
			"RepositoryRoot n'a pas", err)
	}

	// macOS sert `/tmp` et `/var` par des liens symboliques, et git rend le chemin résolu là où
	// `os.Getwd` rend celui que le shell a suivi. Sur ce dépôt les deux coïncident ; la résolution est
	// posée pour que ce test ne se mette pas à mentir ailleurs.
	expected, err := filepath.EvalSymlinks(strings.TrimSpace(string(reported)))
	require.NoError(t, err)
	actual, err := filepath.EvalSymlinks(RepositoryRoot(t))
	require.NoError(t, err)

	assert.Equal(t, expected, actual)
}
