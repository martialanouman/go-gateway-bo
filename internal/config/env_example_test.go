package config_test

import (
	"os"
	"regexp"
	"testing"

	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var assignment = regexp.MustCompile(`(?m)^([A-Z0-9_]+)=`)

// `.env.example` est de la documentation, donc elle ment dès qu'on oublie de la
// mettre à jour. Ce test la tient contre la liste que Load lit réellement.
func TestEnvExampleDocumentsExactlyTheDeclaredVariables(t *testing.T) {
	content, err := os.ReadFile("../../.env.example")
	require.NoError(t, err)

	documented := map[string]bool{}
	for _, match := range assignment.FindAllStringSubmatch(string(content), -1) {
		documented[match[1]] = true
	}

	declared := map[string]bool{}
	for _, variable := range config.Variables {
		declared[variable.Name] = true
		assert.True(t, documented[variable.Name], "%s est lue mais absente de .env.example", variable.Name)
	}

	for name := range documented {
		assert.True(t, declared[name], "%s est documentée dans .env.example mais n'est lue nulle part", name)
	}
}

// Une variable obligatoire dont l'exemple serait vide ferait échouer un
// démarrage suivant le fichier à la lettre.
func TestEnvExampleGivesAValueToEveryRequiredVariable(t *testing.T) {
	content, err := os.ReadFile("../../.env.example")
	require.NoError(t, err)

	for _, variable := range config.Variables {
		if !variable.Required {
			continue
		}
		assert.Regexp(t, `(?m)^`+regexp.QuoteMeta(variable.Name)+`=\S`, string(content),
			"%s est obligatoire mais son exemple est vide", variable.Name)
	}
}
