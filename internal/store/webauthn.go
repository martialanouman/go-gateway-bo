package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Webauthn porte les gestes des passkeys : lire ce qu'un opérateur détient, en enregistrer une, en
// retirer une, et faire vivre les défis des deux cérémonies.
//
// Aucune crypto ici, aucune bibliothèque WebAuthn : les octets d'une clé publique et l'état d'une
// cérémonie y entrent et en sortent tels quels. Ce paquet ne connaît que le SQL.
type Webauthn struct {
	pool *pgxpool.Pool
}

func NewWebauthn(pool *pgxpool.Pool) *Webauthn {
	return &Webauthn{pool: pool}
}

// Passkey est une ligne de `webauthn_credentials`. Rien n'y est secret : la clé est **publique**, et
// c'est ce qui dispense cette table du chiffrement au repos qu'exige le secret TOTP.
type Passkey struct {
	// ID est celui de la ligne, et c'est par lui que le client demande un retrait — jamais par
	// `CredentialID`, qui est long, binaire, et n'a aucune raison de traverser une URL.
	ID             string
	CredentialID   []byte
	PublicKey      []byte
	SignCount      uint32
	AAGUID         []byte
	Transports     []string
	Attachment     string
	UserVerified   bool
	BackupEligible bool
	BackupState    bool
}

// PasskeyOwner est ce qu'une cérémonie a besoin de savoir de l'opérateur : de quoi le nommer dans
// l'appareil, et ce qu'il détient déjà.
type PasskeyOwner struct {
	ID          string
	Email       string
	DisplayName string
	Passkeys    []Passkey
}

// Ceremony est un défi en vol : son identifiant, et l'état que la bibliothèque exige de retrouver
// intact pour finir. Le contenu de `Data` ne regarde pas ce paquet.
type Ceremony struct {
	ID   string
	Data []byte
}

// Les deux objets d'une cérémonie. Un défi d'assertion qui finirait un enregistrement laisserait
// enrôler une passkey neuve sans rien prouver : c'est pourquoi ils ne se confondent pas, et pourquoi
// la colonne porte un `CHECK`.
const (
	CeremonyRegistration = "registration"
	CeremonyAssertion    = "assertion"
)

// PasskeyRemoval dit ce qu'un retrait a fait. Trois issues et non deux : « je n'ai rien trouvé » et
// « je refuse de vous enfermer dehors » ne se disent pas de la même façon à l'opérateur, et les
// confondre lui ferait chercher une passkey qui existe.
type PasskeyRemoval int

const (
	PasskeyRemoved PasskeyRemoval = iota
	PasskeyUnknown
	PasskeyIsLastFactor
)

// OwnerOf rend l'opérateur **actif** et ses passkeys, dans l'ordre de leur enregistrement.
//
// `false` dit qu'aucun opérateur actif ne porte cet identifiant — ce qui n'est pas la même chose
// qu'un opérateur sans passkey, dont la liste est simplement vide.
//
// Deux requêtes et non une jointure : un `LEFT JOIN` rend une ligne dont toute la moitié droite est
// nulle quand il n'y a aucune passkey, ce qui obligerait à lire chaque colonne dans un pointeur pour
// distinguer « aucune passkey » de « aucun opérateur ». Ce chemin n'est pas chaud — il n'est
// emprunté qu'à l'ouverture d'une cérémonie — et la lisibilité vaut plus ici que l'aller-retour.
func (w *Webauthn) OwnerOf(ctx context.Context, operatorID string) (PasskeyOwner, bool, error) {
	const identity = `SELECT email, display_name FROM operators WHERE id = $1 AND status = $2`

	owner := PasskeyOwner{ID: operatorID}

	err := w.pool.QueryRow(ctx, identity, operatorID, StatusActive).
		Scan(&owner.Email, &owner.DisplayName)

	if errors.Is(err, pgx.ErrNoRows) {
		return PasskeyOwner{}, false, nil
	}

	if err != nil {
		return PasskeyOwner{}, false, fmt.Errorf("lire l'opérateur d'une cérémonie : %w", err)
	}

	owner.Passkeys, err = w.passkeysOf(ctx, operatorID)
	if err != nil {
		return PasskeyOwner{}, false, err
	}

	return owner, true, nil
}

