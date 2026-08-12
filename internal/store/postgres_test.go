package store_test

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Les suites de ce package tournent contre un **PostgreSQL réel**, jeté à la fin. C'est la seule
// façon d'observer ce que ce package produit : des partitions, un verrou de session, un pool de
// connexions. Un double en mémoire ne dirait rien de tout cela.
//
// Rien ici ne se saute : ni `t.Skip()`, ni tag exclu, ni build tag. testcontainers propose bien
// `SkipIfProviderIsNotHealthy`, et il n'est pas appelé — un skip est vert, et une suite verte qui
// n'a rien exercé est exactement ce que le dépôt refuse. Un fournisseur qui ne rend pas de conteneur
// fait **rouge** : vérifié le 02/08/2026 en pointant l'image sur un tag inexistant, la suite sort en
// `FAIL` sur le message ci-dessous, sans qu'aucun test ne s'exécute.
//
// Mesuré le même jour, et contraire à ce qu'on suppose spontanément : **`DOCKER_HOST` ne suffit pas
// à détourner testcontainers**. Posé sur une socket inexistante, il a été ignoré et la suite a
// tourné contre le démon du contexte Docker courant (`orbstack`). C'est ce contexte qui décide ici,
// pas la variable — donc rien à exporter sur un poste dont le contexte est déjà bon, runners
// `ubuntu-latest` compris.
//
// L'image suit `docker-compose.yml` : PostgreSQL **18**, et pas seulement pour rester cohérent —
// `audit_log.id` a pour défaut `uuidv7()`, fonction native introduite en 18. Sur une image plus
// ancienne, les migrations échoueraient.
const postgresImage = "postgres:18-alpine"

const (
	postgresUser     = "dashboard"
	postgresPassword = "dashboard"
	//nolint:gosec // G101 : identifiants d'un conteneur jetable lié à un port éphémère local.
	postgresAdminDatabase = "dashboard"
)

// suiteDSN désigne la base d'administration du conteneur de la suite — celle depuis laquelle chaque
// test taille la sienne. Elle est posée par TestMain avant tout test, et lue seulement ensuite.
var suiteDSN string

// **Un conteneur par suite** (DN-8), pas un par test : le démarrage coûte quelques secondes, la
// création d'une base en coûte quelques millisecondes. L'amortissement *entre suites*
// (`Snapshot`/`Restore`) appartient à step-007 et n'est pas ici.
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
	// Le `defer` est armé avant le contrôle d'erreur : `postgres.Run` rend un conteneur **non nil**
	// même en échec quand il a été créé puis n'a pas démarré, et celui-là resterait à traîner.
	defer func() { _ = testcontainers.TerminateContainer(container) }()

	if err != nil {
		return 0, fmt.Errorf("démarrer PostgreSQL de test : %w\n\n"+
			"Cette suite exige un Docker joignable — elle ne se saute pas. Sur un poste : lancer "+
			"Docker ou OrbStack, puis vérifier que `docker context show` désigne bien ce démon", err)
	}

	// `sslmode=disable` : le conteneur ne présente pas de certificat, et pgx tenterait TLS d'abord.
	suiteDSN, err = container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		return 0, fmt.Errorf("lire le DSN de PostgreSQL de test : %w", err)
	}

	return m.Run(), nil
}

// databaseCounter nomme des bases distinctes. Le compteur est atomique parce que les tests de ce
// package peuvent tourner en parallèle, et que deux `CREATE DATABASE` du même nom se marcheraient
// dessus sous `-race` comme sans lui.
var databaseCounter atomic.Uint64

// freshDatabase taille une base **vierge** dans le conteneur de la suite et rend son DSN.
//
// Une base par test plutôt qu'un schéma remis à zéro : les migrations créent des types, des
// fonctions et des partitions, et « vierge » doit vouloir dire ce qu'il dit — sinon le scénario
// « base vierge » observerait les restes du test précédent.
func freshDatabase(ctx context.Context, t *testing.T) string {
	t.Helper()

	dsn, err := createDatabase(ctx)
	require.NoError(t, err)

	return dsn
}

// migratedPool taille une base neuve, la migre, et rend un pool avec le DSN qui a servi à l'ouvrir —
// les cas en ont besoin pour vieillir une ligne, désactiver un compte ou relire une colonne.
//
// Il est ici et non recopié dans chaque suite : `loginsOn`, `sessionsOn` et `mfaOn` n'étaient que ces
// quatre appels et un constructeur. À deux copies c'était une redite, à trois c'était l'endroit où
// une divergence se serait installée sans se voir.
func migratedPool(t *testing.T) (*pgxpool.Pool, string) {
	t.Helper()

	dsn := freshDatabase(t.Context(), t)

	_, err := store.Migrate(t.Context(), dsn)
	require.NoError(t, err)

	pool, err := store.NewPool(t.Context(), dsn)
	require.NoError(t, err)

	return pool, dsn
}

// queryOn relit une valeur unique dans la base, pour les cas qui doivent confronter ce que le store
// rend à ce que la colonne porte vraiment.
func queryOn(t *testing.T, dsn, query string, into any, args ...any) {
	t.Helper()

	conn, err := pgx.Connect(t.Context(), dsn)
	require.NoError(t, err)

	defer func() { _ = conn.Close(context.WithoutCancel(t.Context())) }()

	require.NoError(t, conn.QueryRow(t.Context(), query, args...).Scan(into))
}

// createDatabase est la forme que les steps `godog` appellent : elles n'ont pas de `*testing.T` sous
// la main, seulement un `context.Context` et une erreur à rendre.
func createDatabase(ctx context.Context) (string, error) {
	name := fmt.Sprintf("store_test_%d", databaseCounter.Add(1))

	admin, err := pgx.Connect(ctx, suiteDSN)
	if err != nil {
		return "", fmt.Errorf("connexion d'administration au PostgreSQL de test : %w", err)
	}

	defer func() { _ = admin.Close(ctx) }()

	// Le nom est un identifiant construit ici, jamais une donnée reçue : `%s` est sans risque, et
	// PostgreSQL n'accepte de toute façon aucun paramètre lié dans un `CREATE DATABASE`.
	if _, err = admin.Exec(ctx, fmt.Sprintf("CREATE DATABASE %s", name)); err != nil {
		return "", fmt.Errorf("créer la base de test %s : %w", name, err)
	}

	return databaseDSN(name)
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
