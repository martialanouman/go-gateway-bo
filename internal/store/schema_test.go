package store_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Ce que cette suite tient est la garde de démarrage : le binaire refuse de servir sur un schéma en
// retard sur celui qu'il embarque. Servir quand même produirait des échecs de forme inconnue à
// l'exécution, sur des colonnes absentes — c'est-à-dire au premier écran, en production.
//
// La forme des cas est le **verdict observé**, jamais l'inventaire d'une table de version : ce qu'on
// veut savoir est qu'un démarrage est refusé ou accepté, pas qu'une ligne de catalogue existe.

func TestUnSchemaAJourLaisseDemarrer(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	dsn := migratedDatabaseDSN(ctx, t)

	assert.NoError(t, store.VerifySchema(ctx, dsn),
		"le binaire refuse de servir sur le schéma qu'il embarque lui-même")
}

func TestUnSchemaEnRetardFaitRefuser(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	dsn := migratedDatabaseDSN(ctx, t)

	// La dernière migration appliquée est oubliée de la table de version — c'est exactement le levier
	// que le contrôle lit, et le cas réaliste d'un binaire déployé avant que sa migration ne soit
	// jouée. Les tables, elles, restent en place : ce n'est pas leur présence qui décide.
	embedded, remaining := deleteLatestAppliedVersion(ctx, t, dsn)

	err := store.VerifySchema(ctx, dsn)
	require.Error(t, err, "le binaire a démarré sur un schéma en retard")

	var outdated store.OutdatedSchemaError

	require.ErrorAs(t, err, &outdated)
	assert.Equal(t, remaining, outdated.Applied)
	assert.Equal(t, embedded, outdated.Embedded)

	// L'exploitant qui lit ce message doit savoir quoi jouer, donc les deux nombres y sont. Les
	// chercher dans le texte plutôt que dans la structure : c'est le message qui atterrit dans les
	// journaux, et une structure bien remplie derrière un message muet ne sert personne.
	assert.Contains(t, err.Error(), store.AppliedVersionPhrase(remaining))
	assert.Contains(t, err.Error(), store.ExpectedVersionPhrase(embedded))
}

// Le cas de l'installation qu'on a oublié de migrer. Il porte en plus l'assertion qui compte le
// plus de cette suite : **le contrôle n'écrit rien**.
//
// L'API évidente de goose — `Provider.GetVersions`, `GetDBVersion`, `HasPending` — passe par
// `ensureVersionTable`, qui crée `goose_db_version` et y insère la version 0. Un contrôle de
// démarrage qui pose du DDL sur la base qu'il vient de refuser est un effet de bord qu'on n'attend
// pas, et il rend ce cas-ci indiscernable d'une base déjà initialisée à zéro.
func TestUneBaseSansAucuneMigrationFaitRefuserSansRienEcrire(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	dsn := freshDatabase(ctx, t)

	err := store.VerifySchema(ctx, dsn)
	require.Error(t, err, "le binaire a démarré sur une base qu'aucune migration n'a touchée")

	var outdated store.OutdatedSchemaError

	require.ErrorAs(t, err, &outdated)
	assert.Zero(t, outdated.Applied, "une base vierge est en version 0")
	assert.Positive(t, outdated.Embedded)

	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	var versionTableExists bool

	require.NoError(t, conn.QueryRow(ctx,
		"SELECT to_regclass('public.goose_db_version') IS NOT NULL").Scan(&versionTableExists))
	assert.False(t, versionTableExists,
		"le contrôle de version a créé la table de version sur une base qu'il refuse : un contrôle "+
			"n'écrit pas")
}

