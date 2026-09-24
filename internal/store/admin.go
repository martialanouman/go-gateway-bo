package store

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
)

// Les refus de l'administration. Chacun a sa réponse au contrat ; aucun n'est une panne.
var (
	ErrOperatorUnknown = errors.New("opérateur inconnu")
	ErrRoleUnknown     = errors.New("rôle inconnu")
	// ErrUnknownReference : un rôle ou une clé désignés dans le corps n'existent pas.
	ErrUnknownReference = errors.New("référence inconnue")
	ErrEmailTaken       = errors.New("adresse déjà portée")
	ErrRoleNameTaken    = errors.New("nom de rôle déjà porté")
	ErrSelfLockout      = errors.New("le geste enfermerait son auteur dehors")
	ErrDefaultRole      = errors.New("rôle par défaut")
)

// RoleHeldError refuse la suppression d'un rôle détenu, en nommant ses détenteurs.
type RoleHeldError struct {
	Holders []string
}

func (e RoleHeldError) Error() string {
	return "rôle détenu par " + strings.Join(e.Holders, ", ")
}

// lockoutKeys sont les deux clés sans lesquelles plus personne n'administre l'installation autrement
// qu'en écrivant dans la base.
var lockoutKeys = []string{string(permissions.OperatorsManage), string(permissions.RolesManage)}

type OperatorView struct {
	ID                   string
	Email                string
	DisplayName          string
	Status               string
	RoleIDs              []string
	RoleNames            []string
	SecondFactorEnrolled bool
	AccessLink           *AccessLinkView
}

type RoleView struct {
	ID          string
	Name        string
	Description string
	IsDefault   bool
	Permissions []string
	Holders     []string
}

// Administration porte les gestes de `operators:manage` et `roles:manage`. Chaque mutation écrit son
// audit dans sa propre transaction.
type Administration struct {
	pool *pgxpool.Pool
}

func NewAdministration(pool *pgxpool.Pool) *Administration {
	return &Administration{pool: pool}
}

// querier couvre un pool et une transaction, pour qu'une mutation relise sa propre écriture.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Les identifiants reçus sont comparés en texte : un chemin d'URL qui n'est pas un UUID ne désigne
// aucune ligne, au lieu de faire échouer le typage en base (même arbitrage que `Webauthn.Remove`).
const operatorsQuery = `
	SELECT o.id::text, o.email, o.display_name, o.status,
	       coalesce(array_agg(r.id::text ORDER BY r.name) FILTER (WHERE r.id IS NOT NULL), '{}'),
	       coalesce(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.id IS NOT NULL), '{}'),
	       o.mfa_totp_secret IS NOT NULL
	           OR EXISTS (SELECT 1 FROM webauthn_credentials c WHERE c.operator_id = o.id),
	       l.kind,
	       CASE WHEN l.token_hash IS NOT NULL THEN 'sent'
	            WHEN l.attempts >= 10 THEN 'failed'
	            ELSE 'queued' END
	FROM operators o
	LEFT JOIN operator_roles orl ON orl.operator_id = o.id
	LEFT JOIN roles r ON r.id = orl.role_id
	LEFT JOIN access_links l ON l.operator_id = o.id
	WHERE $1 = '' OR o.id::text = $1
	GROUP BY o.id, l.operator_id
	ORDER BY lower(o.email)`

func operators(ctx context.Context, q querier, id string) ([]OperatorView, error) {
	rows, err := q.Query(ctx, operatorsQuery, id)
	if err != nil {
		return nil, fmt.Errorf("lire les opérateurs : %w", err)
	}

	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (OperatorView, error) {
		var (
			v           OperatorView
			kind, state *string
		)

		err := row.Scan(&v.ID, &v.Email, &v.DisplayName, &v.Status, &v.RoleIDs, &v.RoleNames,
			&v.SecondFactorEnrolled, &kind, &state)
		if kind != nil {
			v.AccessLink = &AccessLinkView{Kind: *kind, State: *state}
		}

		return v, err
	})
}

func operator(ctx context.Context, q querier, id string) (OperatorView, error) {
	found, err := operators(ctx, q, id)
	if err != nil {
		return OperatorView{}, err
	}

	if len(found) == 0 {
		return OperatorView{}, ErrOperatorUnknown
	}

	return found[0], nil
}

func (a *Administration) Operators(ctx context.Context) ([]OperatorView, error) {
	return operators(ctx, a.pool, "")
}

