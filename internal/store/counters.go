package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Les deux dimensions qui comptent des **appels** et non des échecs — migration 00009. Elles bornent
// des routes qui réussissent à chaque fois, et qu'aucun compteur d'échecs ne voit donc passer.
const (
	ScopeTOTPEnroll       = "totp_enroll"
	ScopeWebauthnCeremony = "webauthn_ceremony"
)

// Counter est la rédaction **unique** de tout accès mono-dimension à `login_attempt_counters`.
//
// Il porte sa dimension plutôt que de la recevoir à chaque appel : une dimension passée en argument
// se trompe une fois et compte alors sur la mauvaise, ce qu'aucune contrainte ne verrait — les cinq
// valeurs sont légitimes, seule leur association à un site d'appel ne l'est pas.
//
// **Ce que les cinq dimensions comptent diffère ; comment elles le comptent, non.** Trois comptent des
// échecs et deux des appels, mais toutes dérivent leur verrou de `(failures, last_failure_at)`,
// incrémentent en une seule instruction et oublient au bout de la fenêtre. Ces trois mécanismes
// vivaient en trois exemplaires — `Logins`, `MFA` et ce fichier — jusqu'à ce que la dette nommée par
// `tasks/steps/done/step-025.md` soit payée.
//
// **Ce qui n'est pas ici, et pourquoi** : `Logins.LockFor` et `Logins.RecordFailure` couvrent
// l'adresse et la source **en une seule instruction**, ce qui n'est pas la même requête. Les replier
// aurait remanié le chemin consulté avant tout argon2id pour un gain de forme.
type Counter struct {
	pool  *pgxpool.Pool
	scope string
}

func NewCounter(pool *pgxpool.Pool, scope string) *Counter {
	return &Counter{pool: pool, scope: scope}
}

// lockFor rend le verrou en cours sur cette dimension, ou le verrou nul.
//
// Il est consulté **avant** toute dépense — avant les argon2id du premier facteur, avant le
// déchiffrement du secret du second — sans quoi le verrou protégerait le compte sans protéger le
// serveur. Il borne aussi le nombre de lignes qu'une attaque peut créer dans la table.
func (c *Counter) lockFor(ctx context.Context, subject string, window time.Duration, threshold int,
) (Lock, error) {
	const query = `
		SELECT scope, failures,
		       EXTRACT(EPOCH FROM (last_failure_at + make_interval(secs => $2) - now()))
		FROM login_attempt_counters
		WHERE scope = $3 AND subject = $1
		  AND failures >= $4
		  AND last_failure_at + make_interval(secs => $2) > now()`

	lock, err := scanLock(c.pool.QueryRow(ctx, query, subject, window.Seconds(), c.scope, threshold))

	if errors.Is(err, pgx.ErrNoRows) {
		return Lock{}, nil
	}

	if err != nil {
		return Lock{}, fmt.Errorf("lire le verrou de la dimension %s : %w", c.scope, err)
	}

	return lock, nil
}

