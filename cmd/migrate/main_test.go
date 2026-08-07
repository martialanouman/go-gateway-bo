package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/bddtest"
)

// Le DSN porte le mot de passe de la base. Ce dépôt a déjà dépensé trois commentaires et un test à
// l'empêcher de sortir dans un message d'erreur ; passé en argument, il sortait par la porte à côté
// — `ps aux` affiche la ligne de commande de tout processus de la machine, et `go run` la duplique
// dans le processus fils.
func TestTheDSNIsReadOnStandardInput(t *testing.T) {
	t.Parallel()

	const password = "tr0p-secret"

	// Un DSN illisible : la commande ne joint aucune base, et le refus prouve à lui seul qu'elle a lu
	// l'entrée standard — sans lui, elle se serait arrêtée sur « aucun DSN ».
	err := start(strings.NewReader("password = '"+password+"' host=localhost sslmode=zzz\n"), nil)

	require.Error(t, err, "un DSN illisible a été accepté")
	assert.Contains(t, err.Error(), "DSN PostgreSQL invalide",
		"le DSN lu sur l'entrée standard n'a pas atteint les migrations")
	assert.NotContains(t, err.Error(), password,
		"le mot de passe de la base est reparti dans l'erreur que `make migrate` imprime")
}

// L'entrée standard porte un DSN, elle aussi : sans cela, retirer la garde laisserait la commande
// se plaindre d'une entrée vide — un refus qui parle bien de l'« entrée standard » et prouverait
// donc n'importe quoi.
func TestADSNPassedAsArgumentIsRefusedRatherThanUsed(t *testing.T) {
	t.Parallel()

	err := start(strings.NewReader("host=localhost sslmode=zzz\n"),
		[]string{"postgres://dashboard:secret@localhost/dashboard"})

	require.Error(t, err, "un DSN passé en argument a été accepté : il s'afficherait dans `ps aux`")
	assert.Contains(t, err.Error(), "ne prend aucun argument",
		"la commande a travaillé au lieu de refuser l'argument")
	assert.Contains(t, err.Error(), "entrée standard",
		"le refus ne dit pas par où passer à la place")
}

func TestAnEmptyStandardInputSaysHowToPassTheDSN(t *testing.T) {
	t.Parallel()

	err := start(strings.NewReader("  \n"), nil)

	require.Error(t, err, "un DSN vide a été accepté")
	assert.Contains(t, err.Error(), "entrée standard")
}

// `make migrate` s'annonce avec `DASHBOARD_DATABASE_URL`, donc
// `DASHBOARD_DATABASE_URL=…/staging make migrate` est la forme naturelle. C'est le seul endroit du
// dépôt où l'ordre de précédence décide de **quelle base** on modifie : un `.env` qui gagne joue les
// migrations sur la base locale en affichant « appliquée : … » comme si tout allait bien.
//
// La recette est lue dans le Makefile (`make -n`) puis jouée dans un bac à sable, avec un `go`
// factice au bout : ce qui est observé est donc le texte livré, et non une reconstitution.
func TestMakeMigratePrefersTheCallerDSNAndKeepsItOutOfArgv(t *testing.T) {
	t.Parallel()

	const (
		callerDSN = "postgres://dashboard:secret@depuis-l-appelant/staging"
		fileDSN   = "postgres://dashboard:secret@depuis-le-fichier/local"
	)

	sandbox := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(sandbox, ".env"),
		[]byte("DASHBOARD_DATABASE_URL="+fileDSN+"\n"), 0o600))

	fakeGo := filepath.Join(sandbox, "bin")
	require.NoError(t, os.Mkdir(fakeGo, 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(fakeGo, "go"),
		[]byte("#!/bin/sh\nprintf 'argv: %s\\n' \"$*\"\nprintf 'entrée standard: '\ncat\n"), 0o700))

	output := runRecipe(t, makeRecipe(t, "migrate"), sandbox, fakeGo,
		"DASHBOARD_DATABASE_URL="+callerDSN)

	assert.Contains(t, output, "entrée standard: "+callerDSN,
		"le DSN de l'appelant n'est pas celui qui a été migré : `.env` a écrasé l'environnement, et "+
			"`DASHBOARD_DATABASE_URL=…/staging make migrate` jouerait sur la base locale")
	assert.NotContains(t, output, fileDSN,
		"le DSN de `.env` a servi alors que l'appelant en imposait un autre")

	argv, _, _ := strings.Cut(output, "\n")
	assert.NotContains(t, argv, callerDSN,
		"le DSN est passé en argument : %s l'afficherait à tout compte de la machine", "ps aux")
}

// makeRecipe rend la recette d'une cible telle que `make` la jouerait, variables développées.
func makeRecipe(t *testing.T, target string) string {
	t.Helper()

	// `--no-print-directory` n'est pas un confort : sans lui, GNU Make **4.x** préfixe la recette
	// d'un `make[1]: Entering directory …` dès qu'un `make` parent l'appelle — et `make test-go` en
	// est un. `sh` essaie alors de l'exécuter et rend `exit status 127`. Invisible ici : macOS livre
	// GNU Make 3.81, qui ne l'imprime pas. Mesuré le 02/08/2026 sur `golang:1.25` (Make 4.4.1),
	// après que la CI l'a trouvé et pas `make check`.
	command := exec.Command("make", "--dry-run", "--no-print-directory", target)
	command.Dir = bddtest.RepositoryRoot(t)

	recipe, err := command.Output()
	require.NoErrorf(t, err, "lire la recette de `make %s`", target)
	require.NotEmptyf(t, recipe, "la cible %s n'a plus de recette", target)

	return string(recipe)
}

// runRecipe joue la recette dans un bac à sable, `binDir` en tête du PATH.
func runRecipe(t *testing.T, recipe, sandbox, binDir string, environment ...string) string {
	t.Helper()

	command := exec.Command("sh", "-c", recipe)
	command.Dir = sandbox

	// `command.Environ()` et non `os.Environ()` : `forbidigo` interdit le second, parce que
	// `internal/config` est le seul package qui lit l'environnement (§1.8). Les entrées ajoutées en
	// queue l'emportent — `exec` ne garde que la dernière de chaque nom.
	inherited := command.Environ()
	command.Env = append(append(inherited, pathLedBy(inherited, binDir)), environment...)

	output, err := command.CombinedOutput()
	require.NoErrorf(t, err, "jouer la recette : %s", output)

	return string(output)
}

// pathLedBy rend le PATH hérité, précédé du répertoire donné : c'est le `go` du bac à sable que la
// recette doit trouver, et pas celui de la machine.
func pathLedBy(environment []string, directory string) string {
	for _, entry := range environment {
		if inherited, found := strings.CutPrefix(entry, "PATH="); found {
			return "PATH=" + directory + string(os.PathListSeparator) + inherited
		}
	}

	return "PATH=" + directory
}
