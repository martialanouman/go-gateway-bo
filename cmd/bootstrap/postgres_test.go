package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/martialanouman/go-gateway-bo/internal/bddtest"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Ce que `store.Seed` fait est prouvé dans `internal/store`. Ce qui se prouve **ici** est que la
// commande le fait : `start` enchaîne la lecture du DSN, le contrôle de schéma, le seed et le compte
// rendu, et rien n'exerçait cet enchaînement. Trois mutations y survivaient — retirer
// `store.VerifySchema`, intervertir les deux écrivains passés à `report`, ou supprimer l'appel à
// `report` — parce que les cas voisins appellent `report` eux-mêmes plutôt que la commande.
//
// Même contrat qu'ailleurs : aucun skip. Sans base joignable, la suite est rouge.
//
// **Ce que ce `TestMain` coûte, et qui n'est pas gratuit** : les six cas de `main_test.go` — refus
// d'argument, entrée vide, mise en forme du rapport — n'avaient besoin de rien et tournaient sur un
// poste sans Docker. Ils ne le peuvent plus, un `TestMain` valant pour tout le paquet. C'est le prix
// d'exercer la commande pour de bon, et il est assumé ici plutôt que contourné par un `t.Skip` qui
// rendrait vert un paquet n'ayant rien exercé.
var suiteDSN string

func TestMain(m *testing.M) {
	code, err := runSuite(m)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	os.Exit(code)
}

func runSuite(m *testing.M) (int, error) {
	ctx := context.Background()

	dsn, release, err := bddtest.AdminDSN(ctx)
	defer release()

	if err != nil {
		return 0, fmt.Errorf("cette suite exerce la commande contre une vraie base : %w", err)
	}

	suiteDSN = dsn

	return m.Run(), nil
}

// freshDatabase taille une base vierge : aucune migration, donc le schéma est en version 0.
func freshDatabase(ctx context.Context, t *testing.T) string {
	t.Helper()

	name := bddtest.DatabaseName("bootstrap")

	admin, err := pgx.Connect(ctx, suiteDSN)
	if err != nil {
		t.Fatalf("connexion d'administration au PostgreSQL de test : %v", err)
	}

	defer func() { _ = admin.Close(ctx) }()

	// Le nom est un identifiant construit ici, jamais une donnée reçue, et PostgreSQL n'accepte aucun
	// paramètre lié dans un `CREATE DATABASE`.
	if _, err = admin.Exec(ctx, fmt.Sprintf("CREATE DATABASE %s", name)); err != nil {
		t.Fatalf("créer la base de test %s : %v", name, err)
	}

	t.Cleanup(func() { bddtest.DiscardDatabase(suiteDSN, name) })

	parsed, err := url.Parse(suiteDSN)
	if err != nil {
		t.Fatalf("analyser le DSN de la suite : %v", err)
	}

	parsed.Path = "/" + name

	return parsed.String()
}

func migratedDatabase(ctx context.Context, t *testing.T) string {
	t.Helper()

	dsn := freshDatabase(ctx, t)

	if _, err := store.Migrate(ctx, dsn); err != nil {
		t.Fatalf("migrer la base de test : %v", err)
	}

	return dsn
}
