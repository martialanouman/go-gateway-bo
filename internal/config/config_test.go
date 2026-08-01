package config_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/config"
)

func lookupFrom(vars map[string]string) config.Lookup {
	return func(name string) (string, bool) {
		value, ok := vars[name]

		return value, ok
	}
}

func TestLoad(t *testing.T) {
	t.Parallel()

	t.Run("charge une configuration complète", func(t *testing.T) {
		t.Parallel()

		cfg, err := config.Load(lookupFrom(map[string]string{
			config.EnvAddr:            "127.0.0.1:3001",
			config.EnvShutdownTimeout: "30s",
		}))

		require.NoError(t, err)
		assert.Equal(t, "127.0.0.1:3001", cfg.Addr)
		assert.Equal(t, 30*time.Second, cfg.ShutdownTimeout)
	})

	t.Run("applique le délai de grâce par défaut quand il est absent", func(t *testing.T) {
		t.Parallel()

		cfg, err := config.Load(lookupFrom(map[string]string{config.EnvAddr: ":3001"}))

		require.NoError(t, err)
		assert.Equal(t, 15*time.Second, cfg.ShutdownTimeout)
	})

	t.Run("normalise le port plutôt que de le reprendre verbatim", func(t *testing.T) {
		t.Parallel()

		cfg, err := config.Load(lookupFrom(map[string]string{config.EnvAddr: "127.0.0.1:0080"}))

		require.NoError(t, err)
		assert.Equal(t, "127.0.0.1:80", cfg.Addr)
	})

	t.Run("ignore les espaces autour d'une valeur", func(t *testing.T) {
		t.Parallel()

		cfg, err := config.Load(lookupFrom(map[string]string{
			config.EnvAddr:            " :3001 ",
			config.EnvShutdownTimeout: " 30s ",
		}))

		require.NoError(t, err)
		assert.Equal(t, ":3001", cfg.Addr)
		assert.Equal(t, 30*time.Second, cfg.ShutdownTimeout)
	})

	t.Run("traite une variable facultative blanche comme absente", func(t *testing.T) {
		t.Parallel()

		cfg, err := config.Load(lookupFrom(map[string]string{
			config.EnvAddr:            ":3001",
			config.EnvShutdownTimeout: "   ",
		}))

		require.NoError(t, err)
		assert.Equal(t, 15*time.Second, cfg.ShutdownTimeout)
	})

	t.Run("nomme chaque variable obligatoire absente", func(t *testing.T) {
		t.Parallel()

		_, err := config.Load(lookupFrom(map[string]string{}))

		require.Error(t, err)
		assert.Contains(t, err.Error(), config.EnvAddr+" : variable obligatoire absente")
	})

	// Le motif est assez précis pour distinguer « absente » de « malformée » : sans lui, une valeur
	// blanche traverserait et échouerait plus loin sur la validation d'adresse, avec un message qui
	// nomme la même variable — le test resterait vert pour la mauvaise raison.
	t.Run("refuse une variable obligatoire blanche", func(t *testing.T) {
		t.Parallel()

		_, err := config.Load(lookupFrom(map[string]string{config.EnvAddr: "   "}))

		require.Error(t, err)
		assert.Contains(t, err.Error(), config.EnvAddr+" : variable obligatoire absente")
	})
}

func TestLoadRejectsMalformedValues(t *testing.T) {
	t.Parallel()

	cases := map[string]struct {
		vars    map[string]string
		mention string
	}{
		"une adresse sans port": {
			vars:    map[string]string{config.EnvAddr: "127.0.0.1"},
			mention: config.EnvAddr,
		},
		"un port hors bornes": {
			vars:    map[string]string{config.EnvAddr: ":65536"},
			mention: config.EnvAddr,
		},
		"un port négatif": {
			vars:    map[string]string{config.EnvAddr: ":-1"},
			mention: config.EnvAddr,
		},
		"un port qui n'est pas un nombre": {
			vars:    map[string]string{config.EnvAddr: "127.0.0.1:http"},
			mention: config.EnvAddr,
		},
		"un délai négatif": {
			vars: map[string]string{
				config.EnvAddr:            ":3001",
				config.EnvShutdownTimeout: "-1s",
			},
			mention: config.EnvShutdownTimeout,
		},
		"un délai nul": {
			vars: map[string]string{
				config.EnvAddr:            ":3001",
				config.EnvShutdownTimeout: "0s",
			},
			mention: config.EnvShutdownTimeout,
		},
		"un délai illisible": {
			vars: map[string]string{
				config.EnvAddr:            ":3001",
				config.EnvShutdownTimeout: "quinze secondes",
			},
			mention: config.EnvShutdownTimeout,
		},
	}

	for name, tc := range cases {
		t.Run("refuse "+name, func(t *testing.T) {
			t.Parallel()

			_, err := config.Load(lookupFrom(tc.vars))

			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.mention)
		})
	}
}

func TestLoadReportsEveryProblemAtOnce(t *testing.T) {
	t.Parallel()

	// Corriger une variable pour découvrir la suivante au redémarrage suivant fait perdre un cycle
	// par variable — sur une installation neuve, c'est la moitié de la mise en service.
	_, err := config.Load(lookupFrom(map[string]string{config.EnvShutdownTimeout: "-1s"}))

	require.Error(t, err)
	assert.Contains(t, err.Error(), config.EnvAddr)
	assert.Contains(t, err.Error(), config.EnvShutdownTimeout)
}

func TestVariablesListsEveryNameLoadReads(t *testing.T) {
	t.Parallel()

	assert.ElementsMatch(t, []string{config.EnvAddr, config.EnvShutdownTimeout}, config.Variables())
}
