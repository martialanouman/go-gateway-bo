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

// Counter est un compteur glissant sur une dimension de `login_attempt_counters`.
//
// Il porte sa dimension plutôt que de la recevoir à chaque appel : une dimension passée en argument
// se trompe une fois et compte alors sur la mauvaise, ce qu'aucune contrainte ne verrait — les cinq
// valeurs sont légitimes, seule leur association à un site d'appel ne l'est pas.
//
// **Il ne remplace pas les deux rédactions existantes** (`Logins` pour le premier facteur, `MFA` pour
// le second) : celle du premier facteur compte deux dimensions en une instruction, et les replier
// toutes deux ici serait un remaniement de leur chemin, pas de celui-ci. La dette est nommée dans
// `tasks/steps/step-025.md`.
type Counter struct {
	pool  *pgxpool.Pool
	scope string
}

func NewCounter(pool *pgxpool.Pool, scope string) *Counter {
	return &Counter{pool: pool, scope: scope}
}

// Admit consulte le verrou **puis** compte l'appel, et rend le verrou trouvé — non nul veut dire
// « refusé », et rien n'a alors été compté.
//
// **L'ordre est le point, et il n'est écrit qu'ici.** Compter d'abord ferait qu'un client qui
// s'acharne pendant son verrou repousse sa propre échéance à chaque appel : `last_failure_at`
// avancerait sans cesse et seul l'abandon libérerait l'opérateur. Le chemin de connexion tient déjà
// cette propriété ; l'écrire une seconde fois dans chaque appelant la ferait diverger dans l'un
// d'eux, où aucun test ne la cherche.
func (c *Counter) Admit(ctx context.Context, subject string, window time.Duration, threshold int,
) (Lock, error) {
	lock, err := c.lockFor(ctx, subject, window, threshold)
	if err != nil || lock.Locked() {
		return lock, err
	}

	return Lock{}, c.record(ctx, subject, window)
}

func (c *Counter) lockFor(ctx context.Context, subject string, window time.Duration, threshold int,
) (Lock, error) {
	const query = `
		SELECT scope, failures,
		       EXTRACT(EPOCH FROM (last_failure_at + make_interval(secs => $2) - now()))
		FROM login_attempt_counters
		WHERE scope = $3 AND subject = $1
		  AND failures >= $4
		  AND last_failure_at + make_interval(secs => $2) > now()`

	var (
		lock    Lock
		seconds float64
	)

	err := c.pool.QueryRow(ctx, query, subject, window.Seconds(), c.scope, threshold).
		Scan(&lock.Scope, &lock.Failures, &seconds)

	if errors.Is(err, pgx.ErrNoRows) {
		return Lock{}, nil
	}

	if err != nil {
		return Lock{}, fmt.Errorf("lire le verrou de la dimension %s : %w", c.scope, err)
	}

	lock.Remaining = time.Duration(seconds * float64(time.Second))

	return lock, nil
}

// record compte un appel.
//
// Une seule instruction, comme les deux compteurs d'échecs et pour la même raison : `c` désigne dans
// `DO UPDATE` la ligne telle que PostgreSQL la relit après avoir pris son verrou de ligne, donc deux
// instances qui entrent ensemble sur une ligne à trois sortent à quatre puis cinq, jamais à quatre et
// quatre.
//
// La branche `CASE` est la **fenêtre d'oubli** : passé la fenêtre, le compteur repart à un plutôt que
// de reprendre où il en était. Sans elle, le deuxième appel suivant l'échéance reverrouillerait
// aussitôt, et le verrou serait en pratique définitif pour qui a franchi le seuil une fois.
//
// Il ne rend pas de verrou : l'appel qui atteint le seuil a fait un travail légitime et n'est pas
// refusé — c'est le suivant qu'`Admit` arrête.
func (c *Counter) record(ctx context.Context, subject string, window time.Duration) error {
	const query = `
		INSERT INTO login_attempt_counters AS c (scope, subject, failures, last_failure_at)
		VALUES ($3, $1, 1, now())
		ON CONFLICT (scope, subject) DO UPDATE
		SET failures = CASE
		        WHEN c.last_failure_at + make_interval(secs => $2) <= now() THEN 1
		        ELSE c.failures + 1
		    END,
		    last_failure_at = now()`

	if _, err := c.pool.Exec(ctx, query, subject, window.Seconds(), c.scope); err != nil {
		return fmt.Errorf("compter un appel de la dimension %s : %w", c.scope, err)
	}

	return nil
}
