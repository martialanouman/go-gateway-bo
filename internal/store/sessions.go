package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sessions porte les cinq gestes de la session : l'ouvrir, la résoudre, l'élever, la fermer, et lire
// ce que son opérateur a le droit de faire.
//
// Aucune crypto ici, aucun HTTP : le jeton n'y entre que sous forme d'empreinte, et la politique des
// deux échéances vit dans `internal/session`. Ce paquet ne connaît que le SQL.
type Sessions struct {
	pool *pgxpool.Pool
}

func NewSessions(pool *pgxpool.Pool) *Sessions {
	return &Sessions{pool: pool}
}

// Session est ce qu'une session vivante apprend à l'appelant. Ni le jeton, ni son empreinte : les
// rendre ferait traverser à un secret une frontière qu'il n'a aucune raison de franchir.
type Session struct {
	// ID est stable pour toute la vie de la session, y compris à travers l'élévation. C'est ce à quoi
	// step-024 liera ses défis WebAuthn.
	ID         string
	OperatorID string
	// ExpiresAt est l'échéance **absolue**. La glissante n'est pas rendue : elle se déplace à chaque
	// requête et serait périmée à l'instant où l'appelant la lit.
	ExpiresAt time.Time
	// Elevated dit si le second facteur a été vérifié dans cette session.
	Elevated bool
}

// Grants est ce que `GET /auth/me` compose : de quoi nommer l'opérateur, et l'union des permissions
// de ses rôles. Aucun rôle n'y figure — la spec interdit le contrôle de rôle côté client, et une
// liste de rôles rendue au navigateur invite à l'y réintroduire.
type Grants struct {
	Email       string
	DisplayName string
	// Permissions est l'union, sans doublon et triée. Vide est un état atteignable : un opérateur
	// sans rôle existe dès step-029.
	Permissions []string
}

// Create ouvre une session et rend son échéance absolue.
//
// L'échéance est calculée par le serveur de base, comme les verrous de 00004 : deux instances aux
// horloges décalées ouvriraient sinon des sessions qui n'expirent pas au même moment.
func (s *Sessions) Create(ctx context.Context, operatorID string, tokenHash []byte,
	lifetime time.Duration,
) (Session, error) {
	const query = `
		INSERT INTO sessions (operator_id, token_hash, expires_at)
		VALUES ($1, $2, now() + make_interval(secs => $3))
		RETURNING id::text, expires_at`

	session := Session{OperatorID: operatorID}

	err := s.pool.QueryRow(ctx, query, operatorID, tokenHash, lifetime.Seconds()).
		Scan(&session.ID, &session.ExpiresAt)
	if err != nil {
		return Session{}, fmt.Errorf("ouvrir la session : %w", err)
	}

	return session, nil
}

// Resolve rend la session vivante que porte cette empreinte, et fait glisser sa fenêtre au passage.
//
// Les deux échéances sont vérifiées ensemble ; l'arbitrage qui les fixe est sur
// `session.AbsoluteLifetime` et `session.IdleWindow`.
//
// Une ligne qui échoue au `WHERE` n'est pas touchée : un refus ne repousse jamais rien, donc une
// session morte ne ressuscite pas en se faisant refuser.
//
// Le statut de l'opérateur est vérifié ici plutôt qu'après coup : hors du `WHERE`, la session d'un
// compte désactivé verrait sa fenêtre glissante repoussée par chacune de ses tentatives. La
// révocation **active** au moment de la désactivation appartient à step-029.
//
// Zéro ligne rendue ne distingue pas « jamais existé », « échue », « oisive » et « compte
// désactivé » — ce qui est exactement ce qu'on rend au navigateur.
func (s *Sessions) Resolve(ctx context.Context, tokenHash []byte, idle time.Duration) (Session,
	bool, error,
) {
	const query = `
		UPDATE sessions AS s
		SET last_seen_at = now()
		FROM operators AS o
		WHERE o.id = s.operator_id
		  AND o.status = $3
		  AND s.token_hash = $1
		  AND now() < s.expires_at
		  AND now() < s.last_seen_at + make_interval(secs => $2)
		RETURNING s.id::text, s.operator_id::text, s.expires_at, s.elevated_at IS NOT NULL`

	var session Session

	err := s.pool.QueryRow(ctx, query, tokenHash, idle.Seconds(), StatusActive).
		Scan(&session.ID, &session.OperatorID, &session.ExpiresAt, &session.Elevated)

	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, false, nil
	}

	if err != nil {
		return Session{}, false, fmt.Errorf("résoudre la session : %w", err)
	}

	return session, true, nil
}

