// Command dashboard sert le tableau de bord Admin : le BFF et, à terme, les assets de la SPA.
package main

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"os"

	"github.com/martialanouman/go-gateway-bo/internal/config"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	if err := run(context.Background(), logger); err != nil {
		logger.Error("le serveur ne démarre pas", "error", err)
		os.Exit(1)
	}
}

func run(_ context.Context, logger *slog.Logger) error {
	cfg, err := config.Load(os.LookupEnv)
	if err != nil {
		return err
	}

	ln, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		return err
	}

	logger.Info("le serveur écoute", "addr", ln.Addr().String())

	return http.Serve(ln, http.NotFoundHandler())
}
