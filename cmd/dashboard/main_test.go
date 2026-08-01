package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"os/exec"
	"syscall"
	"testing"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Sans ces tests, trois mutations passaient au vert : retirer `os.Exit(1)`,
// remplacer une configuration invalide par un repli, ou écouter un autre signal
// que SIGTERM. `Load` était couvert, le câblage qui en fait un refus de démarrer
// ne l'était pas.

func freeAddr(t *testing.T) string {
	t.Helper()

	listener, err := new(net.ListenConfig).Listen(t.Context(), "tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := listener.Addr().String()
	require.NoError(t, listener.Close())

	return addr
}

// Le code de sortie ne se teste qu'en relançant le binaire : `os.Exit` coupe le
// process de test. Sans lui, remplacer `os.Exit(1)` par `os.Exit(0)` laissait la
// suite verte — un ordonnanceur croirait l'installation bonne.
func TestBinaryExitsWithOneWhenConfigurationIsMissing(t *testing.T) {
	if os.Getenv("DASHBOARD_TEST_SUBPROCESS") == "1" {
		main()
		return
	}

	//nolint:gosec // G204 : ré-exécution du binaire de test lui-même, motif standard Go ; aucune entrée externe
	command := exec.CommandContext(t.Context(), os.Args[0], "-test.run=TestBinaryExitsWithOneWhenConfigurationIsMissing")
	command.Env = []string{"DASHBOARD_TEST_SUBPROCESS=1"}
	output, err := command.CombinedOutput()

	var exitErr *exec.ExitError
	require.ErrorAs(t, err, &exitErr, "le binaire aurait dû sortir en erreur, sortie : %s", output)
	assert.Equal(t, 1, exitErr.ExitCode())
	assert.Contains(t, string(output), config.EnvAddr, "la sortie doit nommer la variable manquante")
}

func TestRunRefusesToStartWithoutConfiguration(t *testing.T) {
	err := run(t.Context(), func(string) string { return "" })

	require.Error(t, err)
	assert.Contains(t, err.Error(), config.EnvAddr)
	assert.Contains(t, err.Error(), "obligatoire")
}

func TestRunRefusesAnUnusableAddress(t *testing.T) {
	err := run(t.Context(), func(name string) string {
		if name == config.EnvAddr {
			return "203.0.113.1:80" // adresse non locale : impossible à écouter
		}
		return ""
	})

	require.Error(t, err)
	assert.Contains(t, err.Error(), config.EnvAddr, "l'échec d'écoute doit nommer la variable, pas seulement sa valeur")
}

func TestRunServesThenReturnsOnCancel(t *testing.T) {
	addr := freeAddr(t)
	ctx, stop := context.WithCancel(t.Context())

	returned := make(chan error, 1)
	go func() {
		returned <- run(ctx, func(name string) string {
			if name == config.EnvAddr {
				return addr
			}
			return ""
		})
	}()

	client := &http.Client{Timeout: time.Second}
	require.Eventually(t, func() bool {
		response, err := client.Get("http://" + addr + "/api/health") //nolint:noctx // sondage de démarrage
		if err != nil {
			return false
		}
		_ = response.Body.Close()
		return response.StatusCode == http.StatusOK
	}, 5*time.Second, 10*time.Millisecond, "le serveur n'a jamais servi /api/health")

	stop()

	select {
	case err := <-returned:
		require.NoError(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("run n'a pas rendu la main après l'annulation du contexte")
	}

	response, err := client.Get("http://" + addr + "/api/health") //nolint:noctx // on vérifie le refus
	if err == nil {
		_ = response.Body.Close()
	}
	require.Error(t, err)
	assert.True(t, errors.Is(err, syscall.ECONNREFUSED), "le port doit être libéré, erreur obtenue : %v", err)
}
