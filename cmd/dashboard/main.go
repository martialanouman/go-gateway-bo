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

	"github.com/martialanouman/go-gateway-bo/internal/auth"
	"github.com/martialanouman/go-gateway-bo/internal/bff"
	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/martialanouman/go-gateway-bo/internal/store"
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
	//nolint:forbidigo // La seule lecture d'environnement **du serveur**, et elle ne fait que la
	// passer au chargeur. Elle n'est plus la seule du dépôt depuis step-021 : `cmd/bootstrap` en porte
	// une, pour ses propres variables, avec la même exemption sur la ligne. Une par programme, aucune
	// ailleurs. L'exemption reste posée sur la ligne et non sur le fichier : sinon toute lecture
	// ajoutée plus tard dans main passerait avec elle.
	cfg, err := config.Load(os.LookupEnv)
	if err != nil {
		return err
	}

	// Avant `net.Listen`, et non après : une instance qui lie son port puis refuse est déjà dans le
	// pool du load balancer, le temps d'un aller-retour de sonde. Le récit du démarrage se lit alors
	// dans l'ordre — la configuration est-elle complète, le schéma est-il celui que j'attends, les
	// assets, j'écoute.
	//
	// Ce que cette ligne change pour l'exploitation : le binaire exige désormais une base
	// **joignable**. Jusqu'ici le DSN n'était validé qu'en forme (step-005, DN-5), et le cas « DSN
	// bien formé, base injoignable » n'était observable nulle part — c'est la dette que DN-6 laissait
	// à la première step qui lirait la base.
	if err = store.VerifySchema(ctx, cfg.DatabaseURL); err != nil {
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

	// **Le pool ne reçoit pas `ctx`**, et l'écart mérite d'être lu deux fois. `NewPool` attache
	// `pool.Close` à l'annulation du contexte qu'on lui passe (`context.AfterFunc`) : lui donner `ctx`
	// fermerait le pool à l'instant du SIGTERM, c'est-à-dire **au début** du délai de grâce — et les
	// requêtes que ce délai existe pour laisser finir tomberaient sur un pool fermé. Le pool survit
	// donc à l'annulation et meurt quand `serve` a rendu la main.
	//
	// `context.WithoutCancel` rend un contexte dont `Done()` est nil, et `AfterFunc` n'inscrit rien
	// auprès d'un contexte que rien n'annulera. Cette voie-là ne se contente donc pas de se taire :
	// elle n'existe pas ici — et c'est voulu, parce qu'elle **n'attend pas**. `AfterFunc` lance `Close`
	// dans sa propre goroutine, si bien qu'un binaire qui compterait sur elle sortirait de `main`
	// pendant que ses connexions se ferment, en laissant derrière lui des backends que PostgreSQL
	// compte encore dans `max_connections`. La fermeture est écrite ici, où elle bloque.
	pool, err := store.NewPool(context.WithoutCancel(ctx), cfg.DatabaseURL)
	if err != nil {
		return err
	}

	// Après `serve`, donc après le délai de grâce : les requêtes que ce délai laisse finir ont rendu
	// leurs connexions, et il ne reste qu'à les fermer. Le **même** délai borne l'attente, parce que
	// le cas qui reste est celui où la grâce a expiré sans que tout soit fini — et là, attendre sans
	// borne ferait pendre le binaire. `ClosePool` porte l'arbitrage.
	defer store.ClosePool(pool, cfg.ShutdownTimeout)

	authenticator := auth.NewAuthenticator(store.NewLogins(pool), cfg.Auth.BruteForceSalt)

	ln, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		return fmt.Errorf("écoute sur %s : %w", cfg.Addr, err)
	}

	logger.Info("le serveur écoute", "addr", ln.Addr().String())

	router := bff.NewRouter(bff.Dependencies{
		Assets:         assets,
		Authenticator:  authenticator,
		TrustedProxies: cfg.Auth.TrustedProxies,
	})

	return serve(ctx, ln, router, cfg.ShutdownTimeout, logger)
}
