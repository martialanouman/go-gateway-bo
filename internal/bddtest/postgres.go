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
)

// EnvAdminDSN désigne le PostgreSQL que les suites partagent quand l'environnement en fournit un.
//
// Le nom est distinct de `DASHBOARD_DATABASE_URL`, que le binaire lit : les scénarios donnent au
// déployable une base **par scénario**, taillée sur ce serveur-ci. Confondre les deux ferait servir
// le binaire sur la base d'administration de la suite.
const EnvAdminDSN = "DASHBOARD_TEST_DATABASE_URL"

// discardTimeout borne le nettoyage d'ouverture. Deux minutes plutôt que trente secondes, mesuré
// plutôt que choisi : jeter cent quatre-vingt-quinze bases en prend douze quand la suite est seule,
// et davantage quand les trois paquets à base démarrent ensemble sous `go test ./...`. Rien ne pend
// ici — les bases visées n'appartiennent qu'à des processus finis.
const discardTimeout = 2 * time.Minute

// SharedAdminDSN rend le PostgreSQL que l'environnement désigne, et `false` quand il n'en désigne
// aucun — à l'appelant, alors, de monter le sien.
//
// **Un serveur pour tout le module quand la variable est posée.** C'est l'amortissement que step-007
// laissait ouvert avec son déclencheur écrit — « le jour où un second paquet a besoin de
// PostgreSQL » —, franchi depuis longtemps : trois paquets montaient chacun leur conteneur, et la CI
// les faisait démarrer de front sur quatre cœurs. Ce n'est **pas** `WithReuse`, écarté nommément par
// DN-3 : rien ne survit entre deux exécutions, puisque personne ne réutilise un conteneur.
//
// L'isolation ne bouge pas : chaque test taille sa base par `CREATE DATABASE`.
//
// **Le repli reste chez l'appelant, dans son `_test.go`, et ce n'est pas une commodité** : mesuré le
// 09/09/2026, monter le conteneur ici a fait rougir `make vuln-go` sur deux avis de
// `golang.org/x/crypto/ssh`, atteint par `postgres.Run`. `govulncheck` analyse le produit et ignore
// les fichiers de test : y faire entrer le harnais Docker, c'est faire dépendre les portes du
// produit des dépendances de testcontainers. La garde d'imports de ce paquet dit déjà que le harnais
// ne doit pas franchir cette frontière.
//
// Rien ne se saute nulle part : sans variable **et** sans Docker, la suite est rouge.
func SharedAdminDSN() (string, bool) {
	//nolint:forbidigo // Ce n'est pas une configuration du produit mais la désignation du PostgreSQL
	// de test, que la CI pose sur le job et qu'un poste pose devant `make test-go`. L'exemption est
	// nommée ici plutôt que posée sur le fichier, comme le veut `.golangci.yml`.
	dsn := os.Getenv(EnvAdminDSN)

	return dsn, dsn != ""
}

// reachTimeout borne le contrôle d'ouverture. Trente secondes laissent le temps à un `docker compose
// up` lancé dans la foulée d'achever son démarrage, sans transformer une absence en attente.
const reachTimeout = 30 * time.Second

// RequireReachable rend une erreur quand le serveur désigné ne répond pas, **avant** que la suite ne
// s'en serve.
//
// Elle existe pour un mode d'échec que step-032 a créé et qu'elle a rencontré : le serveur du
// `docker compose` a disparu sous une suite en cours, et les trois paquets ont **attendu plus de deux
// heures** au lieu de rougir. Un conteneur absent, lui, faisait rouge en quelques secondes — la
// variable avait donc troqué un refus lisible contre une suspension muette.
//
// Ce que `go test` arme ne suffit pas ici : sa borne interne ne l'est qu'à partir de `m.Run()`, et
// tout ceci se passe avant, dans `TestMain`.
func RequireReachable(ctx context.Context, dsn string) error {
	ctx, cancel := context.WithTimeout(ctx, reachTimeout)
	defer cancel()

	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return fmt.Errorf("le PostgreSQL de test ne répond pas : %w\n\n"+
			"Il est désigné par %s. Sur un poste : `docker compose up -d postgres`, ou retirer la "+
			"variable pour que la suite monte son propre conteneur", err, EnvAdminDSN)
	}

	return conn.Close(ctx)
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

	// Toutes les bases, et le tri se fait en Go. Un `LIKE` aurait été plus court et plus faux : le
	// caractère `_` y est un **joker**, si bien que `store_test_%` retenait aussi `storeXtestY_1`.
	// Mesuré en revue le 11/09/2026, sur une base étrangère créée pour l'occasion : elle a été
	// supprimée.
	rows, err := admin.Query(ctx, "SELECT datname FROM pg_database")
	if err != nil {
		return
	}

	existing, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return
	}

	var (
		failed   int
		firstErr error
	)

	for _, database := range existing {
		if !Discardable(database, prefix) {
			continue
		}

		// `WITH (FORCE)` ferme ce qui traînerait encore : une connexion oubliée par un run tué au
		// clavier retiendrait sa base, et la commande attendrait au lieu de rendre la main.
		if _, err = admin.Exec(ctx,
			fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", database)); err != nil {
			failed++

			// La **première**, et pas la dernière : une itération réussie après un échec remettrait
			// `err` à nil, et le message annoncerait alors une panne sans cause.
			if firstErr == nil {
				firstErr = err
			}
		}
	}

	// **Il parle sans faire rougir.** La suite qui commence n'en dépend pas, mais un nettoyage muet
	// est ce qui a fait croire trois fois de suite qu'il avait eu lieu.
	if failed > 0 {
		fmt.Fprintf(os.Stderr, "harnais : %d base(s) %s_test_* n'ont pas été jetées : %v\n",
			failed, prefix, firstErr)
	}
}

// Discardable dit si cette base a été taillée par [DatabaseName] sous ce préfixe, **et** si le
// processus qui l'a taillée est fini.
//
// C'est elle qui décide de ce qu'on détruit, donc elle est **fermée par défaut** : tout ce qu'elle ne
// reconnaît pas est gardé. La version qu'une revue a corrigée le 11/09/2026 faisait l'inverse sans le
// dire — son commentaire promettait qu'un nom d'une autre forme n'était « jamais jeté », quand un PID
// illisible rendait zéro, que nul processus ne porte, donc « fini », donc jetable. Une base étrangère
// créée pour la mesure a bien été supprimée.
func Discardable(database, prefix string) bool {
	suffix, ours := strings.CutPrefix(database, prefix+"_test_")
	if !ours {
		return false
	}

	pid, _, wellFormed := strings.Cut(suffix, "_")
	if !wellFormed {
		return false
	}

	owner, err := strconv.Atoi(pid)
	if err != nil || owner <= 0 {
		return false
	}

	return !processAlive(owner)
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
