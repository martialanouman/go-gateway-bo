package config_test

import (
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Deux formes comptent, et il faut les **distinguer** : `FOO=` est un réglage
// actif, `# FOO=` une documentation inerte. Le premier jet ne voyait pas les
// commentaires (une variable fantôme commentée passait) ; le second les a
// confondus avec les actives, et une variable obligatoire commentée devenait
// verte au test tout en cassant `cp .env.example .env && make dev`.
var assignment = regexp.MustCompile(`(?m)^(\s*#)?\s*([A-Z0-9_]+)=(.*)$`)

type documented struct {
	value  string
	active bool
}

func readEnvExample(t *testing.T) map[string]documented {
	t.Helper()

	content, err := os.ReadFile("../../.env.example")
	require.NoError(t, err)

	entries := map[string]documented{}
	for _, match := range assignment.FindAllStringSubmatch(string(content), -1) {
		commented, name, value := match[1] != "", match[2], strings.TrimSpace(match[3])
		if _, seen := entries[name]; seen {
			t.Errorf("%s est documentée deux fois : les deux lignes se contredisent", name)
		}
		entries[name] = documented{value: value, active: !commented}
	}

	return entries
}

func TestEnvExampleDocumentsExactlyTheDeclaredVariables(t *testing.T) {
	entries := readEnvExample(t)

	declared := map[string]bool{}
	for _, variable := range config.Variables {
		declared[variable.Name] = true
		assert.Contains(t, entries, variable.Name, "%s est lue mais absente de .env.example", variable.Name)
	}

	for name := range entries {
		assert.True(t, declared[name], "%s est documentée dans .env.example mais n'est lue nulle part", name)
	}
}

// Rétablit la garde que le correctif de la passe 1 avait supprimée en même temps
// qu'il élargissait la regex : une variable obligatoire commentée laissait la
// suite verte et cassait la procédure de démarrage du README.
func TestEnvExampleLeavesEveryRequiredVariableActive(t *testing.T) {
	entries := readEnvExample(t)

	for _, variable := range config.Variables {
		if !variable.Required {
			continue
		}
		entry := entries[variable.Name]
		assert.True(t, entry.active, "%s est obligatoire mais commentée dans .env.example", variable.Name)
		assert.NotEmpty(t, entry.value, "%s est obligatoire mais son exemple est vide", variable.Name)
	}
}

// Ne charge que les lignes **actives** : c'est ce que `sh` verra après
// `cp .env.example .env`. Charger aussi les commentaires ferait passer un
// fichier que la procédure documentée ne sait pas démarrer.
func TestEnvExampleActiveValuesActuallyLoad(t *testing.T) {
	entries := readEnvExample(t)

	loaded, err := config.Load(func(name string) string {
		if entry, ok := entries[name]; ok && entry.active {
			return entry.value
		}
		return ""
	})

	require.NoError(t, err, ".env.example, tel que le shell le lira, ne suffit pas à démarrer")
	assert.NotNil(t, loaded)
}
