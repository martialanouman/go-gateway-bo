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
	"github.com/martialanouman/go-gateway-bo/internal/webassets"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)

	// Rendre la disposition par défaut dès le premier signal : sans cela,
	// `signal.Notify` reste enregistré pendant tout le drain, un second SIGTERM
	// part dans un canal que plus personne ne lit, et l'opérateur n'a plus que
	// SIGKILL pour reprendre la main.
	go func() {
		<-ctx.Done()
		stop()
	}()

	if err := run(ctx, os.Getenv); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// run existe séparément de main pour être appelable avec un environnement et un
// contexte choisis — c'est ce que fait `main_test.go`.
func run(ctx context.Context, getenv func(string) string) error {
	configuration, err := config.Load(getenv)
	if err != nil {
		return fmt.Errorf("configuration invalide :\n%w", err)
	}

	listener, err := new(net.ListenConfig).Listen(ctx, "tcp", configuration.Addr)
	if err != nil {
		return fmt.Errorf("%s : écoute impossible sur %s : %w", config.EnvAddr, configuration.Addr, err)
	}

	if err := bff.Serve(ctx, listener, bff.NewRouter(webassets.FS()), configuration.ShutdownTimeout); err != nil {
		return fmt.Errorf("arrêt du serveur (grâce %s) : %w", configuration.ShutdownTimeout, err)
	}

	return nil
}