// CreateOperator crée un compte actif, sans rôle ni mot de passe, et met son lien d'activation en file.
// `event.TargetID` est posé ici, l'identifiant n'existant qu'après l'insertion.
func (a *Administration) CreateOperator(ctx context.Context, email, displayName string, event Event,
) (OperatorView, error) {
	var created OperatorView

	err := inTx(ctx, a.pool, func(tx pgx.Tx) error {
		var id string

		err := tx.QueryRow(ctx,
			`INSERT INTO operators (email, display_name) VALUES ($1, $2) RETURNING id::text`,
			email, displayName).Scan(&id)
		if isViolation(err, uniqueViolation) {
			return ErrEmailTaken
		}

		if err != nil {
			return fmt.Errorf("créer l'opérateur : %w", err)
		}

		if _, err = requestLink(ctx, tx, id); err != nil {
			return err
		}

		if created, err = operator(ctx, tx, id); err != nil {
			return err
		}

		event.TargetID = id
		event.After = NewFields().Text("email", email)

		return record(ctx, tx, event)
	})

	return created, err
}

// SetOperatorStatus désactive ou réactive. Désactiver ferme ses sessions dans la même transaction :
// `Sessions.Resolve` les refuse déjà tant que le compte est désactivé, mais une réactivation les
// rendrait vivantes.
func (a *Administration) SetOperatorStatus(ctx context.Context, id, status string, event Event,
) (OperatorView, error) {
	var updated OperatorView

	err := inTx(ctx, a.pool, func(tx pgx.Tx) error {
		var before string

		err := tx.QueryRow(ctx, `
			UPDATE operators o SET status = $2
			FROM (SELECT id, status FROM operators WHERE id::text = $1 FOR UPDATE) old
			WHERE o.id = old.id
			RETURNING old.status`, id, status).Scan(&before)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOperatorUnknown
		}

		if err != nil {
			return fmt.Errorf("changer le statut de l'opérateur : %w", err)
		}

		if status != StatusActive {
			if err = revokeSessions(ctx, tx, id); err != nil {
				return err
			}
		}

		if updated, err = operator(ctx, tx, id); err != nil {
			return err
		}

		event.TargetID = updated.ID
		event.Before = NewFields().Text("status", before)
		event.After = NewFields().Text("status", status)

		return record(ctx, tx, event)
	})

	return updated, err
}

// SetOperatorRoles remplace l'ensemble des rôles détenus.
func (a *Administration) SetOperatorRoles(ctx context.Context, actorID, id string, roleIDs []string,
	event Event,
) (OperatorView, error) {
	var updated OperatorView

	err := inTx(ctx, a.pool, func(tx pgx.Tx) error {
		// Deux attributions concurrentes sur le même opérateur s'additionneraient sans ce verrou : la
		// seconde efface avant de voir ce que la première a posé.
		// Aucun test ne rougit si cette ligne disparaît, ce qui a été vérifié : la course ne se
		// fabrique qu'en tenant une transaction ouverte, et le verrou est le seul effet observable.
		if _, err := tx.Exec(ctx, `SELECT 1 FROM operators WHERE id::text = $1 FOR UPDATE`, id); err != nil {
			return fmt.Errorf("verrouiller l'opérateur : %w", err)
		}

		before, err := operator(ctx, tx, id)
		if err != nil {
			return err
		}

		return withoutLockout(ctx, tx, actorID, func() error {
			if _, err := tx.Exec(ctx, `DELETE FROM operator_roles WHERE operator_id = $1`, before.ID); err != nil {
				return fmt.Errorf("retirer les rôles : %w", err)
			}

			wanted := slices.Compact(slices.Sorted(slices.Values(roleIDs)))

			tag, err := tx.Exec(ctx, `
				INSERT INTO operator_roles (operator_id, role_id)
				SELECT $1, r.id FROM roles r WHERE r.id::text = ANY($2)`, before.ID, wanted)
			if isViolation(err, foreignKeyViolation) {
				return ErrUnknownReference
			}

			if err != nil {
				return fmt.Errorf("attribuer les rôles : %w", err)
			}

			if int(tag.RowsAffected()) != len(wanted) {
				return ErrUnknownReference
			}

			if updated, err = operator(ctx, tx, id); err != nil {
				return err
			}

			event.TargetID = updated.ID
			event.Before = NewFields().Text("roles", strings.Join(before.RoleNames, ","))
			event.After = NewFields().Text("roles", strings.Join(updated.RoleNames, ","))

			return record(ctx, tx, event)
		})
	})

	return updated, err
}

