package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MFA porte les lectures et les écritures du **second** facteur : le secret chiffré, l'anti-rejeu, le
// challenge qu'une vérification consomme, et les codes de récupération.
//
// Aucune crypto ici. Le secret n'y entre et n'en sort que **déjà chiffré**, les codes que déjà hachés,
// et la fenêtre de dérive vit dans `internal/mfa`. Ce fichier ne connaît que le SQL — comme
// `sessions.go` à côté.
type MFA struct {
	pool *pgxpool.Pool
}

func NewMFA(pool *pgxpool.Pool) *MFA {
	return &MFA{pool: pool}
}

// TOTPState est ce qu'une vérification et un enrôlement ont besoin de lire, en un seul aller-retour.
type TOTPState struct {
	// Email est ce que l'application d'authentification affichera comme nom de compte. Il vient de la
	// même ligne que le reste : le lire ailleurs serait une seconde requête pour une seule colonne.
	Email string
	// SealedSecret est vide quand aucun authentificateur n'est enrôlé.
	SealedSecret string
	Enrolled     bool
	// CurrentStep vient de l'horloge **du serveur de base**. Le calculer en Go ferait qu'un code
	// accepté par une instance serait refusé par l'autre, et que l'anti-rejeu comparerait deux
	// échelles différentes.
	CurrentStep int64
}

// TOTPStateOf lit le secret chiffré et le pas de temps courant.
//
// `false` dit qu'aucun opérateur **actif** ne porte cet identifiant. Le distinguer d'un opérateur
// sans enrôlement n'est pas une coquetterie : une session résolue puis un compte désactivé dans
// l'intervalle ne doit pas se lire comme « il lui reste à enrôler un authentificateur ».
func (m *MFA) TOTPStateOf(ctx context.Context, operatorID string, periodSeconds int) (TOTPState,
	bool, error,
) {
	const query = `
		SELECT email, coalesce(mfa_totp_secret, ''), mfa_totp_secret IS NOT NULL,
		       floor(extract(epoch FROM now()) / $2)::bigint
		FROM operators
		WHERE id = $1 AND status = $3`

	var state TOTPState

	err := m.pool.QueryRow(ctx, query, operatorID, periodSeconds, StatusActive).
		Scan(&state.Email, &state.SealedSecret, &state.Enrolled, &state.CurrentStep)

	if errors.Is(err, pgx.ErrNoRows) {
		return TOTPState{}, false, nil
	}

	if err != nil {
		return TOTPState{}, false, fmt.Errorf("lire le second facteur de l'opérateur : %w", err)
	}

	return state, true, nil
}

// SecondFactors est ce que `GET /auth/me` rend de l'état du second facteur. Ni secret, ni code : un
// booléen et un compte ne se rejouent pas.
type SecondFactors struct {
	TOTPEnrolled           bool
	RecoveryCodesRemaining int
}

// FactorsOf rend ce que l'écran d'enrôlement doit savoir pour se rendre.
func (m *MFA) FactorsOf(ctx context.Context, operatorID string) (SecondFactors, error) {
	const query = `
		SELECT o.mfa_totp_secret IS NOT NULL,
		       (SELECT count(*) FROM mfa_recovery_codes AS r WHERE r.operator_id = o.id)
		FROM operators AS o
		WHERE o.id = $1`

	var factors SecondFactors

	err := m.pool.QueryRow(ctx, query, operatorID).
		Scan(&factors.TOTPEnrolled, &factors.RecoveryCodesRemaining)
	if err != nil {
		return SecondFactors{}, fmt.Errorf("lire les facteurs de l'opérateur : %w", err)
	}

	return factors, nil
}

// ConsumeStep **est** l'anti-rejeu, et il tient dans son `WHERE`.
//
// `false` veut dire « ce pas a déjà servi ». La comparaison est stricte et non une égalité refusée :
// avec une fenêtre de dérive de ±1 pas, refuser seulement l'identique laisserait rejouer le code du
// pas précédent, qui est encore dans la fenêtre.
//
// **Une seule instruction, et c'est ce qui la rend atomique.** Lire puis écrire laisserait deux
// requêtes portant le même code passer toutes les deux : elles liraient la même valeur avant que
// l'une n'écrive. Ici elles se sérialisent sur le verrou de ligne, et la seconde n'affecte rien.
func (m *MFA) ConsumeStep(ctx context.Context, operatorID string, step int64) (bool, error) {
	const query = `
		UPDATE operators
		SET mfa_totp_last_step = $2
		WHERE id = $1
		  AND (mfa_totp_last_step IS NULL OR mfa_totp_last_step < $2)`

	tag, err := m.pool.Exec(ctx, query, operatorID, step)
	if err != nil {
		return false, fmt.Errorf("consommer le pas de second facteur : %w", err)
	}

	return tag.RowsAffected() > 0, nil
}

