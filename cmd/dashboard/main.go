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
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
	"github.com/martialanouman/go-gateway-bo/internal/bff"
	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/martialanouman/go-gateway-bo/internal/mfa"
	"github.com/martialanouman/go-gateway-bo/internal/session"
	"github.com/martialanouman/go-gateway-bo/internal/store"
	"github.com/martialanouman/go-gateway-bo/internal/webassets"
)

// poolCloseGrace borne l'attente de la fermeture du pool, **et n'est pas le délai de grâce**. Celui-ci
// est déjà consommé quand `serve` rend la main ; le rejouer porterait le pire cas d'arrêt à 30 s, soit
// le budget par défaut d'un orchestrateur avant SIGKILL. Ce qui reste à attendre ici est court :
// `serve` ferme les connexions client, ce qui annule le contexte des requêtes en vol et fait rendre
// leurs connexions à la base.
const poolCloseGrace = 2 * time.Second

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

	// **Le pool ne reçoit pas `ctx`.** `NewPool` attacherait sa fermeture à l'annulation, donc au
	// SIGTERM : le pool se fermerait **au début** du délai de grâce, et les requêtes que ce délai
	// existe pour laisser finir tomberaient sur un pool fermé. `WithoutCancel` rend un contexte sans
	// `Done`, auprès duquel `AfterFunc` n'inscrit rien.
	pool, err := store.NewPool(context.WithoutCancel(ctx), cfg.DatabaseURL)
	if err != nil {
		return err
	}

	// Rien ne garde cette ligne, et c'est mesuré : la retirer laisse tout vert, parce que le processus
	// s'arrête juste après et que l'OS ferme ses sockets. Ce qu'elle change — une déconnexion annoncée
	// plutôt que découverte — n'est visible d'aucun test d'ici.
	defer store.ClosePool(pool, poolCloseGrace)

	authenticator := auth.NewAuthenticator(store.NewLogins(pool), cfg.Auth.BruteForceSalt)
	sessions := session.NewManager(store.NewSessions(pool), cfg.Auth.SessionSecret)

	// Avant la liaison du port : dériver la clé de chiffrement est la dernière chose qui puisse
	// échouer sur la configuration, et un serveur qui écoute déjà refuserait alors chaque enrôlement
	// sans que rien n'ait dit pourquoi au démarrage.
	secondFactor, err := mfa.NewManager(store.NewMFA(pool), cfg.Auth.TOTPEncryptionKey)
	if err != nil {
		return err
	}

	ln, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		return fmt.Errorf("écoute sur %s : %w", cfg.Addr, err)
	}

	logger.Info("le serveur écoute", "addr", ln.Addr().String())

	router := bff.NewRouter(bff.Dependencies{
		Assets:         assets,
		Authenticator:  authenticator,
		Sessions:       sessions,
		SecondFactor:   secondFactor,
		TrustedProxies: cfg.Auth.TrustedProxies,
	})

	return serve(ctx, ln, router, cfg.ShutdownTimeout, logger)
}
