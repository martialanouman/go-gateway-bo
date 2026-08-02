// Command migrate applique les migrations du schéma propre au BFF sur la base dont le DSN est lu
// sur l'entrée standard.
//
// **Sur l'entrée standard, et non en argument** : `ps aux` affiche la ligne de commande de tout
// processus de la machine, `go run` la duplique dans le processus fils, et ce DSN porte le mot de
// passe de la base. Le dépôt refuse déjà que ce mot de passe sorte dans un message d'erreur
// (`internal/store`, `openSQL`) ; il sortait par la porte à côté.
//
// L'environnement, troisième voie, n'en est pas une ici : `internal/config` est le seul package du
// dépôt qui le lit (§1.8), et `forbidigo` tient la règle. `make migrate` — qui, lui, n'est pas du Go
// — lit `DASHBOARD_DATABASE_URL` puis le passe dans un tube.
//
// Tout ce que cette commande sait faire vit dans `internal/store`, donc dans le binaire unique que
// le dépôt livre : le SQL y est embarqué par `//go:embed`, jamais posé sur le disque à côté. Ce
// `main` n'est qu'un point d'entrée, et se replie sans rien perdre le jour où `cmd/dashboard` gagne
// une sous-commande `migrate`.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

const usage = "usage : printf '%s' \"$DASHBOARD_DATABASE_URL\" | migrate"

func main() {
	// os.Exit reste seul dans main : appelé depuis start, il court-circuiterait son `defer`.
	if err := start(os.Stdin, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func start(in io.Reader, args []string) error {
	if len(args) > 0 {
		return errors.New("migrate ne prend aucun argument : un DSN passé en argument s'affiche dans " +
			"`ps aux`, avec le mot de passe de la base. Il se lit sur l'entrée standard.\n" + usage)
	}

	read, err := io.ReadAll(in)
	if err != nil {
		return fmt.Errorf("lire le DSN sur l'entrée standard : %w", err)
	}

	// Les espaces de bord tombent : un `echo` termine sa ligne, et un DSN n'en porte jamais.
	dsn := strings.TrimSpace(string(read))
	if dsn == "" {
		return errors.New("aucun DSN n'est arrivé sur l'entrée standard.\n" + usage)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	outcome, err := store.Migrate(ctx, dsn)
	if err != nil {
		return fmt.Errorf("les migrations ont échoué : %w", err)
	}

	if len(outcome.Applied) == 0 {
		fmt.Printf("schéma déjà à jour, version %d\n", outcome.Version)

		return nil
	}

	for _, name := range outcome.Applied {
		fmt.Println("appliquée :", name)
	}

	fmt.Printf("schéma en version %d\n", outcome.Version)

	return nil
}
