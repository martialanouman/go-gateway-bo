package config_test

import (
	"testing"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func envFrom(overrides map[string]string) func(string) string {
	env := map[string]string{}
	for _, variable := range config.Variables {
		env[variable.Name] = variable.Example
	}
	for name, value := range overrides {
		env[name] = value
	}
	return func(name string) string { return env[name] }
}

func TestLoadRejectsInvalidValues(t *testing.T) {
	cases := map[string]struct {
		overrides map[string]string
		names     string
	}{
		"une adresse qui n'est pas hôte:port": {
			overrides: map[string]string{config.EnvAddr: "pas-une-adresse"},
			names:     config.EnvAddr,
		},
		"un port hors des bornes": {
			overrides: map[string]string{config.EnvAddr: ":99999"},
			names:     config.EnvAddr,
		},
		"un port non numérique": {
			overrides: map[string]string{config.EnvAddr: ":http"},
			names:     config.EnvAddr,
		},
		"un délai d'arrêt négatif": {
			overrides: map[string]string{config.EnvShutdownTimeout: "-1s"},
			names:     config.EnvShutdownTimeout,
		},
		"un délai d'arrêt nul": {
			overrides: map[string]string{config.EnvShutdownTimeout: "0s"},
			names:     config.EnvShutdownTimeout,
		},
		"un délai d'arrêt illisible": {
			overrides: map[string]string{config.EnvShutdownTimeout: "quinze secondes"},
			names:     config.EnvShutdownTimeout,
		},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := config.Load(envFrom(tc.overrides))

			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.names, "le message doit nommer la variable fautive")
		})
	}
}

func TestLoadReportsEveryProblemAtOnce(t *testing.T) {
	_, err := config.Load(envFrom(map[string]string{
		config.EnvAddr:            "",
		config.EnvShutdownTimeout: "-1s",
	}))

	require.Error(t, err)
	assert.Contains(t, err.Error(), config.EnvAddr)
	assert.Contains(t, err.Error(), config.EnvShutdownTimeout)
}

func TestLoadAppliesDefaultShutdownTimeout(t *testing.T) {
	loaded, err := config.Load(envFrom(map[string]string{config.EnvShutdownTimeout: ""}))

	require.NoError(t, err)
	assert.Equal(t, 15*time.Second, loaded.ShutdownTimeout)
}

// Ferme la boucle **dans les deux sens** entre la liste déclarée et le code qui
// lit. Le premier jet n'assérait que `déclarées ⊆ lues` : une lecture non
// déclarée passait, et `.env.example` cessait de lister toutes les variables
// lues sans qu'aucun test ne rougisse — le trou exact que ce mécanisme existe
// pour fermer.
func TestLoadReadsExactlyTheDeclaredVariables(t *testing.T) {
	read := map[string]bool{}
	base := envFrom(nil)

	_, err := config.Load(func(name string) string {
		read[name] = true
		return base(name)
	})
	require.NoError(t, err)

	declared := map[string]bool{}
	for _, variable := range config.Variables {
		declared[variable.Name] = true
		assert.True(t, read[variable.Name], "%s est déclarée mais Load ne la lit pas", variable.Name)
	}

	for name := range read {
		assert.True(t, declared[name], "Load lit %s sans qu'elle soit déclarée dans Variables", name)
	}
}
