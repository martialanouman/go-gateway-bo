package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"path"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

// Les migrations sont **embarquées**, pas lues sur le disque : le dépôt livre un binaire unique, et
// un répertoire de `.sql` posé à côté de lui ne serait pas déployé avec lui.
//
//go:embed migrations/*.sql
var migrationsFS embed.FS

const migrationsDir = "migrations"

// Bornes de l'attente du verrou de migration : 60 tentatives espacées de 5 s, soit 5 min.
//
// Elles reprennent les défauts de goose et sont écrites quand même. Le produit tourne à ≥2
// instances, donc deux d'entre elles peuvent lancer les migrations en même temps ; ce que ces deux
// nombres décident est le moment où la seconde **abandonne en le disant**, plutôt que d'attendre
// indéfiniment. Un défaut de bibliothèque changerait sans nous prévenir.
const (
	migrationLockRetryPeriodSeconds uint64 = 5
	migrationLockRetryAttempts      uint64 = 60
)

// MigrationOutcome décrit ce qu'une exécution des migrations a changé.
type MigrationOutcome struct {
	// Applied porte le nom des migrations appliquées par cette exécution, dans l'ordre. Il est vide
	// quand le schéma était déjà à jour — c'est ce qui rend la rejouabilité observable.
	Applied []string
	// Version est la version du schéma atteinte.
	Version int64
}

// Migrate applique les migrations en attente sur la base désignée par dsn.
//
// Le DSN est analysé avant toute connexion : un DSN malformé échoue ici, pas à la première requête.
func Migrate(ctx context.Context, dsn string) (MigrationOutcome, error) {
	db, err := openSQL(dsn)
	if err != nil {
		return MigrationOutcome{}, err
	}

	provider, err := newMigrationProvider(db)
	if err != nil {
		return MigrationOutcome{}, errors.Join(err, db.Close())
	}
	// Provider.Close ferme le *sql.DB qui lui a été fourni.
	defer func() { _ = provider.Close() }()

	results, err := provider.Up(ctx)
	if err != nil {
		return MigrationOutcome{}, fmt.Errorf("appliquer les migrations : %w", err)
	}

	applied := make([]string, 0, len(results))
	for _, result := range results {
		applied = append(applied, path.Base(result.Source.Path))
	}

	version, err := provider.GetDBVersion(ctx)
	if err != nil {
		return MigrationOutcome{}, fmt.Errorf("lire la version du schéma : %w", err)
	}

	return MigrationOutcome{Applied: applied, Version: version}, nil
}

// openSQL ouvre un `*sql.DB` sur pgx. goose comme `database/sql` travaillent sur cette interface, et
// non sur un `pgxpool` : le pool applicatif est un objet distinct, avec son propre cycle de vie.
func openSQL(dsn string) (*sql.DB, error) {
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		// L'erreur de pgx n'est **pas** propagée : elle recopie le DSN, et sa rédaction n'est pas
		// hermétique. Mesuré sur v5.10.0 — ses deux expressions rationnelles (`pgconn/errors.go`)
		// masquent `postgres://u:xxxxx@…` et `password=xxxxx`, mais laissent passer
		// `password = 'secret'` avec espaces, une forme que PostgreSQL accepte. Cette erreur
		// remonte jusqu'à `cmd/migrate`, qui l'imprime sur stderr — donc dans les journaux de CI.
		//
		// Ce qu'on perd — la raison exacte du refus — se retrouve au démarrage du serveur, où
		// `internal/config` valide le même DSN et fait le même choix.
		return nil, errors.New(
			"DSN PostgreSQL invalide ; la valeur n'est pas citée, elle porte le mot de passe de la base")
	}

	return stdlib.OpenDB(*config), nil
}

func newMigrationProvider(db *sql.DB) (*goose.Provider, error) {
	sources, err := fs.Sub(migrationsFS, migrationsDir)
	if err != nil {
		return nil, fmt.Errorf("lire les migrations embarquées : %w", err)
	}

	// goose ne verrouille rien par défaut — sa documentation le dit mot pour mot, « If
	// WithSessionLocker is not called, locking is disabled ». Deux instances qui démarrent ensemble
	// joueraient alors la même migration en parallèle.
	locker, err := lock.NewPostgresSessionLocker(
		lock.WithLockTimeout(migrationLockRetryPeriodSeconds, migrationLockRetryAttempts),
	)
	if err != nil {
		return nil, fmt.Errorf("construire le verrou de migration : %w", err)
	}

	provider, err := goose.NewProvider(goose.DialectPostgres, db, sources, goose.WithSessionLocker(locker))
	if err != nil {
		return nil, fmt.Errorf("construire le lecteur de migrations : %w", err)
	}

	return provider, nil
}
