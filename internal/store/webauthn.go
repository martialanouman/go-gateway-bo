package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

// uniqueViolation est le SQLSTATE d'une contrainte d'unicité violée. Le nommer évite de relire
// « 23505 » comme un numéro de téléphone.
const uniqueViolation = "23505"

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

// Register écrit une passkey et rend l'identifiant de sa ligne. Une chaîne vide dit que cette clé
// est **déjà enregistrée**, ici ou sur un autre compte.
//
// L'unicité de `credential_id` est globale et tenue par l'index. Elle est la **seule** garde :
// l'exclusion posée dans les options de cérémonie n'est qu'un indice pour le client — vérifié dans
// go-webauthn v0.18.0, `CreateCredential` ne consulte jamais la liste d'exclusion — donc un client
// qui l'ignore repasse.
//
// La violation est traduite en refus plutôt que remontée en erreur, et c'est ce qui ferme un oracle :
// un 500 face à un 200 dirait à qui détient un authentificateur si sa clé est enrôlée quelque part
// dans le déploiement, y compris sous un autre opérateur.
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

	var violation *pgconn.PgError
	if errors.As(err, &violation) && violation.Code == uniqueViolation {
		return "", nil
	}

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
// Une transaction, et **deux instructions** : le verrou d'abord, l'inventaire ensuite. Les réunir
// serait faux, et ça l'a été — mesuré le 27/08/2026 en forçant la séquence, verrou observé dans
// `pg_locks` : en READ COMMITTED, attendre un verrou de ligne ne rafraîchit pas le snapshot de
// l'instruction pour les **autres** relations. Deux retraits concurrents de deux passkeys distinctes
// comptaient donc chacun celle que l'autre venait de supprimer, et les deux aboutissaient — laissant
// l'opérateur sans aucun second facteur.
//
// La seconde instruction, elle, prend son propre snapshot **après** l'attente : elle voit ce que la
// transaction précédente a commité. C'est ce qui rend le compte juste.
func (w *Webauthn) Remove(ctx context.Context, operatorID, passkeyID string) (PasskeyRemoval,
	error,
) {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return PasskeyUnknown, fmt.Errorf("ouvrir la transaction de retrait : %w", err)
	}

	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	// Le verrou, et rien d'autre : il met en file les retraits qui portent sur le même opérateur.
	const lock = `SELECT 1 FROM operators WHERE id = $1 AND status = $2 FOR UPDATE`

	var held int

	err = tx.QueryRow(ctx, lock, operatorID, StatusActive).Scan(&held)

	if errors.Is(err, pgx.ErrNoRows) {
		return PasskeyUnknown, nil
	}

	if err != nil {
		return PasskeyUnknown, fmt.Errorf("verrouiller l'opérateur pour le retrait : %w", err)
	}

	// L'inventaire, dans sa propre instruction pour qu'il voie l'état d'après l'attente.
	const inventory = `
		SELECT o.mfa_totp_secret IS NOT NULL,
		       (SELECT count(*) FROM webauthn_credentials AS c WHERE c.operator_id = o.id),
		       EXISTS (SELECT 1 FROM webauthn_credentials AS c
		               WHERE c.operator_id = o.id AND c.id::text = $2)
		FROM operators AS o
		WHERE o.id = $1`

	// `c.id::text = $2` et non `c.id = $2` : ce que porte un chemin d'URL n'est pas nécessairement un
	// UUID, et la comparaison directe ferait échouer le **typage** en base — une erreur, donc un 500,
	// sur un statut que le contrat ne déclare pas. Comparé en texte, un identifiant mal formé ne
	// désigne simplement aucune ligne, ce qui est exactement « inconnu ». Le coût est nul : la
	// sous-requête est déjà bornée à un opérateur, donc à quelques lignes.
	var (
		hasTOTP  bool
		passkeys int
		mine     bool
	)

	err = tx.QueryRow(ctx, inventory, operatorID, passkeyID).Scan(&hasTOTP, &passkeys, &mine)
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
//
// `ORDER BY … LIMIT 1` parce que « un seul défi vivant » est une propriété que l'ouverture **produit**
// et qu'aucun index n'**impose** : deux ouvertures concurrentes ne se voient pas l'une l'autre et
// insèrent toutes deux. Sans tri, `QueryRow` prendrait une ligne au hasard et pourrait consommer le
// défi de l'autre onglet ; avec, c'est toujours le plus récent — celui que le client vient de
// recevoir.
func (w *Webauthn) LiveCeremony(ctx context.Context, sessionID, purpose string) (Ceremony, bool,
	error,
) {
	const query = `
		SELECT id::text, ceremony
		FROM webauthn_challenges
		WHERE session_id = $1
		  AND purpose = $2
		  AND consumed_at IS NULL
		  AND now() < expires_at
		ORDER BY created_at DESC, id DESC
		LIMIT 1`

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
