// Command dashboard sert le tableau de bord Admin : le BFF et les assets de la SPA, embarqués dans
// le binaire.
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
	"github.com/martialanouman/go-gateway-bo/internal/webassets"
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

	// Rien ici ne vérifie que les assets sont utilisables, et la branche d'erreur ci-dessous est
	// inatteignable : `fs.Sub` ne rend une erreur que pour un chemin invalide, or `webassets.FS` lui
	// passe une constante valide. Elle est propagée quand même plutôt qu'écartée d'un `_`, parce
	// qu'elle appartient à la signature et qu'un jour cette signature pourra dire autre chose.
	//
	// La garde de démarrage qu'on attendrait ici — constater qu'`index.html` est là — n'existe pas
	// exprès : `make dev` passe par `build-go`, qui ne copie rien dans `dist/` parce que c'est Vite
	// qui sert le client en développement. Sur un clone neuf, une telle garde empêcherait donc le BFF
	// de démarrer. Un binaire sans assets rend `404` sur `/` — vérifié — et c'est `make build` qui
	// répond de leur présence (DN-4).
	assets, err := webassets.FS()
	if err != nil {
		return fmt.Errorf("assets embarqués : %w", err)
	}

	ln, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		return fmt.Errorf("écoute sur %s : %w", cfg.Addr, err)
	}

	logger.Info("le serveur écoute", "addr", ln.Addr().String())

	return serve(ctx, ln, bff.NewRouter(assets), cfg.ShutdownTimeout, logger)
}
