package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Bornes du pool, **écrites plutôt que laissées aux défauts** de `pgxpool`. Chaque valeur a sa
// raison, et chaque raison est lue dans la source de la bibliothèque ou mesurée sur le serveur.
const (
	// Le défaut de `pgxpool` est `max(4, runtime.NumCPU())` (pgxpool/pool.go:19, et le calcul dans
	// `ParseConfig`) : le nombre de connexions qu'une instance ouvre dépendrait alors de la machine
	// où le binaire se trouve tourner — quatre sur un poste, seize sur un runner à seize cœurs.
	//
	// Mesuré sur `postgres:18-alpine`, celui de `docker-compose.yml` : `max_connections` vaut 100 et
	// `superuser_reserved_connections` 3. Le produit tourne à ≥2 instances (§4.1) ; à 10 chacune,
	// deux instances en prennent 20 et six en prennent 60, ce qui laisse de la place aux migrations,
	// à une session `psql` d'exploitation et à la supervision. Le tableau de bord n'est pas sur le
	// chemin critique du plan de données : il n'a aucune raison de disputer ses connexions à qui que
	// ce soit.
	maxConnectionsPerInstance int32 = 10

	// Zéro **délibérément** (DN-5), et non par défaut : le pool est paresseux, et une valeur non
	// nulle le remplirait en arrière-plan dès `NewPool`. Le compte visé au démarrage est
	// `max(MinConns, MinIdleConns)` (pgxpool/pool.go:334) — les deux sont donc posés.
	minConnections     int32 = 0
	minIdleConnections int32 = 0

	// Une connexion ne survit pas indéfiniment au serveur qu'elle a joint : après une bascule ou une
	// rotation d'identifiants, c'est cette borne qui décide en combien de temps le pool a fini de
	// renouveler ce qu'il tient. Le défaut est d'une heure (pgxpool/pool.go:22).
	//
	// Le jitter existe pour ça dans la bibliothèque, qui le dit elle-même : « This helps prevent all
	// connections from being closed at the exact same time, starving the pool. » Avec ≥2 instances
	// démarrées ensemble par le même déploiement, sans lui elles recycleraient en chœur.
	connectionLifetime       = 30 * time.Minute
	connectionLifetimeJitter = 5 * time.Minute

	// Corollaire de la paresse : ce que le tableau de bord n'utilise pas, il le rend. Une console
	// d'exploitation passe ses nuits sans trafic, et `MinConns = 0` permet au pool de retomber à
	// zéro plutôt que de tenir des connexions que personne ne regarde.
	idleConnectionTimeout = 5 * time.Minute

	// **La seule borne d'attente que `pgxpool` sait porter.** La fiche demande un « délai
	// d'acquisition » : il n'existe pas — v5.10.0 n'a ni champ `AcquireTimeout` ni paramètre
	// `pool_acquire_timeout`, et `Acquire` s'en remet au `context` de son appelant. Ce qu'un
	// appelant paie réellement sur un pool paresseux est l'établissement de la connexion, et là le
	// défaut est piégeux : non renseigné, `pgxpool` le force à **deux minutes**
	// (pgxpool/pool.go:277-278). Une requête HTTP qui attendrait deux minutes une base injoignable
	// est un écran figé.
	//
	// Ce que cette borne ne couvre pas — l'attente d'une place quand les 10 connexions sont prises —
	// revient au `context` de la requête, donc à la step qui écrira la première route.
	connectTimeout = 5 * time.Second
)

