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