// count compte un passage sur cette dimension et rend le verrou qui en résulte — le verrou **nul**
// tant que le seuil n'est pas atteint.
//
// **Une seule instruction, et c'est ce qui rend le compteur partagé entre instances.** Dans
// `ON CONFLICT DO UPDATE`, l'alias `c` désigne la ligne telle que PostgreSQL la relit après avoir
// pris son verrou de ligne, et non telle que le snapshot de la transaction la voyait : deux instances
// qui entrent ensemble sur une ligne à trois sortent à quatre puis cinq, jamais à quatre et quatre.
//
// **La forme qu'il ne faut pas écrire**, et qui est la première qui vient quand on veut éviter de
// répéter le `CASE` : une CTE `SELECT … FOR UPDATE` suivie d'un `DO UPDATE SET failures =
// excluded.failures`. Elle **perd des passages** — la CTE lit sur le snapshot, donc `excluded` porte
// une valeur périmée qui écrase la valeur fraîche, et le `FOR UPDATE` n'y change rien puisqu'il ne
// verrouille pas une ligne absente. Elle est verte sous test séquentiel. C'est le genre de réécriture
// qu'une revue « simplifions cette expression dupliquée » réintroduit six mois plus tard, et c'est
// pourquoi cette mise en garde est écrite **ici seulement** : `Logins.RecordFailure` y renvoie.
//
// La branche `CASE` est la **fenêtre d'oubli**, et sa durée est celle du verrou, délibérément : plus
// courte, un verrou qui vient d'expirer se refermerait au premier passage suivant, et « verrou
// expiré → un nouvel essai est possible » serait faux.
func (c *Counter) count(ctx context.Context, subject string, window time.Duration, threshold int,
) (Lock, error) {
	const query = `
		INSERT INTO login_attempt_counters AS c (scope, subject, failures, last_failure_at)
		VALUES ($3, $1, 1, now())
		ON CONFLICT (scope, subject) DO UPDATE
		SET failures = CASE
		        WHEN c.last_failure_at + make_interval(secs => $2) <= now() THEN 1
		        ELSE c.failures + 1
		    END,
		    last_failure_at = now()
		RETURNING scope, failures,
		          EXTRACT(EPOCH FROM (last_failure_at + make_interval(secs => $2) - now()))`

	lock, err := scanLock(c.pool.QueryRow(ctx, query, subject, window.Seconds(), c.scope))
	if err != nil {
		return Lock{}, fmt.Errorf("compter un passage sur la dimension %s : %w", c.scope, err)
	}

	if lock.Failures < threshold {
		return Lock{}, nil
	}

	return lock, nil
}

// reset efface le compteur de ce sujet sur cette dimension.
//
// Il n'efface **que** cette dimension, ce qui est la propriété dont dépend la dissymétrie du premier
// facteur : une connexion réussie efface l'adresse et laisse la source s'éteindre par oubli.
func (c *Counter) reset(ctx context.Context, subject string) error {
	const query = `DELETE FROM login_attempt_counters WHERE scope = $2 AND subject = $1`

	if _, err := c.pool.Exec(ctx, query, subject, c.scope); err != nil {
		return fmt.Errorf("effacer le compteur de la dimension %s : %w", c.scope, err)
	}

	return nil
}

// Admit consulte le verrou **puis** compte l'appel, et rend le verrou trouvé — non nul veut dire
// « refusé », et rien n'a alors été compté.
//
// **L'ordre est le point, et il n'est écrit qu'ici.** Compter d'abord ferait qu'un client qui
// s'acharne pendant son verrou repousse sa propre échéance à chaque appel : `last_failure_at`
// avancerait sans cesse et seul l'abandon libérerait l'opérateur. Le chemin de connexion tient déjà
// cette propriété ; l'écrire une seconde fois dans chaque appelant la ferait diverger dans l'un
// d'eux, où aucun test ne la cherche.
//
// **Le verrou que `count` rend est délibérément jeté.** L'appel qui atteint le seuil a fait un travail
// légitime et n'est pas refusé ; c'est le **suivant** qu'`Admit` arrête, sur le `LockFor` d'entrée. Le
// rendre ici décalerait d'un cran chaque borne du produit — cinq enrôlements deviendraient quatre.
//
// **`Admit` est la seule des quatre méthodes qui soit exportée, et c'est une garde et non un style.**
// Les trois autres sont privées parce que `internal/mfa` détient un `*Counter` : exportées, un appelant
// pourrait compter sans consulter, ce que les deux paragraphes ci-dessus existent pour interdire — et
// il n'en resterait alors que ces paragraphes. Le compilateur les tient maintenant. `MFA` et `Logins`
// les atteignent parce qu'ils vivent dans ce paquet, et c'est exactement la portée voulue.
func (c *Counter) Admit(ctx context.Context, subject string, window time.Duration, threshold int,
) (Lock, error) {
	lock, err := c.lockFor(ctx, subject, window, threshold)
	if err != nil || lock.Locked() {
		return lock, err
	}

	_, err = c.count(ctx, subject, window, threshold)

	return Lock{}, err
}
