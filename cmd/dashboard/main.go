// Command dashboard sert le tableau de bord Admin : le BFF et, à terme, les assets de la SPA.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/martialanouman/go-gateway-bo/internal/bff"
	"github.com/martialanouman/go-gateway-bo/internal/config"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	// os.Exit reste seul dans main : appelé plus bas, il court-circuiterait le `defer stop()` qui
	// rend le process à nouveau tuable par un second signal.
	if err := start(logger); err != nil {
		logger.Error("le serveur s'arrête", "error", err)
		os.Exit(1)
	}
}

func start(logger *slog.Logger) error {
	// Le contexte racine naît ici et descend partout : toute goroutine ajoutée au BFF s'arrêtera sur
	// son annulation, et c'est cette convention qui rendra le hub WebSocket testable.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	return run(ctx, logger)
}

func run(ctx context.Context, logger *slog.Logger) error {
	cfg, err := config.Load(os.LookupEnv)
	if err != nil {
		return err
	}

	ln, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		return fmt.Errorf("écoute sur %s : %w", cfg.Addr, err)
	}

	logger.Info("le serveur écoute", "addr", ln.Addr().String())

	return serve(ctx, ln, bff.NewRouter(), cfg.ShutdownTimeout, logger)
}
