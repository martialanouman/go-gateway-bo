package bddtest

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
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

// discardTimeout borne le nettoyage d'ouverture. Deux minutes plutôt que trente secondes, mesuré
// plutôt que choisi : jeter cent quatre-vingt-quinze bases en prend douze quand la suite est seule,
// et davantage quand les trois paquets à base démarrent ensemble sous `go test ./...`. Rien ne pend
// ici — les bases visées n'appartiennent qu'à des processus finis.
const discardTimeout = 2 * time.Minute

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

// DatabaseName rend un nom de base propre à **cette exécution**, sous le préfixe de la suite.
//
// Le PID n'est pas décoratif, et le serveur partagé lui donne deux emplois. Il évite d'abord une
// collision : un conteneur jetable emportait ses bases en mourant, donc un compteur reparti de 1 ne
// rencontrait jamais rien, là où sur un serveur qui survit `CREATE DATABASE store_test_1` retrouve
// celle d'avant — mesuré, six bases restées derrière ont fait échouer la suite suivante. Il dit
// ensuite à `DiscardStaleDatabases` quelles bases appartiennent à un run **fini**.
func DatabaseName(prefix string) string {
	return fmt.Sprintf("%s_test_%d_%d", prefix, os.Getpid(), databaseCounter.Add(1))
}

var databaseCounter atomic.Uint64

// DiscardStaleDatabases jette, **au démarrage** d'une suite, les bases que des exécutions finies ont
// laissées sous ce préfixe. Elle s'appelle juste après [AdminDSN].
//
// Un conteneur jetable emportait tout en mourant ; un serveur fourni par l'environnement, lui, garde
// ce qu'on y taille — `internal/store` en produit plus de quatre-vingt-dix par exécution.
//
// **Au démarrage et non à la fin**, ce qui est le contraire de l'intuition et vient d'une mesure :
// à la fin, les pools que les cas n'ont pas fermés reconnectent aussitôt après le `WITH (FORCE)` et
// retiennent leur base. Quatre-vingt-dix-neuf suppressions échouaient ainsi en ajoutant vingt-quatre
// secondes à un paquet qui en dure seize. Au démarrage, plus aucun processus ne les tient.
//
// Le PID protège un run concurrent : une base dont le processus vit encore n'est pas à nous.
//
// L'échec ne fait pas rougir — la suite qui commence n'en dépend pas, et l'exécution suivante
// réessaiera.
func DiscardStaleDatabases(ctx context.Context, adminDSN, prefix string) {
	ctx, cancel := context.WithTimeout(ctx, discardTimeout)
	defer cancel()

	admin, err := pgx.Connect(ctx, adminDSN)
	if err != nil {
		return
	}

	defer func() { _ = admin.Close(ctx) }()

	rows, err := admin.Query(ctx,
		"SELECT datname FROM pg_database WHERE datname LIKE $1", prefix+"_test_%")
	if err != nil {
		return
	}

	stale, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return
	}

	var failed int

	for _, database := range stale {
		if processAlive(ownerPID(database)) {
			continue
		}

		// `WITH (FORCE)` ferme ce qui traînerait encore : une connexion oubliée par un run tué au
		// clavier retiendrait sa base, et la commande attendrait au lieu de rendre la main.
		if _, err = admin.Exec(ctx,
			fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", database)); err != nil {
			failed++
		}
	}

	// **Il parle sans faire rougir.** La suite qui commence n'en dépend pas, mais un nettoyage muet
	// est ce qui a fait croire trois fois de suite qu'il avait eu lieu.
	if failed > 0 {
		fmt.Fprintf(os.Stderr, "harnais : %d base(s) %s_test_* n'ont pas été jetées : %v\n",
			failed, prefix, err)
	}
}

// ownerPID relit le PID écrit par [DatabaseName]. Zéro pour un nom d'une autre forme — jamais jeté,
// puisque le PID 0 n'existe pas.
func ownerPID(database string) int {
	parts := strings.Split(database, "_")
	if len(parts) < 4 {
		return 0
	}

	pid, err := strconv.Atoi(parts[len(parts)-2])
	if err != nil {
		return 0
	}

	return pid
}

// processAlive dit si un processus de ce PID tourne encore. Le signal 0 ne fait que poser la
// question. Un PID recyclé rend un faux positif : la base survit une exécution de plus, ce qui ne
// coûte rien — l'inverse casserait un run en cours.
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}

	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}

	return process.Signal(syscall.Signal(0)) == nil
}
