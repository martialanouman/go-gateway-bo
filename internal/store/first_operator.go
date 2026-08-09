package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
)

// OwnerRole est le rôle attaché au compte propriétaire : celui qui détient tout le catalogue (§6.10).
// Une installation neuve n'a personne pour en accorder d'autres, donc le premier compte doit pouvoir
// tout faire — y compris `operators:manage`, sans quoi il ne pourrait créer personne.
const OwnerRole = permissions.SuperAdminRole

// FirstOperatorOutcome dit ce que la commande a fait, **y compris quand elle n'a rien fait** : c'est
// ce qui permet au compte rendu de distinguer « installation neuve » de « déjà installée » sans
// interroger la base une seconde fois.
type FirstOperatorOutcome struct {
	Created bool
	Email   string
	Role    string
}

// CreateFirstOperator crée le compte propriétaire **s'il n'existe aucun opérateur**, et ne touche à
// rien sinon.
//
// Elle prend `SeedLockKey`, le verrou du seed, et c'est délibéré. Un `WHERE NOT EXISTS` se garde sur
// le snapshot de sa transaction : deux exécutions simultanées sur une base vierge y verraient toutes
// deux zéro opérateur et en créeraient deux — précisément le mode d'échec que le « refuse » de la
// rédaction d'origine visait, et que la rejouabilité ne doit pas rouvrir. Partager la clé du seed
// sérialise en plus les deux moitiés de la commande, qui n'ont aucune raison de se croiser.
//
// **Ce que le `WHERE NOT EXISTS` couvre seul, aucun test ne le voit — mesuré le 09/08/2026.** Le
// retirer laisse `TestUnSecondPassageNeCreeAucunSecondOperateur` **vert**, parce que le retour
// anticipé de `createOwner` arrête la commande avant d'arriver ici. Retirer ce retour anticipé seul
// est vert aussi, pour la raison symétrique. Il faut retirer **les deux** pour faire rougir.
//
// Les deux méritent d'exister quand même, et ce n'est pas la même garde : le retour anticipé décide
// du **message** — il faut savoir s'il y a un opérateur avant d'exiger les variables — tandis que
// celle-ci est la seule qui tienne quand deux exécutions se croisent. Ce cas-là n'est exercé par rien,
// exactement comme le verrou du seed (step-020, DN-9) : deux exécutions concurrentes se croisent trop
// rarement pour qu'un test qui les lance prouve quoi que ce soit.
func CreateFirstOperator(ctx context.Context, dsn, email, displayName, passwordHash string) (
	FirstOperatorOutcome, error,
) {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		// Comme ailleurs dans ce paquet, l'erreur de la bibliothèque n'est pas propagée : elle recopie
		// le DSN, dont la rédaction n'est pas hermétique, et celle-ci remonte jusqu'aux journaux de
		// déploiement.
		return FirstOperatorOutcome{}, errors.New(
			"connexion à la base impossible ; la valeur du DSN n'est pas citée, elle porte le mot de " +
				"passe de la base")
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	tx, err := conn.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return FirstOperatorOutcome{}, fmt.Errorf("ouvrir la transaction du premier opérateur : %w", err)
	}

	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, SeedLockKey); err != nil {
		return FirstOperatorOutcome{}, fmt.Errorf("prendre le verrou du premier opérateur : %w", err)
	}

	outcome, err := insertOwner(ctx, tx, email, displayName, passwordHash)
	if err != nil {
		return FirstOperatorOutcome{}, err
	}

	if err = tx.Commit(ctx); err != nil {
		return FirstOperatorOutcome{}, fmt.Errorf("valider la création du premier opérateur : %w", err)
	}

	return outcome, nil
}

// insertOwner pose le compte et son rôle **dans une seule instruction**.
//
// La forme CTE n'est pas de la coquetterie : le compte et son rôle doivent apparaître ensemble ou pas
// du tout. Un opérateur sans rôle **peut se connecter et ne peut rien faire** — c'est une
// installation qui a l'air bonne et dans laquelle personne ne peut travailler, le symptôme le plus
// coûteux à diagnostiquer de cette commande.
func insertOwner(ctx context.Context, tx pgx.Tx, email, displayName, passwordHash string) (
	FirstOperatorOutcome, error,
) {
	const query = `
		WITH created AS (
		    INSERT INTO operators (email, display_name, password_hash)
		    SELECT $1, $2, $3
		    WHERE NOT EXISTS (SELECT 1 FROM operators)
		    RETURNING id
		),
		granted AS (
		    INSERT INTO operator_roles (operator_id, role_id)
		    SELECT created.id, roles.id
		    FROM created
		    JOIN roles ON roles.name = $4
		    RETURNING operator_id
		)
		SELECT
		    (SELECT count(*) FROM created) AS operators_created,
		    (SELECT count(*) FROM granted) AS roles_granted`

	var created, granted int

	err := tx.QueryRow(ctx, query, email, displayName, passwordHash, OwnerRole).Scan(&created, &granted)
	if err != nil {
		return FirstOperatorOutcome{}, fmt.Errorf("créer le premier opérateur : %w", err)
	}

	if created == 0 {
		return FirstOperatorOutcome{}, nil
	}

	// Le rôle vient d'être semé par la première moitié de la commande, deux instructions plus haut
	// dans le même processus. S'il manque quand même, la base n'est pas dans l'état qu'on croit : on
	// refuse plutôt que de livrer un compte qui ne peut rien faire. La transaction est annulée par le
	// `defer` de l'appelant.
	if granted == 0 {
		return FirstOperatorOutcome{}, fmt.Errorf(
			"le rôle %q est absent de la base : le compte propriétaire aurait pu se connecter sans "+
				"pouvoir rien faire. Rien n'a été créé — jouer le seed d'abord", OwnerRole)
	}

	return FirstOperatorOutcome{Created: true, Email: email, Role: OwnerRole}, nil
}

// HasAnyOperator dit si la base porte au moins un opérateur.
//
// Elle existe pour que `bootstrap` n'exige les variables du compte propriétaire **que** lorsqu'elles
// servent : les exiger d'abord ferait échouer la commande sur toute installation déjà faite,
// c'est-à-dire à chaque déploiement après le premier.
//
// Le verdict qu'elle rend n'est pas une garde — deux exécutions simultanées peuvent le lire à zéro
// toutes les deux. Ce qui garde la création est le verrou de `CreateFirstOperator` ; celle-ci décide
// seulement du **message**.
func HasAnyOperator(ctx context.Context, dsn string) (bool, error) {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return false, errors.New(
			"connexion à la base impossible ; la valeur du DSN n'est pas citée, elle porte le mot de " +
				"passe de la base")
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	var exists bool
	if err = conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM operators)`).Scan(&exists); err != nil {
		return false, fmt.Errorf("compter les opérateurs : %w", err)
	}

	return exists, nil
}
