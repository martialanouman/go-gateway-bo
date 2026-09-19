package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Bornes du pool, **écrites plutôt que laissées aux défauts** de `pgxpool`.
const (
	// Le défaut de `pgxpool` est `max(4, runtime.NumCPU())` : le nombre de connexions qu'une instance
	// ouvre dépendrait de la machine où le binaire se trouve tourner. Sur `postgres:18-alpine`, celui
	// de `docker-compose.yml`, `max_connections` vaut 100 ; à 10 par instance, le produit à ≥2
	// instances (§4.1) laisse la place aux migrations, à une session `psql` et à la supervision.
	maxConnectionsPerInstance int32 = 10

	// Zéro **délibérément** (DN-5), et non par défaut : le pool est paresseux, et une valeur non
	// nulle le remplirait en arrière-plan dès `NewPool`. Le compte visé au démarrage est
	// `max(MinConns, MinIdleConns)` (pgxpool/pool.go:334) — les deux sont donc posés.
	minConnections     int32 = 0
	minIdleConnections int32 = 0

	// Après une bascule ou une rotation d'identifiants, c'est cette borne qui décide en combien de
	// temps le pool a fini de renouveler ce qu'il tient ; le défaut est d'une heure. Le jitter évite
	// que ≥2 instances démarrées ensemble par le même déploiement ne recyclent en chœur.
	connectionLifetime       = 30 * time.Minute
	connectionLifetimeJitter = 5 * time.Minute

	// Corollaire de la paresse : ce que le tableau de bord n'utilise pas, il le rend. Une console
	// d'exploitation passe ses nuits sans trafic, et `MinConns = 0` permet au pool de retomber à
	// zéro plutôt que de tenir des connexions que personne ne regarde.
	idleConnectionTimeout = 5 * time.Minute

	// **La seule borne d'attente que `pgxpool` sait porter** : v5.10.0 n'a ni champ `AcquireTimeout`
	// ni paramètre `pool_acquire_timeout`, et `Acquire` s'en remet au `context` de son appelant. Non
	// renseigné, l'établissement de connexion est forcé à **deux minutes** — une requête HTTP qui
	// attendrait deux minutes une base injoignable est un écran figé.
	//
	// L'attente d'une place quand les 10 connexions sont prises n'est pas couverte ici : elle revient
	// au `context` de la requête, que `bff.withAPIDeadlines` borne à trente secondes.
	connectTimeout = 5 * time.Second
)

// NewPool construit le pool de connexions du schéma propre au BFF.
//
// **Aucune connexion n'est composée ici** (DN-5) : `pgxpool.NewWithConfig` ne lance en fond que la
// création des connexions oisives visées, `max(MinConns, MinIdleConns)` — nul des deux côtés, donc
// rien à créer. Le DSN, lui, est analysé, et un DSN illisible échoue ici plutôt qu'à la première
// requête.
//
// Le pool se ferme à l'annulation de ctx. `pgxpool` ne l'attache pas de lui-même : le `ctx` de `New`
// ne sert qu'à la création des oisives, et `Close` est le seul chemin qui ferme le pool. Le lien est
// posé par `context.AfterFunc` et non par une goroutine, car une goroutine bloquée sur
// `<-ctx.Done()` ne se réveille pas d'un `Close` direct et retiendrait le pool pour la vie du
// binaire.
//
// **Le contexte passé ici ne doit pas être celui de l'arrêt** : `AfterFunc` fermerait alors le pool
// au SIGTERM, c'est-à-dire au début du délai de grâce, et les requêtes que ce délai existe pour
// laisser finir tomberaient sur un pool fermé. `cmd/dashboard` passe un contexte que rien n'annulera
// et appelle `ClosePool` lui-même.
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

	// Les quatre lignes qui suivent ne sont gardées par aucun test, et c'est **mesuré** : les retirer
	// toutes les quatre laisse la suite verte. Ce qu'elles règlent ne devient observable qu'avec le
	// temps — une connexion qui atteint trente minutes, une base injoignable qu'on attend — et les
	// tester demanderait de faire passer une demi-heure à la suite, ou de dépendre d'un hôte qui
	// avale les paquets sans répondre.
	config.MaxConnLifetime = connectionLifetime
	config.MaxConnLifetimeJitter = connectionLifetimeJitter
	config.MaxConnIdleTime = idleConnectionTimeout
	config.ConnConfig.ConnectTimeout = connectTimeout

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("construire le pool de connexions : %w", err)
	}

	// Cette voie **n'attend pas** la fermeture : celui qui annule reprend la main aussitôt. Qui veut
	// un arrêt attendu appelle `ClosePool`, ce que fait `cmd/dashboard` — seul `pool_test.go` exerce
	// donc l'inscription ci-dessous.
	context.AfterFunc(ctx, pool.Close)

	return pool, nil
}

// ClosePool ferme le pool et attend, **au plus `within`**, que les connexions empruntées reviennent.
//
// `Close` attend sans limite qu'une connexion prêtée soit rendue, or un handler qui ignorerait son
// contexte n'en rendrait jamais — et un arrêt qui ne se termine pas finit en SIGKILL, auquel cas
// *toutes* les connexions partent sans se fermer. La goroutine laissée derrière retient le pool :
// elle ne coûte rien à un processus qui s'arrête, et interdit à ClosePool de servir ailleurs.
func ClosePool(pool *pgxpool.Pool, within time.Duration) {
	closed := make(chan struct{})

	go func() {
		defer close(closed)

		pool.Close()
	}()

	select {
	case <-closed:
	case <-time.After(within):
	}
}