// NewPool construit le pool de connexions du schéma propre au BFF.
//
// **Aucune connexion n'est composée ici** (DN-5) : `pgxpool.NewWithConfig` ne lance en fond que la
// création des connexions oisives visées, `max(MinConns, MinIdleConns)` (pgxpool/pool.go:334-336) —
// nul des deux côtés, donc rien à créer. Le DSN, lui, est bien analysé, et un DSN illisible échoue
// ici plutôt qu'à la première requête.
//
// Le pool se ferme à l'annulation de ctx. `pgxpool` ne l'attache pas de lui-même : le `ctx` de `New`
// ne sert qu'à la création des oisives, et `Close` est le seul chemin qui ferme le pool
// (pgxpool/pool.go:456-461). Fermer reste possible directement — `Close` est protégé par un
// `sync.Once` (pool.go:457) — et ce second chemin ne laisse rien derrière lui **parce que le lien
// est posé par `context.AfterFunc` et non par une goroutine**. Une goroutine bloquée sur
// `<-ctx.Done()` ne se réveille pas d'un `Close` direct : mesurée le 02/08/2026, elle retenait le
// pool entier pour la vie du binaire, à raison d'une par pool construit.
//
// # Ce que ce package ne câble pas, et pourquoi
//
// Rien n'appelle encore `NewPool` dans `cmd/dashboard`, et c'est délibéré.
//
// DN-7 annonçait que le câblage du pool dans le binaire serait rendu falsifiable par le scénario
// « un DSN mal formé empêche le démarrage » : en retirer le câblage aurait fait démarrer le binaire.
// **Mesuré le 02/08/2026, ce n'est plus vrai** : la validation du DSN vit dans `internal/config`
// (`requiredDatabaseURL`, sur `pgxpool.ParseConfig`), et le scénario est vert aujourd'hui alors que
// `cmd/dashboard` ne mentionne `store` nulle part. Retirer un câblage ne ferait donc rougir aucune
// porte, et en ajouter un ne serait observable par rien : un pool paresseux qui ne se connecte pas
// n'a aucun effet qu'un scénario puisse voir. (Cette phrase disait « qu'un scénario **sans Docker**
// puisse voir » : depuis step-020, les scénarios de `cmd/dashboard` ont un PostgreSQL réel. La
// prémisse a changé, la conclusion non — un pool que rien n'atteint reste invisible.)
//
// Le câbler quand même livrerait exactement ce que ce dépôt a déjà refusé deux fois — un artefact
// qu'aucun appelant n'atteint, un client instancié que rien n'appelle. Ce que la fiche demande —
// cycle de vie attaché au `context` racine, arrêt propre — est tenu **par cette fonction** et exercé
// par `pool_test.go` contre un PostgreSQL réel ; seul le site d'appel attend.
//
// Cette phrase annonçait « le pool part avec la première route qui lit la base (step-020) ».
// **step-020 est passée et ne livre aucune route** : elle livre un contrôle de démarrage, qui
// travaille sur le `*sql.DB` que goose expose, et une commande hors ligne, qui ouvre une `pgx.Conn`
// unique — trois requêtes jouées une fois par déploiement n'ont que faire d'un pool de dix
// connexions réglé pour un serveur qui vit. Ni l'un ni l'autre n'appelle un `pgxpool`. Le
// pool part donc avec `POST /auth/login`, step-021, qui l'atteindra pour de bon et pourra l'observer.
func NewPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		// L'erreur de la bibliothèque n'est **pas** enveloppée, et le DSN n'est pas cité : mesuré sur
		// pgx v5.10.0, la rédaction de `pgconn` (`pgconn/errors.go:230-243`) est ancrée sur
		// `password='…'` et `password=…`, et laisse passer `password = '…'` en clair.
		return nil, errors.New("DSN PostgreSQL invalide, en URL `postgres://…` ou en `clé=valeur` ; " +
			"la valeur n'est pas citée, elle porte le mot de passe de la base")
	}

	// Les bornes sont posées **après** l'analyse, jamais avant : `ParseConfig` lit les réglages
	// `pool_*` que le DSN transporte, et les poser avant les laisserait desserrer par une variable
	// d'environnement. `pool_test.go` le tient sur les trois premières.
	config.MaxConns = maxConnectionsPerInstance
	config.MinConns = minConnections
	config.MinIdleConns = minIdleConnections

	// Les quatre lignes qui suivent ne sont gardées par aucun test, et c'est **mesuré, pas supposé** :
	// les retirer toutes les quatre laisse la suite verte (vérifié le 02/08/2026). Ce qu'elles règlent
	// ne devient observable qu'avec le temps — une connexion qui atteint trente minutes, une base
	// injoignable qu'on attend — ou sur le cas « DSN bien formé, base injoignable », que DN-7 laisse
	// explicitement à la step qui lira la base.
	//
	// Les tester ici demanderait de faire passer une demi-heure à la suite, ou de dépendre d'un hôte
	// qui avale les paquets sans répondre — un test que le réseau du runner rendrait faux un jour sur
	// dix. Le dire vaut mieux qu'un test qui fait semblant.
	config.MaxConnLifetime = connectionLifetime
	config.MaxConnLifetimeJitter = connectionLifetimeJitter
	config.MaxConnIdleTime = idleConnectionTimeout
	config.ConnConfig.ConnectTimeout = connectTimeout

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("construire le pool de connexions : %w", err)
	}

	// `context.AfterFunc` et non `go func() { <-ctx.Done(); … }()` : il s'inscrit auprès du contexte
	// au lieu de parquer une goroutine, donc un pool fermé directement ne retient plus rien — et un
	// `ctx` que rien n'annulera jamais (`context.Background()`) ne fait même pas naître d'inscription.
	//
	// `Close` bloque jusqu'à ce que les connexions empruntées soient rendues et fermées : c'est ce qui
	// fait de l'arrêt un arrêt *propre*, et non un abandon de backends que PostgreSQL compterait
	// encore dans `max_connections`. Il est appelé ici depuis la goroutine que le contexte réveille à
	// son annulation, jamais depuis l'appelant de `NewPool`.
	context.AfterFunc(ctx, pool.Close)

	return pool, nil
}