// RequestAccessLink met en file un lien d'activation ou de reset, selon que le compte a déjà un mot de
// passe. Le précédent lien, parti ou non, cesse de valoir.
func (a *Administration) RequestAccessLink(ctx context.Context, id string, event Event) error {
	return inTx(ctx, a.pool, func(tx pgx.Tx) error {
		var operatorID, status string

		err := tx.QueryRow(ctx, `SELECT id::text, status FROM operators WHERE id::text = $1 FOR UPDATE`, id).
			Scan(&operatorID, &status)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOperatorUnknown
		}

		if err != nil {
			return fmt.Errorf("verrouiller l'opérateur : %w", err)
		}

		if status != StatusActive {
			return ErrOperatorDisabled
		}

		kind, err := requestLink(ctx, tx, operatorID)
		if err != nil {
			return err
		}

		event.TargetID = operatorID
		event.After = NewFields().Text("kind", kind)

		return record(ctx, tx, event)
	})
}

// ResetSecondFactors disparaît avec sa route, au commit qui retire celle-ci du contrat.
func (a *Administration) ResetSecondFactors(ctx context.Context, id string, event Event) error {
	return inTx(ctx, a.pool, func(tx pgx.Tx) error {
		var operatorID string

		err := tx.QueryRow(ctx, `SELECT id::text FROM operators WHERE id::text = $1 FOR UPDATE`, id).Scan(&operatorID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOperatorUnknown
		}

		if err != nil {
			return fmt.Errorf("verrouiller l'opérateur : %w", err)
		}

		if err = clearSecondFactors(ctx, tx, operatorID); err != nil {
			return err
		}

		if err = revokeSessions(ctx, tx, operatorID); err != nil {
			return err
		}

		event.TargetID = operatorID

		return record(ctx, tx, event)
	})
}

func revokeSessions(ctx context.Context, tx pgx.Tx, operatorID string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE operator_id::text = $1`, operatorID); err != nil {
		return fmt.Errorf("fermer les sessions de l'opérateur : %w", err)
	}

	return nil
}

const rolesQuery = `
	SELECT r.id::text, r.name, r.description, r.is_default,
	       coalesce((SELECT array_agg(rp.permission_key ORDER BY rp.permission_key)
	                 FROM role_permissions rp WHERE rp.role_id = r.id), '{}'),
	       coalesce((SELECT array_agg(o.email ORDER BY lower(o.email))
	                 FROM operator_roles orl JOIN operators o ON o.id = orl.operator_id
	                 WHERE orl.role_id = r.id), '{}')
	FROM roles r
	WHERE $1 = '' OR r.id::text = $1
	ORDER BY r.is_default DESC, r.name`

func roles(ctx context.Context, q querier, id string) ([]RoleView, error) {
	rows, err := q.Query(ctx, rolesQuery, id)
	if err != nil {
		return nil, fmt.Errorf("lire les rôles : %w", err)
	}

	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (RoleView, error) {
		var v RoleView
		err := row.Scan(&v.ID, &v.Name, &v.Description, &v.IsDefault, &v.Permissions, &v.Holders)

		return v, err
	})
}

func role(ctx context.Context, q querier, id string) (RoleView, error) {
	found, err := roles(ctx, q, id)
	if err != nil {
		return RoleView{}, err
	}

	if len(found) == 0 {
		return RoleView{}, ErrRoleUnknown
	}

	return found[0], nil
}

func (a *Administration) Roles(ctx context.Context) ([]RoleView, error) {
	return roles(ctx, a.pool, "")
}

func (a *Administration) CreateRole(ctx context.Context, name, description string, keys []string,
	event Event,
) (RoleView, error) {
	var created RoleView

	err := inTx(ctx, a.pool, func(tx pgx.Tx) error {
		var id string

		err := tx.QueryRow(ctx, `
			INSERT INTO roles (name, description, created_by) VALUES ($1, $2, nullif($3, '')::uuid)
			RETURNING id::text`, name, description, event.OperatorID).Scan(&id)
		if isViolation(err, uniqueViolation) {
			return ErrRoleNameTaken
		}

		if err != nil {
			return fmt.Errorf("créer le rôle : %w", err)
		}

		if err = grant(ctx, tx, id, keys); err != nil {
			return err
		}

		if created, err = role(ctx, tx, id); err != nil {
			return err
		}

		event.TargetID = id
		event.After = NewFields().Text("permissions", strings.Join(created.Permissions, ","))

		return record(ctx, tx, event)
	})

	return created, err
}

// UpdateRole remplace la description et les permissions d'un rôle personnalisé. Les rôles par
// défaut sont refusés : le seed les réécrit à chaque déploiement, une édition serait défaite.
func (a *Administration) UpdateRole(ctx context.Context, actorID, id, description string, keys []string,
	event Event,
) (RoleView, error) {
	var updated RoleView

	err := inTx(ctx, a.pool, func(tx pgx.Tx) error {
		before, err := customRoleForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}

		return withoutLockout(ctx, tx, actorID, func() error {
			_, err := tx.Exec(ctx, `UPDATE roles SET description = $2 WHERE id = $1::uuid`, before.ID, description)
			if err != nil {
				return fmt.Errorf("modifier le rôle : %w", err)
			}

			if _, err = tx.Exec(ctx, `DELETE FROM role_permissions WHERE role_id = $1::uuid`, before.ID); err != nil {
				return fmt.Errorf("retirer les permissions du rôle : %w", err)
			}

			if err = grant(ctx, tx, before.ID, keys); err != nil {
				return err
			}

			if updated, err = role(ctx, tx, before.ID); err != nil {
				return err
			}

			event.TargetID = before.ID
			event.Before = NewFields().Text("permissions", strings.Join(before.Permissions, ","))
			event.After = NewFields().Text("permissions", strings.Join(updated.Permissions, ","))

			return record(ctx, tx, event)
		})
	})

	return updated, err
}

// DeleteRole supprime un rôle personnalisé que personne ne détient. Le verrou de ligne met en file
// toute attribution concurrente, qui prend un `FOR KEY SHARE` sur le même rôle.
func (a *Administration) DeleteRole(ctx context.Context, id string, event Event) error {
	return inTx(ctx, a.pool, func(tx pgx.Tx) error {
		found, err := customRoleForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}

		if len(found.Holders) > 0 {
			return RoleHeldError{Holders: found.Holders}
		}

		if _, err = tx.Exec(ctx, `DELETE FROM roles WHERE id = $1::uuid`, found.ID); err != nil {
			return fmt.Errorf("supprimer le rôle : %w", err)
		}

		event.TargetID = found.ID
		event.Before = NewFields().Text("name", found.Name)

		return record(ctx, tx, event)
	})
}

func customRoleForUpdate(ctx context.Context, tx pgx.Tx, id string) (RoleView, error) {
	var locked string

	err := tx.QueryRow(ctx, `SELECT id::text FROM roles WHERE id::text = $1 FOR UPDATE`, id).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return RoleView{}, ErrRoleUnknown
	}

	if err != nil {
		return RoleView{}, fmt.Errorf("verrouiller le rôle : %w", err)
	}

	found, err := role(ctx, tx, locked)
	if err != nil {
		return RoleView{}, err
	}

	if found.IsDefault {
		return RoleView{}, ErrDefaultRole
	}

	return found, nil
}

func grant(ctx context.Context, tx pgx.Tx, roleID string, keys []string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO role_permissions (role_id, permission_key)
		SELECT $1::uuid, key FROM unnest($2::text[]) AS key
		ON CONFLICT DO NOTHING`, roleID, keys)
	if isViolation(err, foreignKeyViolation) {
		return ErrUnknownReference
	}

	if err != nil {
		return fmt.Errorf("accorder les permissions : %w", err)
	}

	return nil
}