// Enroll pose le secret chiffré et **remplace** les codes de récupération. `false` dit qu'un second
// facteur était déjà en place et que `replace` ne l'autorisait pas.
//
// En une transaction, parce que les trois écritures ne sont pas séparables : un secret neuf avec les
// anciens codes laisserait entrer avec une liste que l'opérateur croit périmée, et des codes neufs
// sans secret ne déverrouilleraient rien.
//
// **`replace` est appliqué dans le `WHERE`, et c'est là que la garde vit.** L'appelant sait déjà, en
// entrant, si un facteur est en place — mais entre sa lecture et cette écriture il y a le tirage du
// secret et le hachage des codes, soit un quart de seconde dont l'appelant choisit le cadencement.
// Deux enrôlements concurrents lus tous deux « pas de facteur » écriraient tous deux, et le second
// écraserait le premier en silence. `RowsAffected()` tranche à l'instant de l'écriture.
//
// `mfa_totp_last_step` est remis à zéro : l'anti-rejeu porte sur les codes d'un secret, et le
// précédent vient de disparaître. Le garder pourrait refuser pendant une demi-minute le premier code
// du secret neuf, si l'ancien avait été validé par un téléphone en avance.
func (m *MFA) Enroll(ctx context.Context, operatorID, sealedSecret string, codeHashes []string,
	replace bool,
) (bool, error) {
	tx, err := m.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return false, fmt.Errorf("ouvrir la transaction d'enrôlement : %w", err)
	}

	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	tag, err := tx.Exec(ctx, `
		UPDATE operators SET mfa_totp_secret = $2, mfa_totp_last_step = NULL
		WHERE id = $1 AND ($3 OR mfa_totp_secret IS NULL)`,
		operatorID, sealedSecret, replace)
	if err != nil {
		return false, fmt.Errorf("écrire le secret de second facteur : %w", err)
	}

	if tag.RowsAffected() == 0 {
		return false, nil
	}

	if _, err = tx.Exec(ctx, `DELETE FROM mfa_recovery_codes WHERE operator_id = $1`, operatorID); err != nil {
		return false, fmt.Errorf("retirer les anciens codes de récupération : %w", err)
	}

	for _, hash := range codeHashes {
		_, err = tx.Exec(ctx,
			`INSERT INTO mfa_recovery_codes (operator_id, code_hash) VALUES ($1, $2)`, operatorID, hash)
		if err != nil {
			return false, fmt.Errorf("écrire un code de récupération : %w", err)
		}
	}

	if err = tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("valider l'enrôlement : %w", err)
	}

	return true, nil
}

// RecoveryCode est une ligne telle que la confrontation en a besoin : de quoi comparer, et de quoi
// supprimer celui qui a servi.
type RecoveryCode struct {
	ID   string
	Hash string
}

// RecoveryCodesOf rend **tous** les codes de l'opérateur. L'appelant les parcourt tous, y compris
// après en avoir trouvé un qui colle — la raison est écrite sur `mfa.MatchRecoveryCode`.
func (m *MFA) RecoveryCodesOf(ctx context.Context, operatorID string) ([]RecoveryCode, error) {
	const query = `
		SELECT id::text, code_hash FROM mfa_recovery_codes WHERE operator_id = $1 ORDER BY created_at, id`

	rows, err := m.pool.Query(ctx, query, operatorID)
	if err != nil {
		return nil, fmt.Errorf("lire les codes de récupération : %w", err)
	}

	defer rows.Close()

	var codes []RecoveryCode

	for rows.Next() {
		var code RecoveryCode

		if err = rows.Scan(&code.ID, &code.Hash); err != nil {
			return nil, fmt.Errorf("lire un code de récupération : %w", err)
		}

		codes = append(codes, code)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("lire les codes de récupération : %w", err)
	}

	return codes, nil
}

// ConsumeRecoveryCode **détruit** le code qui vient de servir. Il n'y a rien à réafficher, donc rien
// à fuir, et un code détruit ne se distingue pas d'un code qui n'a jamais existé.
//
// `false` dit qu'un autre l'a consommé d'abord : la suppression est le point de sérialisation, comme
// pour le pas de temps.
func (m *MFA) ConsumeRecoveryCode(ctx context.Context, id string) (bool, error) {
	tag, err := m.pool.Exec(ctx, `DELETE FROM mfa_recovery_codes WHERE id = $1`, id)
	if err != nil {
		return false, fmt.Errorf("consommer le code de récupération : %w", err)
	}

	return tag.RowsAffected() > 0, nil
}

