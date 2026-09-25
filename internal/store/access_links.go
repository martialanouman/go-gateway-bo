package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	LinkActivation = "activation"
	LinkReset      = "reset"

	LinkQueued = "queued"
	LinkSent   = "sent"
	LinkFailed = "failed"

	ActivationTTL       = 72 * time.Hour
	ResetTTL            = time.Hour
	MaxDeliveryAttempts = 10

	accessTokenBytes = 32
)

var (
	ErrLinkInvalid       = errors.New("lien d'accès invalide")
	ErrOperatorDisabled  = errors.New("opérateur désactivé")
	ErrDeliveryAbandoned = errors.New("envoi du lien abandonné après 10 échecs")
)

type AccessLinkView struct {
	Kind  string
	State string
}

type PendingLink struct {
	Email       string
	DisplayName string
	Kind        string
	ExpiresAt   time.Time
}

type SendLink func(ctx context.Context, link PendingLink, token string) error

type AccessLinks struct {
	pool *pgxpool.Pool
}

func NewAccessLinks(pool *pgxpool.Pool) *AccessLinks {
	return &AccessLinks{pool: pool}
}

// requestLink remet la demande en file : un lien déjà parti est invalidé par l'effacement de son
// empreinte, et le type suit l'état du compte au moment de la demande.
func requestLink(ctx context.Context, tx pgx.Tx, operatorID string) (string, error) {
	var kind string

	err := tx.QueryRow(ctx, `
		INSERT INTO access_links (operator_id, kind)
		SELECT id, CASE WHEN password_hash IS NULL THEN 'activation' ELSE 'reset' END
		FROM operators WHERE id = $1::uuid
		ON CONFLICT (operator_id) DO UPDATE SET kind = excluded.kind, token_hash = NULL,
			expires_at = NULL, sent_at = NULL, attempts = 0, next_attempt_at = now()
		RETURNING kind`, operatorID).Scan(&kind)
	if err != nil {
		return "", fmt.Errorf("mettre le lien d'accès en file : %w", err)
	}

	return kind, nil
}

func linkTTL(kind string) time.Duration {
	if kind == LinkActivation {
		return ActivationTTL
	}

	return ResetTTL
}

// DeliverNext envoie la plus ancienne demande due. La ligne reste verrouillée pendant l'envoi : le
// jeton n'est écrit qu'après un envoi réussi, donc un échec ne laisse aucune empreinte d'un lien
// jamais reçu. Elle rend `true` même en échec, pour que la boucle passe à la ligne suivante.
func (l *AccessLinks) DeliverNext(ctx context.Context, send SendLink) (bool, error) {
	tx, err := l.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("ouvrir la transaction d'envoi : %w", err)
	}

	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	var (
		id   string
		now  time.Time
		link PendingLink
	)

	err = tx.QueryRow(ctx, `
		SELECT l.operator_id::text, l.kind, o.email, o.display_name, now()
		FROM access_links l JOIN operators o ON o.id = l.operator_id
		WHERE l.token_hash IS NULL AND l.attempts < $1 AND l.next_attempt_at <= now()
		  AND o.status = 'active'
		ORDER BY l.next_attempt_at LIMIT 1
		FOR UPDATE OF l SKIP LOCKED`, MaxDeliveryAttempts).Scan(&id, &link.Kind, &link.Email, &link.DisplayName, &now)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}

	if err != nil {
		return false, fmt.Errorf("prendre un lien d'accès en file : %w", err)
	}

	raw := make([]byte, accessTokenBytes)
	if _, err = rand.Read(raw); err != nil {
		return false, fmt.Errorf("tirer le jeton du lien : %w", err)
	}

	digest := sha256.Sum256(raw)
	link.ExpiresAt = now.Add(linkTTL(link.Kind))

	if sendErr := send(ctx, link, base64.RawURLEncoding.EncodeToString(raw)); sendErr != nil {
		return true, errors.Join(l.postpone(ctx, tx, id), sendErr)
	}

	_, err = tx.Exec(ctx, `
		UPDATE access_links SET token_hash = $2, sent_at = now(), expires_at = $3
		WHERE operator_id = $1::uuid`, id, digest[:], link.ExpiresAt)
	if err != nil {
		return true, fmt.Errorf("enregistrer le lien envoyé : %w", err)
	}

	if err = tx.Commit(ctx); err != nil {
		return true, fmt.Errorf("valider l'envoi du lien : %w", err)
	}

	return true, nil
}

