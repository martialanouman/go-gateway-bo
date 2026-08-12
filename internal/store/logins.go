package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Logins porte les lectures et les écritures du premier facteur : l'opérateur qu'on cherche, les
// compteurs d'échecs que les instances partagent, et le challenge qu'un login réussi émet.
//
// Il prend un **pool** et non un DSN, et c'est le premier de ce paquet à le faire : une route HTTP
// sert des milliers de requêtes là où `Migrate` et `Seed` s'exécutent une fois par déploiement. C'est
// le site d'appel que `NewPool` annonce depuis step-005.
type Logins struct {
	pool *pgxpool.Pool
}

func NewLogins(pool *pgxpool.Pool) *Logins {
	return &Logins{pool: pool}
}

// Lock décrit un verrouillage en cours. Sa valeur nulle veut dire « aucun verrou », ce qui est le cas
// courant : c'est ce qui permet à l'appelant d'écrire `if lock.Locked()` sans distinguer l'absence.
type Lock struct {
	// Scope dit laquelle des deux dimensions a verrouillé — l'adresse soumise ou la source.
	Scope string
	// Failures est le compte d'échecs de cette dimension.
	Failures int
	// Remaining est ce qu'il reste à attendre, **calculé par le serveur de base**. Le calculer en Go
	// ferait dépendre le verrou de l'horloge de l'instance qui répond, donc rendrait deux durées
	// différentes pour le même verrou selon l'instance jointe.
	Remaining time.Duration
}

// Locked dit si ce verrou mord encore.
func (l Lock) Locked() bool { return l.Remaining > 0 }

// Operator est ce que le premier facteur a besoin de savoir, et rien de plus. Ni le secret TOTP, ni
// les identifiants WebAuthn : step-023 et step-024 les liront quand elles auront de quoi les
// exercer, et les charger ici les ferait traverser une frontière pour rien.
type Operator struct {
	// ID est l'UUID en texte. Le paquet n'introduit pas de type UUID : rien dans ce dépôt n'en
	// manipule un, et pgx rend l'aller-retour `text` ↔ `uuid` sans conversion à écrire.
	ID           string
	PasswordHash string
	Status       string
}

// StatusActive est le seul statut qui autorise une connexion. L'autre — `disabled` — refuse, et
// refuse **exactement comme un mot de passe faux** : le dire autrement révélerait que le compte
// existe.
const StatusActive = "active"

// Les trois dimensions comptées. Ce sont les trois valeurs que la contrainte `CHECK` admet —
// migration 00004 pour les deux premières, 00007 pour la troisième ; les écrire ici plutôt qu'en
// littéral dans les requêtes est ce qui fait qu'une faute de frappe est refusée par le compilateur et
// non par la base.
//
// `ScopeSecondFactor` est comptée par `mfa.go`, sur l'identifiant de l'opérateur. Elle partage cette
// table et son mécanisme d'incrément atomique plutôt que d'en avoir une jumelle, qui en serait une
// seconde rédaction.
const (
	ScopeEmail        = "email"
	ScopeSource       = "source"
	ScopeSecondFactor = "mfa"
)

// OperatorByEmail rend l'opérateur correspondant à une adresse **déjà minusculée**, ou nil.
//
// Un absent n'est **pas** une erreur, et c'est délibéré : c'est un cas normal du chemin de
// connexion, et le transformer en erreur obligerait l'appelant à écrire deux branches là où le
// hachage factice en exige exactement une — c'est dans cette seconde branche que l'oracle
// d'énumération se réinstalle.
//
// La comparaison est `lower(email) = $1` : c'est l'expression exacte de l'index
// `operators_email_lower_key` posé par 00001, donc la requête l'emprunte. L'appelant minuscule la
// valeur lui-même, et la **même** valeur sert de clé au compteur d'échecs — une seule normalisation
// pour les deux, sans quoi une adresse pourrait être comptée sous une clé et cherchée sous une autre.
func (l *Logins) OperatorByEmail(ctx context.Context, lowerEmail string) (*Operator, error) {
	const query = `
		SELECT id::text, password_hash, status
		FROM operators
		WHERE lower(email) = $1`

	var operator Operator

	err := l.pool.QueryRow(ctx, query, lowerEmail).
		Scan(&operator.ID, &operator.PasswordHash, &operator.Status)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil //nolint:nilnil // L'absence est un cas normal ; voir la doc ci-dessus.
	}

	if err != nil {
		return nil, fmt.Errorf("chercher l'opérateur : %w", err)
	}

	return &operator, nil
}

