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

	// os.Exit reste seul dans main : appelé depuis start, il court-circuiterait son `defer`.
	if err := start(logger); err != nil {
		logger.Error("le serveur s'arrête", "error", err)
		os.Exit(1)
	}
}

func start(logger *slog.Logger) error {
	// Le contexte racine naît ici et descend partout : toute goroutine ajoutée au BFF s'arrêtera sur
	// son annulation, et c'est cette convention qui rendra le hub WebSocket testable.
	//
	// Le `defer` ne fait que désarmer le gestionnaire au retour ; pendant le délai de grâce, un second
	// signal reste avalé et seul SIGKILL sort. C'est acceptable pour quinze secondes, et le rendre
	// interruptible demanderait de désarmer dès le premier signal — sans qu'aucun test ne puisse
	// l'observer, faute d'une requête assez lente pour ouvrir la fenêtre.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	return run(ctx, logger)
}

func run(ctx context.Context, logger *slog.Logger) error {
	//nolint:forbidigo // La seule lecture d'environnement du dépôt, et elle ne fait que la passer au
	// chargeur. L'exemption est posée sur la ligne, pas sur le fichier : sinon toute lecture ajoutée
	// plus tard dans main passerait avec elle.
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