func (w *Webauthn) passkeysOf(ctx context.Context, operatorID string) ([]Passkey, error) {
	const query = `
		SELECT id::text, credential_id, public_key, sign_count, aaguid,
		       transports, coalesce(attachment, ''), user_verified,
		       backup_eligible, backup_state
		FROM webauthn_credentials
		WHERE operator_id = $1
		ORDER BY id`

	rows, err := w.pool.Query(ctx, query, operatorID)
	if err != nil {
		return nil, fmt.Errorf("lire les passkeys de l'opérateur : %w", err)
	}

	defer rows.Close()

	var passkeys []Passkey

	for rows.Next() {
		var passkey Passkey

		err = rows.Scan(&passkey.ID, &passkey.CredentialID, &passkey.PublicKey,
			&passkey.SignCount, &passkey.AAGUID, &passkey.Transports, &passkey.Attachment,
			&passkey.UserVerified, &passkey.BackupEligible, &passkey.BackupState)
		if err != nil {
			return nil, fmt.Errorf("lire une passkey : %w", err)
		}

		passkeys = append(passkeys, passkey)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("parcourir les passkeys : %w", err)
	}

	return passkeys, nil
}

// Register écrit une passkey et rend l'identifiant de sa ligne.
//
// L'unicité de `credential_id` est **globale** et tenue par l'index : un authentificateur qui
// présenterait une clé déjà enregistrée ailleurs échoue ici plutôt que d'appartenir à deux
// opérateurs. La cérémonie l'exclut déjà pour le même opérateur ; l'index couvre le reste.
func (w *Webauthn) Register(ctx context.Context, operatorID string, passkey Passkey) (string,
	error,
) {
	const query = `
		INSERT INTO webauthn_credentials (
			operator_id, credential_id, public_key, sign_count, aaguid, transports,
			attachment, user_verified, backup_eligible, backup_state)
		VALUES ($1, $2, $3, $4, $5, $6, nullif($7, ''), $8, $9, $10)
		RETURNING id::text`

	var id string

	err := w.pool.QueryRow(ctx, query, operatorID, passkey.CredentialID, passkey.PublicKey,
		int64(passkey.SignCount), passkey.AAGUID, passkey.Transports, passkey.Attachment,
		passkey.UserVerified, passkey.BackupEligible, passkey.BackupState).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("enregistrer la passkey : %w", err)
	}

	return id, nil
}

// ConsumeSignCount avance le compteur de signature, et **c'est la garde du clonage**.
//
// Le compteur n'avance que : `false` dit qu'il a reculé ou stagné, donc que deux copies de la même
// clé privée existent. La décision est ici et non en Go, où deux assertions concurrentes le liraient
// toutes deux avant qu'aucune n'écrive ; le `WHERE` les sérialise sur le verrou de ligne.
//
// **Le zéro permanent est admis**, seconde moitié de la condition : certains authentificateurs ne
// comptent pas, et une garde qui refuse du légitime finit retirée. Ce qu'elle laisse alors passer est
// écrit : sur ces appareils-là, le clonage ne se détecte pas — aucune information n'en parvient, et
// refuser tout le monde n'en produirait aucune.
//
// `user_verified` est **latché** : `OR` et non affectation. C'est `uvInitialized` de la
// spécification, qui ne recule jamais.
func (w *Webauthn) ConsumeSignCount(ctx context.Context, credentialID []byte, signCount uint32,
	userVerified bool,
) (bool, error) {
	const query = `
		UPDATE webauthn_credentials
		SET sign_count = $2, last_used_at = now(), user_verified = user_verified OR $3
		WHERE credential_id = $1
		  AND ($2 > sign_count OR ($2 = 0 AND sign_count = 0))`

	tag, err := w.pool.Exec(ctx, query, credentialID, int64(signCount), userVerified)
	if err != nil {
		return false, fmt.Errorf("avancer le compteur de signature : %w", err)
	}

	return tag.RowsAffected() > 0, nil
}