// LockFor rend le verrou en cours sur l'une des deux dimensions : le plus **récent**, qui est aussi
// le plus long — mais seulement parce que les deux lignes partagent la même fenêtre `$3`, ce qui rend
// la durée restante monotone en `last_failure_at`. Le jour où une dimension aurait sa propre fenêtre,
// ce tri deviendrait faux en silence et il faudrait trier sur l'expression qui calcule `Remaining`. Il est consulté **avant** tout hachage : c'est ce qui borne à la fois le coût d'une attaque
// et le nombre de lignes qu'elle peut créer dans la table des compteurs.
func (l *Logins) LockFor(ctx context.Context, emailKey, sourceKey string, window time.Duration,
	threshold int,
) (Lock, error) {
	const query = `
		SELECT scope, failures,
		       EXTRACT(EPOCH FROM (last_failure_at + make_interval(secs => $3) - now()))
		FROM login_attempt_counters
		WHERE (scope, subject) IN (($4, $1), ($5, $2))
		  AND failures >= $6
		  AND last_failure_at + make_interval(secs => $3) > now()
		ORDER BY last_failure_at DESC
		LIMIT 1`

	var (
		lock    Lock
		seconds float64
	)

	err := l.pool.QueryRow(ctx, query, emailKey, sourceKey, window.Seconds(), ScopeEmail, ScopeSource,
		threshold).Scan(&lock.Scope, &lock.Failures, &seconds)

	if errors.Is(err, pgx.ErrNoRows) {
		return Lock{}, nil
	}

	if err != nil {
		return Lock{}, fmt.Errorf("lire le verrou de connexion : %w", err)
	}

	lock.Remaining = time.Duration(seconds * float64(time.Second))

	return lock, nil
}

