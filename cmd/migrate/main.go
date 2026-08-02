// Command migrate applique les migrations du schéma propre au BFF sur la base passée en argument.
//
// Le DSN arrive en **argument** et non par l'environnement : `internal/config` est le seul package
// du dépôt qui lit l'environnement (§1.8), et `make migrate` — qui, lui, n'est pas du Go — le lit
// puis le transmet ici.
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
	"os"
	"os/signal"
	"syscall"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

func main() {
	// os.Exit reste seul dans main : appelé depuis start, il court-circuiterait son `defer`.
	if err := start(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func start(args []string) error {
	if len(args) != 1 {
		return errors.New("usage : migrate <dsn>")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	outcome, err := store.Migrate(ctx, args[0])
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
