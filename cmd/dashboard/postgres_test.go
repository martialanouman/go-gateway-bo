package main

import (
	"context"
	"fmt"
	"net/url"
	"sync/atomic"

	"github.com/jackc/pgx/v5"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Depuis step-020, le binaire **contrôle la version du schéma avant de lier son port** et refuse de
// servir sur une base en retard. Ces scénarios lancent le déployable : ils exigent donc un
// PostgreSQL, comme la production.
//
// C'est ce que coûte le critère 1 de la DoD, et c'est le bon prix. Le harnais aurait pu donner au
// binaire un environnement qui désarme la garde — un drapeau, une variable — mais un binaire dont la
// garde se lève parce que le test le lui a demandé n'est plus celui qu'on déploie, et la mutation
// « retirer la garde » deviendrait indistinguable de la configuration normale des scénarios.
//
// Rien ne se saute ici non plus : pas de `t.Skip`, pas de `SkipIfProviderIsNotHealthy`. Un skip est
// vert, et une suite verte qui n'a rien exercé est ce que ce dépôt refuse.
//
// L'image suit `docker-compose.yml` et `internal/store` : PostgreSQL **18**, où `uuidv7()` est
// natif — sur une image plus ancienne, les migrations échouent.
const postgresImage = "postgres:18-alpine"

const (
	postgresUser     = "dashboard"
	postgresPassword = "dashboard"
	//nolint:gosec // G101 : identifiants d'un conteneur jetable lié à un port éphémère local.
	postgresAdminDatabase = "dashboard"
)

// suiteDSN désigne la base d'administration du conteneur de la suite ; migratedSuiteDSN désigne une
// base à jour, celle avec laquelle démarrent les scénarios qui n'ont rien à dire du schéma. Toutes
// sont posées par `TestMain` avant tout scénario, et lues seulement ensuite.
var suiteDSN, migratedSuiteDSN string

// suiteSchemaVersion est la version que le binaire embarque, relevée sur ce qu'il vient lui-même
// d'appliquer plutôt qu'écrite en dur : une constante prendrait du retard à la prochaine migration,
// et le scénario affirmerait alors une version que le message ne porte plus.
var suiteSchemaVersion int64

// startPostgres monte le conteneur de la suite et taille la base à jour que la configuration
// complète désigne. Elle rend la fonction qui jette le conteneur.
func startPostgres(ctx context.Context) (func(), error) {
	container, err := postgres.Run(ctx, postgresImage,
		postgres.WithDatabase(postgresAdminDatabase),
		postgres.WithUsername(postgresUser),
		postgres.WithPassword(postgresPassword),
		postgres.BasicWaitStrategies(),
	)
	// Armé avant le contrôle d'erreur : `postgres.Run` rend un conteneur **non nil** même en échec
	// quand il a été créé puis n'a pas démarré, et celui-là resterait à traîner.
	terminate := func() { _ = testcontainers.TerminateContainer(container) }

	if err != nil {
		return terminate, fmt.Errorf("démarrer PostgreSQL de test : %w\n\n"+
			"Ces scénarios lancent le binaire, qui contrôle la version du schéma au démarrage : ils "+
			"exigent un Docker joignable et ne se sautent pas", err)
	}

	// `sslmode=disable` : le conteneur ne présente pas de certificat, et pgx tenterait TLS d'abord.
	suiteDSN, err = container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		return terminate, fmt.Errorf("lire le DSN de PostgreSQL de test : %w", err)
	}

	migratedSuiteDSN, err = migratedDatabase(ctx)
	if err != nil {
		return terminate, err
	}

	// Relevée **ici et nulle part ailleurs**, sur une base déjà migrée. La version précédente
	// l'écrivait depuis `migratedDatabase`, donc aussi depuis un pas de scénario — sans course
	// aujourd'hui, godog exécutant en séquence, mais une écriture non synchronisée qui aurait viré au
	// rouge sous `-race` le jour où quelqu'un pose `Concurrency`.
	if suiteSchemaVersion, err = appliedSchemaVersion(ctx, migratedSuiteDSN); err != nil {
		return terminate, err
	}

	if suiteSchemaVersion == 0 {
		return terminate, fmt.Errorf("les migrations n'ont pas relevé de version : le scénario du " +
			"schéma en retard comparerait à zéro")
	}

	return terminate, nil
}

