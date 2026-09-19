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
// sert des milliers de requêtes là où `Migrate` et `Seed` s'exécutent une fois par déploiement.
type Logins struct {
	pool *pgxpool.Pool
	// emails porte la réservation de l'adresse (`Reserve`) et son effacement (`ClearFailures`).
	// sources porte le seul geste que la source connaisse : compter un échec, jamais réserver — la
	// réserver verrouillerait tout un bureau derrière une IP partagée dès qu'un seul poste y multiplie
	// les essais.
	emails  *Counter
	sources *Counter
}

func NewLogins(pool *pgxpool.Pool) *Logins {
	return &Logins{
		pool:    pool,
		emails:  NewCounter(pool, ScopeEmail),
		sources: NewCounter(pool, ScopeSource),
	}
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
// `ScopeSecondFactor` est comptée par `mfa.go`, sur l'identifiant de l'opérateur : elle partage cette
// table et son mécanisme d'incrément atomique plutôt que d'en avoir une jumelle.
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

// Reserve réserve un essai sur l'adresse soumise, avant tout hachage. La dimension **source** n'est
// pas réservée : elle ne compte que les échecs, sans quoi cinq connexions réussies depuis une même
// IP verrouilleraient tout un bureau.
func (l *Logins) Reserve(ctx context.Context, emailKey string, window time.Duration, threshold int,
) (Lock, error) {
	return l.emails.reserve(ctx, emailKey, window, threshold)
}

// SourceLock rend le verrou qui pèse sur une source, en lecture seule et **avant** tout hachage.
//
// La source n'est pas réservée — la réservation verrouillerait un bureau derrière une IP partagée —
// donc elle se lit, puis se compte sur le chemin d'échec. Deux rafales entrées ensemble peuvent
// franchir ce contrôle, et c'est assumé : ce que la source borne est le balayage de plusieurs
// adresses, pas la rafale sur une seule, que la réservation de l'adresse arrête.
func (l *Logins) SourceLock(ctx context.Context, sourceKey string, window time.Duration,
	threshold int,
) (Lock, error) {
	return l.sources.lockFor(ctx, sourceKey, window, threshold)
}

// RecordSourceFailure compte un échec sur la seule dimension de la source. L'adresse ne s'y ajoute
// pas : `Login` la réserve avant de hacher (`Reserve`), et l'y recompter au refus doublerait son
// incrément, donc diviserait son plafond par deux.
func (l *Logins) RecordSourceFailure(ctx context.Context, sourceKey string, window time.Duration,
	threshold int,
) (Lock, error) {
	return l.sources.count(ctx, sourceKey, window, threshold)
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
