// Le binaire du tableau de bord : configuration, serveur HTTP, arrêt propre.
package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/martialanouman/go-gateway-bo/internal/bff"
	"github.com/martialanouman/go-gateway-bo/internal/config"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, os.Getenv); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// run existe séparément de main pour être appelable avec un environnement et un
// contexte choisis.
func run(ctx context.Context, getenv func(string) string) error {
	configuration, err := config.Load(getenv)
	if err != nil {
		return fmt.Errorf("configuration invalide :\n%w", err)
	}

	listener, err := net.Listen("tcp", configuration.Addr)
	if err != nil {
		return fmt.Errorf("écoute sur %s : %w", configuration.Addr, err)
	}

	return bff.Serve(ctx, listener, bff.NewRouter(), configuration.ShutdownTimeout)
}