// Remove retire une passkey, et **refuse de retirer le dernier facteur** : sans TOTP et sans autre
// passkey, l'opérateur ne pourrait plus élever aucune session.
//
// Une transaction, et un verrou sur la ligne de l'opérateur avant tout le reste. Sans lui, deux
// retraits concurrents de deux passkeys distinctes se verraient chacun l'autre encore présente — les
// sous-requêtes lisent le snapshot de leur instruction, pas l'effet d'une transaction voisine non
// commitée — et les deux réussiraient. Le compte reste juste parce que le verrou les met en file.
func (w *Webauthn) Remove(ctx context.Context, operatorID, passkeyID string) (PasskeyRemoval,
	error,
) {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return PasskeyUnknown, fmt.Errorf("ouvrir la transaction de retrait : %w", err)
	}

	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	const inventory = `
		SELECT o.mfa_totp_secret IS NOT NULL,
		       (SELECT count(*) FROM webauthn_credentials AS c WHERE c.operator_id = o.id),
		       EXISTS (SELECT 1 FROM webauthn_credentials AS c
		               WHERE c.operator_id = o.id AND c.id = $2)
		FROM operators AS o
		WHERE o.id = $1 AND o.status = $3
		FOR UPDATE OF o`

	var (
		hasTOTP  bool
		passkeys int
		mine     bool
	)

	err = tx.QueryRow(ctx, inventory, operatorID, passkeyID, StatusActive).
		Scan(&hasTOTP, &passkeys, &mine)

	if errors.Is(err, pgx.ErrNoRows) {
		return PasskeyUnknown, nil
	}

	if err != nil {
		return PasskeyUnknown, fmt.Errorf("inventorier les facteurs de l'opérateur : %w", err)
	}

	if !mine {
		return PasskeyUnknown, nil
	}

	if !hasTOTP && passkeys <= 1 {
		return PasskeyIsLastFactor, nil
	}

	const removal = `DELETE FROM webauthn_credentials WHERE id = $1 AND operator_id = $2`

	if _, err = tx.Exec(ctx, removal, passkeyID, operatorID); err != nil {
		return PasskeyUnknown, fmt.Errorf("retirer la passkey : %w", err)
	}

	if err = tx.Commit(ctx); err != nil {
		return PasskeyUnknown, fmt.Errorf("valider le retrait de la passkey : %w", err)
	}

	return PasskeyRemoved, nil
}

// IssueCeremony ouvre un défi pour cette session et cet objet, et **éteint celui qu'il remplace**.
//
// Un seul défi vivant par (session, objet) à tout instant : deux onglets rendraient sinon
// indécidable celui que la finition doit relire, et le choisir par sa date ferait dépendre une garde
// d'un tri. Le `UPDATE` et l'`INSERT` tiennent dans une instruction, donc dans une transaction
// implicite.
//
// L'échéance est calculée par le serveur de base, comme celles des sessions et des challenges de
// premier facteur.
func (w *Webauthn) IssueCeremony(ctx context.Context, sessionID, purpose string, data []byte,
	ttl time.Duration,
) (string, error) {
	const query = `
		WITH extinguished AS (
			UPDATE webauthn_challenges SET consumed_at = now()
			WHERE session_id = $1 AND purpose = $2 AND consumed_at IS NULL
		)
		INSERT INTO webauthn_challenges (session_id, purpose, ceremony, expires_at)
		VALUES ($1, $2, $3, now() + make_interval(secs => $4))
		RETURNING id::text`

	var id string

	err := w.pool.QueryRow(ctx, query, sessionID, purpose, data, ttl.Seconds()).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("ouvrir le défi de cérémonie : %w", err)
	}

	return id, nil
}

// LiveCeremony rend le défi vivant de cette session pour cet objet.
//
// Trois conditions, et zéro ligne ne dit pas laquelle a manqué : jamais ouvert, échu, déjà consommé,
// ou d'un autre objet. C'est aussi la garde d'appartenance — la session est dans le `WHERE`, donc un
// défi ouvert ailleurs ne se finit pas ici.
func (w *Webauthn) LiveCeremony(ctx context.Context, sessionID, purpose string) (Ceremony, bool,
	error,
) {
	const query = `
		SELECT id::text, ceremony
		FROM webauthn_challenges
		WHERE session_id = $1
		  AND purpose = $2
		  AND consumed_at IS NULL
		  AND now() < expires_at`

	var ceremony Ceremony

	err := w.pool.QueryRow(ctx, query, sessionID, purpose).Scan(&ceremony.ID, &ceremony.Data)

	if errors.Is(err, pgx.ErrNoRows) {
		return Ceremony{}, false, nil
	}

	if err != nil {
		return Ceremony{}, false, fmt.Errorf("lire le défi de cérémonie : %w", err)
	}

	return ceremony, true, nil
}

// ConsumeCeremony ferme un défi. `false` dit qu'un autre l'a fermé d'abord — deux finitions
// concurrentes n'en font aboutir qu'une.
func (w *Webauthn) ConsumeCeremony(ctx context.Context, id string) (bool, error) {
	const query = `
		UPDATE webauthn_challenges SET consumed_at = now()
		WHERE id = $1 AND consumed_at IS NULL AND now() < expires_at`

	tag, err := w.pool.Exec(ctx, query, id)
	if err != nil {
		return false, fmt.Errorf("consommer le défi de cérémonie : %w", err)
	}

	return tag.RowsAffected() > 0, nil
}
