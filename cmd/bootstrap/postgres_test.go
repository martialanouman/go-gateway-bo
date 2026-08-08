package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Ce que `store.Seed` fait est prouvé dans `internal/store`. Ce qui se prouve **ici** est que la
// commande le fait : `start` enchaîne la lecture du DSN, le contrôle de schéma, le seed et le compte
// rendu, et rien n'exerçait cet enchaînement. Trois mutations y survivaient — retirer
// `store.VerifySchema`, intervertir les deux écrivains passés à `report`, ou supprimer l'appel à
// `report` — parce que les cas voisins appellent `report` eux-mêmes plutôt que la commande.
//
// Même contrat qu'ailleurs : aucun skip. Un Docker absent fait rouge.
//
// **Ce que ce `TestMain` coûte, et qui n'est pas gratuit** : les six cas de `main_test.go` — refus
// d'argument, entrée vide, mise en forme du rapport — n'avaient besoin de rien et tournaient sur un
// poste sans Docker. Ils ne le peuvent plus, un `TestMain` valant pour tout le paquet. C'est le prix
// d'exercer la commande pour de bon, et il est assumé ici plutôt que contourné par un `t.Skip` qui
// rendrait vert un paquet n'ayant rien exercé.
const postgresImage = "postgres:18-alpine"

const (
	postgresUser     = "dashboard"
	postgresPassword = "dashboard"
	//nolint:gosec // G101 : identifiants d'un conteneur jetable lié à un port éphémère local.
	postgresAdminDatabase = "dashboard"
)

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

	container, err := postgres.Run(ctx, postgresImage,
		postgres.WithDatabase(postgresAdminDatabase),
		postgres.WithUsername(postgresUser),
		postgres.WithPassword(postgresPassword),
		postgres.BasicWaitStrategies(),
	)
	// Armé avant le contrôle d'erreur : `postgres.Run` rend un conteneur non nil même en échec quand
	// il a été créé puis n'a pas démarré.
	defer func() { _ = testcontainers.TerminateContainer(container) }()

	if err != nil {
		return 0, fmt.Errorf("démarrer PostgreSQL de test : %w\n\n"+
			"Cette suite exerce la commande contre une vraie base — elle ne se saute pas", err)
	}

	// `sslmode=disable` : le conteneur ne présente pas de certificat, et pgx tenterait TLS d'abord.
	suiteDSN, err = container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		return 0, fmt.Errorf("lire le DSN de PostgreSQL de test : %w", err)
	}

	return m.Run(), nil
}

var databaseCounter atomic.Uint64

// freshDatabase taille une base vierge : aucune migration, donc le schéma est en version 0.
func freshDatabase(ctx context.Context, t *testing.T) string {
	t.Helper()

	name := fmt.Sprintf("bootstrap_test_%d", databaseCounter.Add(1))

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