// appliedSchemaVersion lit la version que la base porte, sans passer par le produit : ce que le
// harnais affirme doit venir d'ailleurs que de ce qu'il contrôle.
func appliedSchemaVersion(ctx context.Context, dsn string) (int64, error) {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return 0, fmt.Errorf("se connecter pour relever la version du schéma : %w", err)
	}

	defer func() { _ = conn.Close(ctx) }()

	var version int64

	if err = conn.QueryRow(ctx,
		"SELECT coalesce(max(version_id), 0) FROM goose_db_version").Scan(&version); err != nil {
		return 0, fmt.Errorf("relever la version du schéma : %w", err)
	}

	return version, nil
}

var databaseCounter atomic.Uint64

// freshDatabase taille une base **vierge** : aucune migration n'y a été jouée, donc son schéma est
// en version 0. C'est le cas de l'installation qu'on a oublié de migrer.
func freshDatabase(ctx context.Context) (string, error) {
	name := fmt.Sprintf("dashboard_test_%d", databaseCounter.Add(1))

	admin, err := pgx.Connect(ctx, suiteDSN)
	if err != nil {
		return "", fmt.Errorf("connexion d'administration au PostgreSQL de test : %w", err)
	}

	defer func() { _ = admin.Close(ctx) }()

	// Le nom est un identifiant construit ici, jamais une donnée reçue, et PostgreSQL n'accepte de
	// toute façon aucun paramètre lié dans un `CREATE DATABASE`.
	if _, err = admin.Exec(ctx, fmt.Sprintf("CREATE DATABASE %s", name)); err != nil {
		return "", fmt.Errorf("créer la base de test %s : %w", name, err)
	}

	return databaseDSN(name)
}

func migratedDatabase(ctx context.Context) (string, error) {
	dsn, err := freshDatabase(ctx)
	if err != nil {
		return "", err
	}

	if _, err = store.Migrate(ctx, dsn); err != nil {
		return "", fmt.Errorf("migrer la base de test : %w", err)
	}

	return dsn, nil
}

// outdatedDatabase taille une base migrée puis lui fait **oublier sa dernière migration** — la table
// de version est exactement ce que le contrôle lit, et les tables restent en place : c'est le cas
// réaliste d'un binaire déployé avant que sa migration ne soit jouée.
func outdatedDatabase(ctx context.Context) (dsn string, remaining int64, err error) {
	dsn, err = migratedDatabase(ctx)
	if err != nil {
		return "", 0, err
	}

	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return "", 0, fmt.Errorf("se connecter à la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(ctx) }()

	var forgotten int64

	// Un `RETURNING` qui ne supprime rien rend `pgx.ErrNoRows`, capté ici : il n'y a pas de garde
	// `forgotten == 0` à écrire en dessous, elle serait inatteignable.
	err = conn.QueryRow(ctx,
		"DELETE FROM goose_db_version WHERE version_id = (SELECT max(version_id) FROM "+
			"goose_db_version) RETURNING version_id").Scan(&forgotten)
	if err != nil {
		return "", 0, fmt.Errorf("faire oublier la dernière migration : %w", err)
	}

	// Lue plutôt que déduite de `forgotten - 1` : rien n'oblige la prochaine migration à s'appeler
	// `00004`, et un scénario qui calculerait deviendrait faux sur un saut de numéro.
	if err = conn.QueryRow(ctx,
		"SELECT coalesce(max(version_id), 0) FROM goose_db_version").Scan(&remaining); err != nil {
		return "", 0, fmt.Errorf("relire la version restante : %w", err)
	}

	return dsn, remaining, nil
}

// databaseDSN rend le DSN de la suite redirigé vers une autre base. Le chemin est réécrit sur l'URL
// analysée plutôt que par une substitution de texte : le mot de passe ou l'hôte pourraient contenir
// le nom de la base, et un `strings.Replace` les abîmerait en silence.
func databaseDSN(database string) (string, error) {
	parsed, err := url.Parse(suiteDSN)
	if err != nil {
		return "", fmt.Errorf("analyser le DSN de la suite : %w", err)
	}

	parsed.Path = "/" + database

	return parsed.String(), nil
}