// withoutLockout refuse tout geste après lequel son auteur ne détiendrait plus une clé de
// `lockoutKeys` qu'il détenait avant. Le contrôle lit l'état d'après, dans la transaction : il couvre
// donc le retrait direct d'un rôle comme l'édition du rôle qu'on détient.
//
// ponytail: deux administrateurs qui se retirent mutuellement leurs droits, ou se désactivent
// mutuellement, en même temps peuvent encore vider l'installation ; un verrou consultatif global
// pris par ces gestes fermerait la course si elle s'observe.
func withoutLockout(ctx context.Context, tx pgx.Tx, actorID string, change func() error) error {
	before, err := lockoutKeysHeld(ctx, tx, actorID)
	if err != nil {
		return err
	}

	if err = change(); err != nil {
		return err
	}

	after, err := lockoutKeysHeld(ctx, tx, actorID)
	if err != nil {
		return err
	}

	for _, key := range before {
		if !slices.Contains(after, key) {
			return ErrSelfLockout
		}
	}

	return nil
}

func lockoutKeysHeld(ctx context.Context, tx pgx.Tx, operatorID string) ([]string, error) {
	var held []string

	err := tx.QueryRow(ctx, `
		SELECT coalesce(array_agg(DISTINCT rp.permission_key), '{}')
		FROM operator_roles orl JOIN role_permissions rp ON rp.role_id = orl.role_id
		WHERE orl.operator_id::text = $1 AND rp.permission_key = ANY($2)`,
		operatorID, lockoutKeys).Scan(&held)
	if err != nil {
		return nil, fmt.Errorf("lire les clés d'administration de l'auteur : %w", err)
	}

	return held, nil
}

const foreignKeyViolation = "23503"

func isViolation(err error, code string) bool {
	var pgErr *pgconn.PgError

	return errors.As(err, &pgErr) && pgErr.Code == code
}
