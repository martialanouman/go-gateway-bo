package bddtest

import (
	"context"
	"fmt"
	"os"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

// EnvAdminDSN désigne le PostgreSQL que les suites partagent quand l'environnement en fournit un.
//
// Le nom est distinct de `DASHBOARD_DATABASE_URL`, que le binaire lit : les scénarios donnent au
// déployable une base **par scénario**, taillée sur ce serveur-ci. Confondre les deux ferait servir
// le binaire sur la base d'administration de la suite.
const EnvAdminDSN = "DASHBOARD_TEST_DATABASE_URL"

// L'image suit `docker-compose.yml` et les services de la CI : PostgreSQL **18**, où `uuidv7()` est
// natif — `audit_log.id` en a fait son défaut, et les migrations échouent sur plus ancien.
const postgresImage = "postgres:18-alpine"

const (
	postgresUser     = "dashboard"
	postgresPassword = "dashboard"
	//nolint:gosec // G101 : identifiants d'un conteneur jetable lié à un port éphémère local.
	postgresAdminDatabase = "dashboard"
)

// discardTimeout borne le nettoyage d'une base : une suite ne doit pas pendre sur ce qu'elle jette.
const discardTimeout = 10 * time.Second

// AdminDSN rend la base d'administration d'un PostgreSQL de test — celle depuis laquelle une suite
// taille les siennes — et la fonction qui libère ce qu'elle a pris.
//
// **Un serveur pour tout le module quand l'environnement en pose un**, un conteneur par suite sinon.
// C'est l'amortissement que step-007 laissait ouvert avec son déclencheur écrit — « le jour où un
// second paquet a besoin de PostgreSQL » —, franchi depuis longtemps : trois paquets en montaient
// chacun un, et la CI les faisait démarrer de front sur quatre cœurs. Ce n'est **pas** `WithReuse`,
// écarté nommément par DN-3 : rien ne survit ici entre deux exécutions, puisque personne ne réutilise
// un conteneur — c'est un serveur **fourni**, dont la CI recrée le service à chaque job.
//
// L'isolation ne bouge pas : chaque test taille sa base par `CREATE DATABASE` et la jette après lui.
//
// Rien ne se saute : ni `t.Skip`, ni `SkipIfProviderIsNotHealthy`. Sans variable **et** sans Docker,
// la suite est rouge — une suite verte qui n'a rien exercé est ce que ce dépôt refuse.
func AdminDSN(ctx context.Context) (string, func(), error) {
	if dsn := os.Getenv(EnvAdminDSN); dsn != "" {
		return dsn, func() {}, nil
	}

	container, err := postgres.Run(ctx, postgresImage,
		postgres.WithDatabase(postgresAdminDatabase),
		postgres.WithUsername(postgresUser),
		postgres.WithPassword(postgresPassword),
		postgres.BasicWaitStrategies(),
	)
	// Armé avant le contrôle d'erreur : `postgres.Run` rend un conteneur **non nil** même en échec
	// quand il a été créé puis n'a pas démarré, et celui-là resterait à traîner.
	release := func() { _ = testcontainers.TerminateContainer(container) }

	if err != nil {
		return "", release, fmt.Errorf("démarrer PostgreSQL de test : %w\n\n"+
			"Ces suites exercent une vraie base et ne se sautent pas : soit un Docker joignable, soit "+
			"un serveur désigné par %s", err, EnvAdminDSN)
	}

	// `sslmode=disable` : le conteneur ne présente pas de certificat, et pgx tenterait TLS d'abord.
	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		return "", release, fmt.Errorf("lire le DSN de PostgreSQL de test : %w", err)
	}

	return dsn, release, nil
}

// databaseCounter numérote les bases d'une exécution. Il est ici et non dans chaque suite : ce sont
// des processus distincts, et c'est le PID qui les sépare.
var databaseCounter atomic.Uint64

// DatabaseName rend un nom de base propre à **cette exécution**, sous le préfixe de la suite.
//
// Le PID n'est pas décoratif, et c'est le serveur partagé qui l'exige : un conteneur jetable emportait
// ses bases en mourant, donc un compteur reparti de 1 ne rencontrait jamais rien. Sur un serveur qui
// survit, `CREATE DATABASE store_test_1` retrouve celle de l'exécution d'avant et la suite rougit sur
// le harnais — mesuré, six bases restées derrière ont fait échouer la suivante.
func DatabaseName(prefix string) string {
	return fmt.Sprintf("%s_test_%d_%d", prefix, os.Getpid(), databaseCounter.Add(1))
}

// DiscardDatabase jette une base taillée par un cas, sur le serveur que `adminDSN` désigne.
//
// Un conteneur jetable les emportait toutes en mourant. Un serveur fourni par l'environnement, lui,
// les garde : `internal/store` en taille plus de quatre-vingt-dix par exécution, et elles
// s'accumuleraient sur le PostgreSQL d'un poste.
//
// **Son contexte est le sien, et ce n'est pas un détail** : appelée depuis un `t.Cleanup`, elle
// recevrait un `t.Context()` que Go annule **avant** d'exécuter les nettoyages. La connexion
// échouerait alors à tous les coups, et le silence ci-dessous rendrait la panne invisible — mesuré,
// six bases survivaient à une suite verte.
//
// L'échec est muet. Le cas est fini quand cette fonction s'exécute, rien de ce qu'il affirme n'en
// dépend, et une suite qui rougirait ici accuserait le harnais à la place du produit.
func DiscardDatabase(adminDSN, name string) {
	ctx, cancel := context.WithTimeout(context.Background(), discardTimeout)
	defer cancel()

	admin, err := pgx.Connect(ctx, adminDSN)
	if err != nil {
		return
	}

	defer func() { _ = admin.Close(ctx) }()

	// `WITH (FORCE)` ferme les connexions restées ouvertes : sans lui, un pool que le cas n'a pas
	// fermé retiendrait sa base, et la commande attendrait au lieu de rendre la main.
	_, _ = admin.Exec(ctx, fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", name))
}