func (l *AccessLinks) postpone(ctx context.Context, tx pgx.Tx, id string) error {
	var attempts int

	err := tx.QueryRow(ctx, `
		UPDATE access_links SET attempts = attempts + 1,
			next_attempt_at = now() + least(interval '30 seconds' * power(2, attempts), interval '10 minutes')
		WHERE operator_id = $1::uuid
		RETURNING attempts`, id).Scan(&attempts)
	if err != nil {
		return fmt.Errorf("repousser l'envoi du lien : %w", err)
	}

	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("valider le report de l'envoi : %w", err)
	}

	if attempts >= MaxDeliveryAttempts {
		return ErrDeliveryAbandoned
	}

	return nil
}

const usableLink = `l.token_hash = $1 AND l.expires_at > now() AND o.id = l.operator_id AND o.status = 'active'`

// Valid sert à refuser avant le hachage argon2id, sur une route que personne n'authentifie.
func (l *AccessLinks) Valid(ctx context.Context, digest []byte) (bool, error) {
	var valid bool

	err := l.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM access_links l, operators o WHERE `+usableLink+`)`, digest).Scan(&valid)
	if err != nil {
		return false, fmt.Errorf("vérifier le lien d'accès : %w", err)
	}

	return valid, nil
}

// Consume pose le mot de passe et, pour un reset, retire les facteurs et ferme les sessions : rien de
// tout cela ne change avant l'usage du lien.
func (l *AccessLinks) Consume(ctx context.Context, digest []byte, passwordHash string, event Event) error {
	return inTx(ctx, l.pool, func(tx pgx.Tx) error {
		var id, kind string

		err := tx.QueryRow(ctx, `
			DELETE FROM access_links l USING operators o WHERE `+usableLink+`
			RETURNING l.operator_id::text, l.kind`, digest).Scan(&id, &kind)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrLinkInvalid
		}

		if err != nil {
			return fmt.Errorf("consommer le lien d'accès : %w", err)
		}

		if _, err = tx.Exec(ctx, `UPDATE operators SET password_hash = $2 WHERE id = $1::uuid`, id,
			passwordHash); err != nil {
			return fmt.Errorf("enregistrer le mot de passe : %w", err)
		}

		if kind == LinkReset {
			if err = clearSecondFactors(ctx, tx, id); err != nil {
				return err
			}

			if err = revokeSessions(ctx, tx, id); err != nil {
				return err
			}
		}

		event.OperatorID = id
		event.TargetID = id

		return record(ctx, tx, event)
	})
}

func KeepDeliveringAccessLinks(ctx context.Context, links *AccessLinks, every time.Duration, send SendLink,
	report func(error),
) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for {
				delivered, err := links.DeliverNext(ctx, send)
				if err != nil && ctx.Err() == nil {
					report(err)
				}

				// Sur erreur, la ligne peut être restée due : la reprendre enverrait un courriel par
				// tour. Aucun test ne rougit sans `err != nil` : un commit qui échoue après l'envoi ne
				// se fabrique pas sans couture dans le store.
				if !delivered || err != nil || ctx.Err() != nil {
					break
				}
			}
		}
	}
}

// AccessTokenDigest rend l'empreinte d'un jeton bien formé ; un jeton d'une autre forme ne désigne
// aucune ligne et n'a pas à atteindre la base.
func AccessTokenDigest(token string) ([]byte, bool) {
	raw, err := base64.RawURLEncoding.Strict().DecodeString(token)
	if err != nil || len(raw) != accessTokenBytes {
		return nil, false
	}

	digest := sha256.Sum256(raw)

	return digest[:], true
}

// clearSecondFactors retire tout ce qui franchit le second facteur, et le verrou d'essais avec, sans
// quoi le titulaire ne pourrait pas se réenrôler.
func clearSecondFactors(ctx context.Context, tx pgx.Tx, operatorID string) error {
	for _, cleanup := range []string{
		`UPDATE operators SET mfa_totp_secret = NULL, mfa_totp_last_step = NULL WHERE id = $1::uuid`,
		`DELETE FROM mfa_recovery_codes WHERE operator_id = $1::uuid`,
		`DELETE FROM webauthn_credentials WHERE operator_id = $1::uuid`,
		`DELETE FROM login_attempt_counters WHERE scope = '` + ScopeSecondFactor + `' AND subject = $1::text`,
	} {
		if _, err := tx.Exec(ctx, cleanup, operatorID); err != nil {
			return fmt.Errorf("retirer le second facteur : %w", err)
		}
	}

	return nil
}