// Elevate marque le second facteur vérifié **et régénère le jeton**, contre la fixation de session :
// sans ça, un jeton obtenu avant le second facteur reste valable après.
//
// La ligne, elle, est conservée — step-024 liera ses défis à `id`, qui ne doit pas disparaître sous
// eux.
//
// `expires_at` n'est pas repoussée : l'élévation n'achète pas du temps, elle change ce que la session
// autorise.
//
// Aucun appelant en production avant step-023 — la raison est écrite sur `session.Manager.Elevate`.
func (s *Sessions) Elevate(ctx context.Context, tokenHash, renewedTokenHash []byte,
	idle time.Duration,
) (bool, error) {
	const query = `
		UPDATE sessions AS s
		SET token_hash = $2, elevated_at = now(), last_seen_at = now()
		FROM operators AS o
		WHERE o.id = s.operator_id
		  AND o.status = $4
		  AND s.token_hash = $1
		  AND now() < s.expires_at
		  AND now() < s.last_seen_at + make_interval(secs => $3)`

	tag, err := s.pool.Exec(ctx, query, tokenHash, renewedTokenHash, idle.Seconds(), StatusActive)
	if err != nil {
		return false, fmt.Errorf("élever la session : %w", err)
	}

	return tag.RowsAffected() > 0, nil
}

// Delete ferme la session. C'est ce que le logout fait vraiment : expirer le cookie ne protège rien,
// il suffit de le rejouer.
//
// Par identifiant et non par empreinte : l'appelant vient de résoudre la session, donc il tient déjà
// sa clé primaire. Repasser par l'empreinte demanderait de resceller le cookie pour retrouver ce
// qu'on a sous la main, et fermerait « la session que porte ce jeton » là où on veut fermer « la
// session qu'on vient de résoudre ».
func (s *Sessions) Delete(ctx context.Context, id string) error {
	const query = `DELETE FROM sessions WHERE id = $1`

	if _, err := s.pool.Exec(ctx, query, id); err != nil {
		return fmt.Errorf("fermer la session : %w", err)
	}

	return nil
}

// GrantsOf rend l'union des permissions des rôles détenus, sans doublon.
//
// `LEFT JOIN` et non `JOIN` : un opérateur sans aucun rôle rend un ensemble vide, jamais une absence.
// Confondre les deux ferait dire « pas de session » là où le fait est « aucune permission ».
//
// L'ordre est explicite. Le tri qu'`array_agg(DISTINCT …)` produit en pratique est un détail
// d'implémentation, et c'est un ordre stable qui rend le corps comparable d'une réponse à l'autre.
//
// step-025 lira la même union, au même endroit, pour garder chaque route.
func (s *Sessions) GrantsOf(ctx context.Context, operatorID string) (Grants, error) {
	const query = `
		SELECT o.email, o.display_name,
		       COALESCE(
		           array_agg(DISTINCT rp.permission_key ORDER BY rp.permission_key)
		               FILTER (WHERE rp.permission_key IS NOT NULL),
		           '{}')
		FROM operators AS o
		LEFT JOIN operator_roles AS orl ON orl.operator_id = o.id
		LEFT JOIN role_permissions AS rp ON rp.role_id = orl.role_id
		WHERE o.id = $1
		GROUP BY o.id`

	var grants Grants

	err := s.pool.QueryRow(ctx, query, operatorID).
		Scan(&grants.Email, &grants.DisplayName, &grants.Permissions)
	if err != nil {
		return Grants{}, fmt.Errorf("lire les permissions de l'opérateur : %w", err)
	}

	return grants, nil
}