// RecordFailure incrémente les deux compteurs et rend le verrou qui en résulte.
//
// **Une seule instruction, et c'est ce qui rend le compteur partagé.** Dans `ON CONFLICT DO UPDATE`,
// l'alias `c` désigne la ligne telle que PostgreSQL la relit après avoir pris son verrou de ligne, et
// non telle que le snapshot de la transaction la voyait : deux instances qui entrent ensemble sur une
// ligne à trois échecs sortent à quatre puis cinq, jamais à quatre et quatre.
//
// **La forme qu'il ne faut pas écrire**, et qui est la première qui vient quand on veut éviter de
// répéter le `CASE` : une CTE `SELECT … FOR UPDATE` suivie d'un `DO UPDATE SET failures =
// excluded.failures`. Elle **perd des échecs** — la CTE lit sur le snapshot, donc `excluded` porte
// une valeur périmée qui écrase la valeur fraîche, et le `FOR UPDATE` n'y change rien puisqu'il ne
// verrouille pas une ligne absente. Elle est verte sous test séquentiel. C'est exactement le défaut
// que cette step existe pour interdire, et c'est le genre de réécriture qu'une revue « simplifions
// cette expression dupliquée » réintroduit six mois plus tard.
//
// Les deux lignes ne peuvent jamais entrer en collision entre elles — leurs `scope` diffèrent — donc
// « ON CONFLICT DO UPDATE command cannot affect row a second time » est inatteignable ici.
func (l *Logins) RecordFailure(ctx context.Context, emailKey, sourceKey string, window time.Duration,
	threshold int,
) (Lock, error) {
	const query = `
		INSERT INTO login_attempt_counters AS c (scope, subject, failures, last_failure_at)
		SELECT dimension.scope, dimension.subject, 1, now()
		FROM (VALUES ($4::text, $1::text), ($5::text, $2::text)) AS dimension(scope, subject)
		ON CONFLICT (scope, subject) DO UPDATE
		SET failures = CASE
		        -- Un silence plus long que la fenêtre remet le compteur à un. La fenêtre d'oubli et la
		        -- durée du verrou sont la **même** valeur, délibérément : plus courte, un verrou qui
		        -- vient d'expirer se refermerait au premier essai suivant, et « verrou expiré → un
		        -- nouvel essai est possible » serait faux.
		        WHEN c.last_failure_at + make_interval(secs => $3) <= now() THEN 1
		        ELSE c.failures + 1
		    END,
		    last_failure_at = now()
		RETURNING scope, failures,
		          EXTRACT(EPOCH FROM (last_failure_at + make_interval(secs => $3) - now()))`

	rows, err := l.pool.Query(ctx, query, emailKey, sourceKey, window.Seconds(), ScopeEmail, ScopeSource)
	if err != nil {
		return Lock{}, fmt.Errorf("enregistrer l'échec de connexion : %w", err)
	}
	defer rows.Close()

	var strongest Lock

	for rows.Next() {
		var (
			lock    Lock
			seconds float64
		)

		if err = rows.Scan(&lock.Scope, &lock.Failures, &seconds); err != nil {
			return Lock{}, fmt.Errorf("lire le compteur mis à jour : %w", err)
		}

		if lock.Failures < threshold {
			continue
		}

		lock.Remaining = time.Duration(seconds * float64(time.Second))
		if lock.Remaining > strongest.Remaining {
			strongest = lock
		}
	}

	if err = rows.Err(); err != nil {
		return Lock{}, fmt.Errorf("enregistrer l'échec de connexion : %w", err)
	}

	return strongest, nil
}

// ClearFailures efface le compteur de l'adresse après une connexion réussie.
//
// **Celui de la source n'est pas effacé**, et ce n'est pas un oubli : un attaquant qui possède un
// compte valide remettrait sinon son propre compteur d'adresse source à zéro à volonté, ce qui
// annulerait la seconde dimension pour quiconque détient un identifiant. Le compteur de source
// s'éteint tout seul, par oubli, au bout de la fenêtre.
func (l *Logins) ClearFailures(ctx context.Context, emailKey string) error {
	const query = `DELETE FROM login_attempt_counters WHERE scope = $2 AND subject = $1`

	if _, err := l.pool.Exec(ctx, query, emailKey, ScopeEmail); err != nil {
		return fmt.Errorf("effacer le compteur d'échecs : %w", err)
	}

	return nil
}

// IssueChallenge pose un challenge de second facteur et rend son échéance.
//
// L'échéance est calculée par **le serveur de base**, comme les verrous : deux instances aux horloges
// décalées émettraient sinon des challenges qui n'expirent pas au même moment, et le second facteur
// refuserait un jeton que l'autre instance tient encore pour valide.
//
// Ce fichier n'émet que le challenge. Le **consommer** est le geste de `POST /auth/mfa/verify`, donc
// du second facteur : il vit dans `mfa.go`, avec la lecture qui vérifie qu'il est encore utilisable et
// le compteur d'essais qui le borne. L'usage unique, lui, est porté par le schéma depuis le premier
// jour : `consumed_at` et l'unicité de `token_hash` (migration 00004).
func (l *Logins) IssueChallenge(ctx context.Context, operatorID string, tokenHash []byte,
	ttl time.Duration,
) (time.Time, error) {
	const query = `
		INSERT INTO mfa_challenges (operator_id, token_hash, expires_at)
		VALUES ($1, $2, now() + make_interval(secs => $3))
		RETURNING expires_at`

	var expiresAt time.Time

	err := l.pool.QueryRow(ctx, query, operatorID, tokenHash, ttl.Seconds()).Scan(&expiresAt)
	if err != nil {
		return time.Time{}, fmt.Errorf("émettre le challenge de second facteur : %w", err)
	}

	return expiresAt, nil
}
