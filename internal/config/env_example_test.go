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

// Les deux formes comptent : `FOO=` documente, `# FOO=` documente aussi — c'est
// l'idiome des réglages optionnels, et le premier jet ne le voyait pas. Une
// variable fantôme commentée passait alors le test qui prétend tenir le fichier.
var assignment = regexp.MustCompile(`(?m)^\s*#?\s*([A-Z0-9_]+)=(.*)$`)

func readEnvExample(t *testing.T) (values map[string]string, order []string) {
	t.Helper()

	content, err := os.ReadFile("../../.env.example")
	require.NoError(t, err)

	values = map[string]string{}
	for _, match := range assignment.FindAllStringSubmatch(string(content), -1) {
		name, value := match[1], strings.TrimSpace(match[2])
		assert.NotContains(t, order, name, "%s est documentée deux fois : les deux lignes se contredisent", name)
		order = append(order, name)
		values[name] = value
	}

	return values, order
}

func TestEnvExampleDocumentsExactlyTheDeclaredVariables(t *testing.T) {
	documented, _ := readEnvExample(t)

	declared := map[string]bool{}
	for _, variable := range config.Variables {
		declared[variable.Name] = true
		assert.Contains(t, documented, variable.Name, "%s est lue mais absente de .env.example", variable.Name)
	}

	for name := range documented {
		assert.True(t, declared[name], "%s est documentée dans .env.example mais n'est lue nulle part", name)
	}
}

// Le premier jet n'exigeait qu'une valeur non vide. `DASHBOARD_ADDR=oui` le
// passait, et qui suivait le fichier à la lettre voyait le binaire refuser de
// démarrer. On charge donc réellement ce que le fichier propose.
func TestEnvExampleValuesActuallyLoad(t *testing.T) {
	documented, _ := readEnvExample(t)

	loaded, err := config.Load(func(name string) string { return documented[name] })

	require.NoError(t, err, ".env.example propose des valeurs que Load refuse")
	assert.NotNil(t, loaded)
}
