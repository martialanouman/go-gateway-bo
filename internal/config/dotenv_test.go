package config_test

import (
	"bufio"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/config"
)

const dotenvExample = "../../.env.example"

// Documenter un réglage qui n'existe pas, ou en lire un que personne n'a documenté, sont deux
// mensonges d'interface symétriques : l'un fait chercher un effet qui n'arrivera pas, l'autre fait
// démarrer une installation qu'on croyait complète.
func TestDotenvExampleListsExactlyWhatLoadReads(t *testing.T) {
	t.Parallel()

	assert.ElementsMatch(t, config.Variables(), documentedVariables(t))
}

// Trois cibles du `Makefile` sourcent `.env` par `set -a; . ./.env` — la copie de ce fichier-ci,
// comme le README l'indique. Une valeur non quotée qui porte un espace est alors **découpée par le
// shell** : `sh` exécute la suite comme une commande, la variable reste vide, et le binaire refuse de
// démarrer en la nommant absente alors qu'elle est bien dans le fichier. Le message pointe la
// mauvaise cause.
//
// Livré une fois, le 01/09/2026, avec la première valeur du fichier à contenir un espace :
// `DASHBOARD_PRODUCT_NAME=Passerelle SMS Admin` rendait `dotenv: SMS: command not found`. La porte
// voisine ne pouvait pas le voir — elle ne compare que des **noms**.
func TestAucuneValeurDuDotenvNEstDecoupeeParLeShell(t *testing.T) {
	t.Parallel()

	file, err := os.Open(dotenvExample)
	require.NoError(t, err)
	defer file.Close()

	assignments := 0

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		name, value, ok := strings.Cut(line, "=")
		require.True(t, ok)

		assignments++

		if !strings.ContainsAny(value, " \t") {
			continue
		}

		assert.Truef(t, strings.HasPrefix(value, `"`) && strings.HasSuffix(value, `"`),
			"la valeur de %s porte une espace sans être entre guillemets : `. ./.env` la découpe, "+
				"exécute la suite comme une commande et laisse la variable vide", name)
	}
	require.NoError(t, scanner.Err())

	require.Positive(t, assignments, "aucune affectation lue : la porte est inerte, pas verte")
}

func documentedVariables(t *testing.T) []string {
	t.Helper()

	file, err := os.Open(dotenvExample)
	require.NoError(t, err)
	defer file.Close()

	var names []string

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		name, _, ok := strings.Cut(line, "=")
		require.Truef(t, ok, "ligne sans affectation dans %s : %q", dotenvExample, line)
		names = append(names, strings.TrimSpace(name))
	}
	require.NoError(t, scanner.Err())

	return names
}
