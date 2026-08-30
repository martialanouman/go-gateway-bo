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
	// emails est le compteur de la dimension de l'adresse, et il n'en sert qu'un geste : l'effacement
	// d'un succès. Les deux autres accès de ce fichier couvrent **deux** dimensions en une
	// instruction, ce que `Counter` ne sait pas faire et n'a pas à apprendre.
	//
	// **Le risque résiduel est nommé plutôt que tu** : lui faire porter `lockFor` ou `count`
	// retirerait la dimension de la source du chemin, sans erreur et sans test rouge — aucun cas de
	// `logins_test.go` n'y passe. Ce qui le borne est que les méthodes de `Counter` sont **privées** :
	// hors de ce paquet, personne ne peut l'écrire.
	emails *Counter
}

func NewLogins(pool *pgxpool.Pool) *Logins {
	return &Logins{pool: pool, emails: NewCounter(pool, ScopeEmail)}
}

// Operator est ce que le premier facteur a besoin de savoir, et rien de plus. Ni le secret TOTP, ni
// les identifiants WebAuthn : le second facteur les lit dans `mfa.go`, et les charger ici les ferait
// traverser une frontière pour rien.
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

	lock, err := scanLock(l.pool.QueryRow(ctx, query, emailKey, sourceKey, window.Seconds(),
		ScopeEmail, ScopeSource, threshold))

	if errors.Is(err, pgx.ErrNoRows) {
		return Lock{}, nil
	}

	if err != nil {
		return Lock{}, fmt.Errorf("lire le verrou de connexion : %w", err)
	}

	return lock, nil
}

// RecordFailure incrémente les deux compteurs et rend le verrou qui en résulte.
//
// **Une seule instruction, et c'est ce qui rend le compteur partagé.** Dans `ON CONFLICT DO UPDATE`,
// l'alias `c` désigne la ligne telle que PostgreSQL la relit après avoir pris son verrou de ligne, et
// non telle que le snapshot de la transaction la voyait : deux instances qui entrent ensemble sur une
// ligne à trois échecs sortent à quatre puis cinq, jamais à quatre et quatre.
//
// **La forme qu'il ne faut pas écrire est décrite une seule fois, sur `Counter.count`**, et elle vaut
// ici mot pour mot : la CTE `SELECT … FOR UPDATE` perd des échecs quel que soit le nombre de
// dimensions. L'écrire deux fois serait le défaut même que ce fichier a cessé de porter.
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
		lock, scanErr := scanLock(rows)
		if scanErr != nil {
			return Lock{}, fmt.Errorf("lire le compteur mis à jour : %w", scanErr)
		}

		if lock.Failures < threshold {
			continue
		}

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
	return l.emails.reset(ctx, emailKey)
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