// Un schéma **en avance** est accepté, et c'est un choix (DN-6). Le produit tourne à ≥2 instances en
// déploiement roulant : pendant la bascule, l'ancienne version tourne sur le schéma que la nouvelle
// vient de poser. Refuser là interdirait tout retour arrière, alors que les migrations sont
// additives — un binaire plus ancien ignore une colonne qu'il ne lit pas.
func TestUnSchemaEnAvanceLaisseDemarrer(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	dsn := migratedDatabaseDSN(ctx, t)

	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	_, err = conn.Exec(ctx,
		"INSERT INTO goose_db_version (version_id, is_applied) VALUES ((SELECT max(version_id) + 1 "+
			"FROM goose_db_version), true)")
	require.NoError(t, err)

	assert.NoError(t, store.VerifySchema(ctx, dsn),
		"une instance en cours de remplacement refuse de servir sur le schéma que sa remplaçante "+
			"vient de poser")
}

// Le DSN porte le mot de passe de la base, et cette erreur remonte jusqu'aux journaux de démarrage.
//
// La forme `password = '…'` avec espaces est choisie exprès : c'est celle que la rédaction de pgconn
// **laisse passer** (mesurée en step-005, ses deux expressions rationnelles sont ancrées sur
// `password='…'` et `password=…`). Écrit en URL, ce test resterait vert même si l'erreur de la
// bibliothèque était propagée telle quelle — il aurait alors prouvé le travail de pgx, pas le nôtre.
func TestUnDSNIllisibleNeRecopieJamaisLeMotDePasse(t *testing.T) {
	t.Parallel()

	const password = "tr3s-secret"

	err := store.VerifySchema(t.Context(), "password = '"+password+"' host=localhost sslmode=zzz")

	require.Error(t, err)
	assert.NotContains(t, err.Error(), password)
}

// Le cas que step-005 (DN-7) léguait à la première step qui lirait la base : **DSN bien formé, base
// injoignable**. Il n'était couvert par rien, alors que `configuration.feature` renvoyait déjà ici.
//
// Ce qu'il tient : le refus n'est pas confondu avec « schéma en retard ». Annoncer « version 0 »
// pour une base qu'on n'a pas jointe enverrait l'exploitant jouer des migrations qui sont peut-être
// déjà là, sur une base qui ne répond pas.
func TestUneBaseInjoignableNEstPasPriseEnLenteurPourUnSchemaEnRetard(t *testing.T) {
	t.Parallel()

	// Le port 1 n'écoute nulle part et refuse immédiatement, là où une adresse routée mais muette
	// ferait attendre ce test aussi longtemps que la borne de connexion.
	err := store.VerifySchema(t.Context(),
		"postgres://dashboard:dashboard@127.0.0.1:1/dashboard?sslmode=disable")

	require.Error(t, err, "une base injoignable a laissé le binaire démarrer")

	var outdated store.OutdatedSchemaError

	assert.NotErrorAs(t, err, &outdated,
		"une base injoignable est rapportée comme un schéma en retard : l'exploitant irait jouer des "+
			"migrations sur une base qui ne répond pas")
	assert.NotContains(t, err.Error(), "dashboard:dashboard", "le DSN est reparti dans l'erreur")
}

// deleteLatestAppliedVersion retire de la table de version la dernière migration appliquée. Elle
// rend la version qui y figurait — celle que le binaire embarque — puis celle qui reste.
//
// La seconde est lue plutôt que déduite : les numéros de migration se suivent aujourd'hui, mais rien
// n'oblige la prochaine à s'appeler `00004`, et un test qui calculerait `embarquée - 1` deviendrait
// faux le jour d'un saut de numéro, sans que le code qu'il garde ait changé.
func deleteLatestAppliedVersion(ctx context.Context, t *testing.T, dsn string) (deleted, remaining int64) {
	t.Helper()

	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)

	t.Cleanup(func() { _ = conn.Close(context.WithoutCancel(ctx)) })

	require.NoError(t, conn.QueryRow(ctx,
		"DELETE FROM goose_db_version WHERE version_id = (SELECT max(version_id) FROM "+
			"goose_db_version) RETURNING version_id").Scan(&deleted))
	require.Positive(t, deleted, "la base n'avait aucune migration à oublier")

	require.NoError(t, conn.QueryRow(ctx,
		"SELECT coalesce(max(version_id), 0) FROM goose_db_version").Scan(&remaining))
	require.Less(t, remaining, deleted, "la table de version n'a rien perdu")

	return deleted, remaining
}
