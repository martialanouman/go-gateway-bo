package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/database"
)

// undefinedTable est le code que PostgreSQL rend pour une relation absente. C'est ainsi qu'on
// distingue « aucune migration n'a jamais été jouée ici » d'une vraie panne de lecture — sans quoi
// une base injoignable passerait pour une base vierge, et le binaire refuserait de servir en
// nommant une version qu'il n'a pas lue.
const undefinedTable = "42P01"

// OutdatedSchemaError dit qu'on a refusé de servir, et nomme les deux versions.
type OutdatedSchemaError struct {
	// Applied est la version que la base porte. Zéro veut dire qu'aucune migration n'y a été jouée.
	Applied int64
	// Embedded est la version que ce binaire embarque, donc celle que son code suppose.
	Embedded int64
}

// Le message ne dit ni « démarrer » ni « servir » : deux commandes le rendent — le serveur, qui
// refuse de servir, et `bootstrap`, qui refuse de semer. Écrit pour l'une, il aurait décrit de
// travers ce que l'autre venait de faire. Chaque appelant, lui, donne son contexte : `cmd/dashboard`
// le journalise sous « le serveur s'arrête ».
func (e OutdatedSchemaError) Error() string {
	return fmt.Sprintf(
		"le schéma de la base est %s, ce binaire %s : les migrations doivent être jouées d'abord. "+
			"Travailler sur un schéma en retard produirait des échecs de forme inconnue à "+
			"l'exécution, sur des colonnes absentes",
		AppliedVersionPhrase(e.Applied), ExpectedVersionPhrase(e.Embedded))
}

// AppliedVersionPhrase et ExpectedVersionPhrase nomment une version dans le message de refus.
//
// Elles sont exportées **pour être exigées par les tests**, et cette exportation est le correctif
// d'un défaut mesuré : la version précédente des scénarios cherchait le nombre nu dans la sortie du
// process, or celle-ci est du JSON `slog` horodaté — « 0 » et « 2 » sont tous deux dans « 2026 », si
// bien qu'un message vidé de ses deux versions restait vert. Une phrase entière ne se trouve pas par
// accident.
func AppliedVersionPhrase(applied int64) string {
	return fmt.Sprintf("en version %d", applied)
}

func ExpectedVersionPhrase(embedded int64) string {
	return fmt.Sprintf("attend la version %d", embedded)
}

// VerifySchema refuse un schéma en retard sur celui que ce binaire embarque.
//
// La comparaison est `appliquée < embarquée`, jamais une inégalité stricte des deux côtés : le
// produit tourne à ≥2 instances en déploiement roulant, donc une instance en cours de remplacement
// voit le schéma que sa remplaçante vient de poser. Refuser là interdirait tout retour arrière, et
// les migrations de ce dépôt sont additives — un binaire plus ancien ignore une colonne qu'il ne lit
// pas.
//
// Rien n'est écrit ici : voir `appliedSchemaVersion`, dont c'est la raison d'être.
func VerifySchema(ctx context.Context, dsn string) error {
	db, err := openSQL(dsn)
	if err != nil {
		return err
	}

	defer func() { _ = db.Close() }()

	embedded, err := embeddedSchemaVersion(db)
	if err != nil {
		return err
	}

	applied, err := appliedSchemaVersion(ctx, db)
	if err != nil {
		return err
	}

	if applied < embedded {
		return OutdatedSchemaError{Applied: applied, Embedded: embedded}
	}

	return nil
}

// embeddedSchemaVersion rend la version de la dernière migration que ce binaire embarque.
//
// Elle est lue sur **la même liste de sources** que celle qu'applique `Migrate`, et non sur une
// constante tenue à la main : entre « ce que le binaire sait appliquer » et « ce qu'il exige », il
// ne peut alors pas y avoir de dérive.
//
// Le `*sql.DB` n'est là que parce que `goose.NewProvider` refuse un `db` nul. Aucune requête n'est
// émise — `ListSources` lit ce que le provider a chargé depuis le système de fichiers embarqué. Et
// pas de `WithSessionLocker` ici, contrairement à `newMigrationProvider` : rien de ce chemin ne
// prend de verrou, l'y poser suggérerait le contraire.
func embeddedSchemaVersion(db *sql.DB) (int64, error) {
	provider, err := newVersionProvider(db)
	if err != nil {
		return 0, err
	}

	sources := provider.ListSources()
	if len(sources) == 0 {
		return 0, errors.New("ce binaire n'embarque aucune migration : il ne peut rien exiger de la base")
	}

	return sources[len(sources)-1].Version, nil
}

// appliedSchemaVersion rend la version que la base porte, **sans rien y écrire**.
//
// C'est ce « sans rien y écrire » qui dicte l'API employée. `Provider.GetVersions`, `GetDBVersion`
// et `HasPending` passent tous par `initialize`, qui appelle `ensureVersionTable` : `CREATE TABLE
// goose_db_version` puis `INSERT` de la version 0. Un contrôle de démarrage qui pose du DDL sur une
// base qu'il s'apprête à refuser est un effet de bord qu'on n'attend pas d'un contrôle, et il rend
// « base vierge » indiscernable de « base initialisée à zéro » — l'erreur que goose rend alors,
// `errMissingZeroVersion`, n'est pas exportée, donc inatteignable par `errors.Is`.
//
// `database.Store` est l'API publique prévue pour cette lecture, et `goose.DefaultTablename` est
// exactement le nom que `NewProvider` emploie tant qu'on ne passe pas `WithTableName` — ce que ce
// dépôt ne fait nulle part.
func appliedSchemaVersion(ctx context.Context, db *sql.DB) (int64, error) {
	versions, err := database.NewStore(goose.DialectPostgres, goose.DefaultTablename)
	if err != nil {
		return 0, fmt.Errorf("construire le lecteur de version du schéma : %w", err)
	}

	applied, err := versions.GetLatestVersion(ctx, db)

	switch {
	case err == nil:
		return applied, nil
	// La table existe et ne porte aucune version : la base est aussi en retard qu'une base vierge.
	case errors.Is(err, database.ErrVersionNotFound):
		return 0, nil
	case isUndefinedTable(err):
		return 0, nil
	default:
		return 0, fmt.Errorf("lire la version du schéma appliquée : %w", err)
	}
}

func newVersionProvider(db *sql.DB) (*goose.Provider, error) {
	sources, err := migrationSources()
	if err != nil {
		return nil, err
	}

	provider, err := goose.NewProvider(goose.DialectPostgres, db, sources)
	if err != nil {
		return nil, fmt.Errorf("lire les migrations embarquées : %w", err)
	}

	return provider, nil
}

func isUndefinedTable(err error) bool {
	var pgErr *pgconn.PgError

	return errors.As(err, &pgErr) && pgErr.Code == undefinedTable
}
