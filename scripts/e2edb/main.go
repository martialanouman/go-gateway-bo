// Command e2edb remet à neuf la base des parcours Playwright : supprimée si elle existe, recréée vide.
// `make e2e` la migre et y sème le compte propriétaire ensuite.
//
// Neuve à chaque passage, parce que le parcours se connecte : les sessions et les compteurs de force
// brute d'un passage précédent ne doivent pas décider du suivant. Le DSN d'administration arrive sur
// l'entrée standard, pour la raison de `cmd/migrate` : `ps aux` affiche les arguments.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func main() {
	if err := run(os.Stdin); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(in io.Reader) error {
	read, err := io.ReadAll(in)
	if err != nil {
		return fmt.Errorf("lire le DSN sur l'entrée standard : %w", err)
	}

	dsn := strings.TrimSpace(string(read))
	if dsn == "" {
		return errors.New("aucun DSN n'est arrivé sur l'entrée standard")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return fmt.Errorf("joindre PostgreSQL : %w", err)
	}
	defer func() { _ = conn.Close(ctx) }()

	for _, statement := range []string{
		"DROP DATABASE IF EXISTS dashboard_e2e WITH (FORCE)",
		"CREATE DATABASE dashboard_e2e",
	} {
		if _, err = conn.Exec(ctx, statement); err != nil {
			return fmt.Errorf("%s : %w", statement, err)
		}
	}

	return nil
}