// LockFor rend le verrou d'essais de second facteur qui pèse sur cet opérateur.
//
// **C'est ce qui borne la recherche exhaustive d'un code à six chiffres**, et le compteur par
// challenge ne le fait pas : une connexion réussie n'incrémente rien, donc qui détient le mot de
// passe émet autant de challenges qu'il veut. La raison longue est dans la migration 00007.
//
// Il est consulté **avant** toute dépense — avant le déchiffrement du secret, avant les argon2id du
// chemin de récupération — pour la même raison qu'au premier facteur : sinon le verrou protégerait le
// compte sans protéger le serveur.
func (m *MFA) LockFor(ctx context.Context, operatorID string, window time.Duration,
	threshold int,
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

	err := m.pool.QueryRow(ctx, query, operatorID, window.Seconds(), ScopeSecondFactor, threshold).
		Scan(&lock.Scope, &lock.Failures, &seconds)

	if errors.Is(err, pgx.ErrNoRows) {
		return Lock{}, nil
	}

	if err != nil {
		return Lock{}, fmt.Errorf("lire le verrou de second facteur : %w", err)
	}

	lock.Remaining = time.Duration(seconds * float64(time.Second))

	return lock, nil
}

// RecordFailure compte un échec de second facteur et rend le verrou qui en résulte.
//
// Une seule instruction, comme celle du premier facteur et pour la même raison : `c` désigne dans
// `DO UPDATE` la ligne telle que PostgreSQL la relit après avoir pris son verrou de ligne, donc deux
// instances qui entrent ensemble sur une ligne à trois échecs sortent à quatre puis cinq, jamais à
// quatre et quatre.
func (m *MFA) RecordFailure(ctx context.Context, operatorID string, window time.Duration,
	threshold int,
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

	var (
		lock    Lock
		seconds float64
	)

	err := m.pool.QueryRow(ctx, query, operatorID, window.Seconds(), ScopeSecondFactor).
		Scan(&lock.Scope, &lock.Failures, &seconds)
	if err != nil {
		return Lock{}, fmt.Errorf("compter l'échec de second facteur : %w", err)
	}

	if lock.Failures < threshold {
		return Lock{}, nil
	}

	lock.Remaining = time.Duration(seconds * float64(time.Second))

	return lock, nil
}

// ClearFailures efface le compteur après un second facteur franchi.
//
// **Il n'y a pas ici la dissymétrie du premier facteur**, qui n'efface que le compteur d'adresse et
// laisse celui de la source s'éteindre tout seul : là-bas, effacer la source aurait laissé quiconque
// détient un compte valide annuler la seconde dimension pour tout le monde. Ici la dimension est
// l'opérateur lui-même, et celui qui vient de franchir son second facteur est précisément celui à qui
// le compteur était destiné.
func (m *MFA) ClearFailures(ctx context.Context, operatorID string) error {
	const query = `DELETE FROM login_attempt_counters WHERE scope = $2 AND subject = $1`

	if _, err := m.pool.Exec(ctx, query, operatorID, ScopeSecondFactor); err != nil {
		return fmt.Errorf("effacer le compteur de second facteur : %w", err)
	}

	return nil
}

// PendingChallenge est un challenge de second facteur encore utilisable.
type PendingChallenge struct {
	ID string
	// OperatorID est ce à quoi l'appelant confronte la session présentée. Sans cette comparaison, le
	// challenge d'un opérateur élèverait la session d'un autre.
	OperatorID string
}

// LiveChallenge rend le challenge que porte cette empreinte, s'il vit encore.
//
// Trois conditions, et zéro ligne ne dit pas laquelle a manqué — ce qui est exactement ce que le
// refus rend au navigateur : un challenge inconnu, échu, déjà consommé ou qui a épuisé ses essais
// donnent la même réponse.
//
// Il **ne consomme rien** : une faute de frappe ne doit pas obliger à refaire toute la connexion.
func (m *MFA) LiveChallenge(ctx context.Context, tokenHash []byte) (PendingChallenge, bool, error) {
	const query = `
		SELECT id::text, operator_id::text
		FROM mfa_challenges
		WHERE token_hash = $1
		  AND consumed_at IS NULL
		  AND now() < expires_at`

	var challenge PendingChallenge

	err := m.pool.QueryRow(ctx, query, tokenHash).Scan(&challenge.ID, &challenge.OperatorID)

	if errors.Is(err, pgx.ErrNoRows) {
		return PendingChallenge{}, false, nil
	}

	if err != nil {
		return PendingChallenge{}, false, fmt.Errorf("lire le challenge de second facteur : %w", err)
	}

	return challenge, true, nil
}

// ConsumeChallenge marque le challenge servi, et **une seule fois** : `consumed_at IS NULL` dans le
// `WHERE` fait que deux requêtes concurrentes n'en élèvent qu'une.
//
// `UPDATE` et non `DELETE` — la raison est dans la migration 00004 : « déjà consommé » doit rester
// discernable de « n'a jamais existé » pour l'audit de step-025.
func (m *MFA) ConsumeChallenge(ctx context.Context, id string) (bool, error) {
	const query = `
		UPDATE mfa_challenges SET consumed_at = now()
		WHERE id = $1 AND consumed_at IS NULL AND now() < expires_at`

	tag, err := m.pool.Exec(ctx, query, id)
	if err != nil {
		return false, fmt.Errorf("consommer le challenge de second facteur : %w", err)
	}

	return tag.RowsAffected() > 0, nil
}
