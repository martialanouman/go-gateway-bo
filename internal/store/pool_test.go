package store_test

import (
	"context"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Le pool est **paresseux** (DN-5) : le DSN est exigé et validé au démarrage, mais rien ne se
// connecte tant qu'aucune route ne le demande — et aucune ne le demande encore.
//
// Ce que ce test observe n'est pas `Stat().TotalConns()`, qui est le compte que le pool tient de
// lui-même, mais les backends que **PostgreSQL** voit, lus depuis une connexion de contrôle. Un pool
// qui se remplirait en arrière-plan le ferait de toute façon après le retour de `NewPool` :
// l'observation est donc tenue sur une fenêtre, pas prise à un instant.
func TestNewPoolComposesNoConnectionBeforeSomethingAsksForOne(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	dsn := freshDatabase(ctx, t)

	pool, err := store.NewPool(ctx, dsn)
	require.NoError(t, err, "construire le pool")

	defer pool.Close()

	assert.Neverf(t, func() bool { return backendCount(ctx, t, dsn) > 0 },
		500*time.Millisecond, 50*time.Millisecond,
		"le pool a composé une connexion sans que rien ne la demande : le binaire ne démarrerait plus "+
			"sans PostgreSQL, ce que `make dev` et le job qui lance le déployable ne fournissent pas")

	// L'autre moitié de la paresse : un pool qui ne se connecte **jamais** passerait le contrôle
	// ci-dessus sans rien valoir. Ici, quelque chose demande — et la connexion arrive.
	conn, err := pool.Acquire(ctx)
	require.NoError(t, err, "acquérir une connexion")

	var alive int

	require.NoError(t, conn.QueryRow(ctx, "SELECT 1").Scan(&alive), "interroger la base par le pool")
	conn.Release()

	assert.Equal(t, 1, backendCount(ctx, t, dsn),
		"la connexion acquise n'est pas visible côté serveur : le pool n'a pas joint cette base")
}

// La fiche demande un cycle de vie « attaché au `context` racine ». `pgxpool` ne l'attache pas :
// mesuré sur v5.10.0, le `ctx` passé à `New` ne sert qu'à `createIdleResources` (pgxpool/pool.go:334-336)
// et `Close` est le **seul** chemin qui ferme le pool (pool.go:456-461). C'est donc `store.NewPool`
// qui fait le lien, et c'est ce lien que ce test exerce.
func TestThePoolClosesWithTheRootContextAndLeavesNoConnection(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	dsn := freshDatabase(ctx, t)

	rootCtx, shutdown := context.WithCancel(ctx)
	defer shutdown()

	pool, err := store.NewPool(rootCtx, dsn)
	require.NoError(t, err, "construire le pool")

	conn, err := pool.Acquire(rootCtx)
	require.NoError(t, err, "acquérir une connexion")

	var alive int

	require.NoError(t, conn.QueryRow(rootCtx, "SELECT 1").Scan(&alive))
	conn.Release()

	// Sans ce plancher, « aucune connexion ne reste » serait vrai d'un pool qui n'en a jamais ouvert :
	// le test réussirait en n'ayant rien fermé.
	require.Equal(t, 1, backendCount(ctx, t, dsn),
		"aucune connexion n'était ouverte avant l'arrêt : il n'y aurait rien à fermer")

	shutdown()

	// La fermeture est asynchrone — elle est déclenchée par l'annulation, pas par le retour d'un
	// appel — donc elle s'attend. `Close` bloque de son côté jusqu'à ce que les connexions soient
	// rendues et fermées, et PostgreSQL retire le backend de `pg_stat_activity` à sa sortie.
	assert.Eventuallyf(t, func() bool { return backendCount(ctx, t, dsn) == 0 },
		10*time.Second, 50*time.Millisecond,
		"des connexions restent ouvertes après l'annulation du contexte racine : chaque redémarrage "+
			"laisserait derrière lui des backends que PostgreSQL compte dans max_connections")

	// Et le pool refuse de servir après coup, plutôt que de rouvrir en silence ce qu'on vient de
	// fermer.
	_, err = pool.Acquire(ctx)
	assert.Error(t, err, "le pool sert encore des connexions après l'arrêt")
}

// `pgxpool.ParseConfig` lit les réglages `pool_*` que le DSN transporte — `pool_min_conns`,
// `pool_max_conns` et les autres. Les bornes de `NewPool` sont donc posées **après** l'analyse, et
// non avant : un `DASHBOARD_DATABASE_URL` qui en demanderait davantage ne desserre rien.
//
// Sans ce test, les deux lignes qui les posent seraient indétectables au retrait : `MinConns` vaut
// déjà 0 par défaut, et `MaxConns` n'a de valeur observable que si quelqu'un en réclame une autre.
func TestTheDSNCannotLoosenThePoolBounds(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	dsn := freshDatabase(ctx, t) + "&pool_min_conns=5&pool_min_idle_conns=5&pool_max_conns=200"

	pool, err := store.NewPool(ctx, dsn)
	require.NoError(t, err, "construire le pool")

	defer pool.Close()

	assert.Neverf(t, func() bool { return backendCount(ctx, t, dsn) > 0 },
		500*time.Millisecond, 50*time.Millisecond,
		"le DSN a obtenu ses 5 connexions oisives : la paresse de DN-5 se perd dès qu'une variable "+
			"d'environnement la contredit")

	// Le plafond s'observe sur son effet : la connexion de trop **attend**, au lieu d'ouvrir une
	// place que le DSN aurait réclamée. Compter `Config().MaxConns` décrirait le réglage sans jamais
	// vérifier que le pool s'y tient.
	held := make([]*pgxpool.Conn, 0, maxConnectionsPerInstance)

	defer func() {
		for _, conn := range held {
			conn.Release()
		}
	}()

	for range maxConnectionsPerInstance {
		conn, acquireErr := pool.Acquire(ctx)
		require.NoError(t, acquireErr, "acquérir les connexions du plafond")

		held = append(held, conn)
	}

	saturated, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()

	// La connexion de trop est rendue si elle a été obtenue — c'est-à-dire précisément quand ce test
	// échoue. `Close` bloque jusqu'à ce que toutes les connexions empruntées reviennent : la garder
	// ferait **pendre** le test au lieu de le faire rougir, et un rouge qui n'arrive jamais ne prouve
	// rien. Constaté en jouant la mutation « ligne `MaxConns` retirée ».
	surplus, err := pool.Acquire(saturated)
	if surplus != nil {
		surplus.Release()
	}

	assert.Errorf(t, err, "le pool a ouvert une %dᵉ connexion : deux instances en prendraient %d, "+
		"et le DSN déciderait seul de la part que le tableau de bord prend dans max_connections",
		maxConnectionsPerInstance+1, 2*maxConnectionsPerInstance)
}

// L'autre chemin d'arrêt : `pool.Close()` appelé directement, ce que la step suivante écrira par
// réflexe Go en `defer pool.Close()`. Ce que le `sync.Once` de `pgxpool` protège est la double
// fermeture ; il ne dit rien du chemin qui **n'aboutit pas** — celui qui attend une annulation qui
// ne viendra jamais.
//
// Le contexte est `context.Background()` et non celui du test : un contexte que le test annule en
// sortant ferait disparaître la fuite au moment précis où on la mesure.
//
// Ce test ne prend pas `t.Parallel()` : il compte les goroutines du processus, et une suite qui en
// crée à côté ferait dire n'importe quoi à ce compteur.
func TestClosingThePoolDirectlyLeavesNoGoroutineBehind(t *testing.T) {
	const (
		pools = 50
		// Marge pour le bruit de fond du processus — testcontainers, `database/sql`, le ramasse-miettes.
		// La fuite, elle, se compte en dizaines : un chemin d'arrêt par pool construit.
		tolerance = 5
	)

	ctx := context.Background()
	dsn := freshDatabase(t.Context(), t)

	before := runtime.NumGoroutine()

	for range pools {
		pool, err := store.NewPool(ctx, dsn)
		require.NoError(t, err, "construire le pool")

		pool.Close()
	}

	runtime.GC()

	assert.Eventuallyf(t, func() bool { return runtime.NumGoroutine() <= before+tolerance },
		10*time.Second, 100*time.Millisecond,
		"%d goroutines avant, %d après avoir construit puis fermé %d pools : chaque pool fermé "+
			"directement retient une goroutine — et le pool entier avec elle — pour la vie du binaire",
		before, runtime.NumGoroutine(), pools)
}

// La borne de `ClosePool` : `Close` attend sans limite qu'une connexion **empruntée** revienne, et un
// handler qui ne la rendrait jamais ferait pendre le binaire à l'instant où il doit sortir.
//
// Le verdict est relevé sur un canal plutôt qu'affirmé après l'appel : c'est la seule forme qui
// rougit au lieu de pendre quand la borne disparaît. Même leçon que la connexion de trop de
// `TestTheDSNCannotLoosenThePoolBounds`.
func TestClosingThePoolGivesUpOnAConnectionThatNeverComesBack(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	dsn := freshDatabase(ctx, t)

	pool, err := store.NewPool(ctx, dsn)
	require.NoError(t, err, "construire le pool")

	// Empruntée et pas rendue avant l'appel : la requête que le délai de grâce n'a pas vu finir.
	held, err := pool.Acquire(ctx)
	require.NoError(t, err, "acquérir la connexion que rien ne rendra")

	returned := make(chan struct{})

	go func() {
		defer close(returned)

		store.ClosePool(pool, 200*time.Millisecond)
	}()

	select {
	case <-returned:
	case <-time.After(10 * time.Second):
		assert.Fail(t, "ClosePool attend encore une connexion que personne ne rendra : l'arrêt ne se "+
			"termine plus, et l'orchestrateur finira par envoyer SIGKILL — auquel cas ce sont toutes "+
			"les connexions qui partent sans se fermer")
	}

	// La connexion rendue débloque le `Close` resté en arrière-plan, et le second `Close` attend qu'il
	// ait fini — `sync.Once.Do` ne rend la main qu'après la première exécution. Sans ces deux lignes,
	// ce test laisserait une goroutine et un pool ouverts derrière lui, sous le nez du voisin qui
	// compte les goroutines du processus.
	held.Release()
	pool.Close()
}

// maxConnectionsPerInstance duplique la borne de `pool.go` plutôt que de l'exporter : une constante
// exportée pour le seul confort d'un test est une part d'API que rien ne demande, et si les deux
// divergent le test tombe — c'est précisément ce qu'on lui demande de faire.
const maxConnectionsPerInstance = 10

// Le message d'un DSN refusé ne cite ni la valeur ni l'erreur de la bibliothèque, parce que le DSN
// porte le mot de passe de la base.
//
// Ce n'est pas une précaution de principe : mesuré sur pgx v5.10.0, la rédaction de `pgconn`
// (`pgconn/errors.go:230-243`) repose sur deux expressions rationnelles ancrées sur `password='…'`
// et `password=…`. La forme `password = '…'`, espaces compris — que PostgreSQL accepte — ne
// correspond à aucune des deux, et le mot de passe ressort **en clair** dans le message.
func TestNewPoolRefusesAMalformedDSNWithoutCitingIt(t *testing.T) {
	t.Parallel()

	const password = "tr0p-secret"

	_, err := store.NewPool(t.Context(), "host=localhost password = '"+password+"' port=pas-un-nombre")

	require.Error(t, err, "un DSN illisible a été accepté")
	assert.NotContains(t, err.Error(), password,
		"le message de refus porte le mot de passe de la base : il finira dans un journal")
}

// backendCount rend le nombre de connexions que **PostgreSQL** voit sur la base visée.
//
// La lecture se fait depuis une connexion de contrôle ouverte sur une **autre** base — celle
// d'administration du conteneur — et jamais depuis le pool qu'on observe : lire « aucune connexion
// ne reste » à travers le pool qu'on vient de fermer est impossible, et le faire à travers une
// connexion posée sur la même base ferait compter la sonde elle-même.
func backendCount(ctx context.Context, t *testing.T, dsn string) int {
	t.Helper()

	name := databaseNameOf(t, dsn)

	control, err := pgx.Connect(ctx, suiteDSN)
	require.NoError(t, err, "connexion de contrôle au PostgreSQL de test")

	defer func() { _ = control.Close(ctx) }()

	var backends int

	err = control.QueryRow(ctx,
		"SELECT count(*) FROM pg_stat_activity WHERE datname = $1", name).Scan(&backends)
	require.NoErrorf(t, err, "compter les connexions ouvertes sur %s", name)

	return backends
}

func databaseNameOf(t *testing.T, dsn string) string {
	t.Helper()

	config, err := pgx.ParseConfig(dsn)
	require.NoError(t, err, "analyser le DSN de la base du test")

	require.NotEmpty(t, config.Database, "le DSN ne nomme aucune base")

	return strings.TrimPrefix(config.Database, "/")
}
