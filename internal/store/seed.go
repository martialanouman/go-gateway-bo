package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
)

// SeedLockKey est la clé du verrou consultatif que `Seed` prend pour toute sa transaction.
//
// Elle est exportée pour que les tests puissent l'observer dans `pg_locks` — c'est le seul endroit
// d'où un verrou se constate, deux exécutions concurrentes se croisant trop rarement pour qu'un test
// qui les lance prouve quoi que ce soit.
//
// La valeur n'a pas de sens en soi ; elle doit seulement être stable d'une version à l'autre et ne
// pas entrer en collision avec celle de goose, qui verrouille les migrations sur la même base et
// dans le **même espace** — `pg_advisory_xact_lock` et le `pg_try_advisory_lock` de goose partagent
// leurs identifiants. Celle de goose est `lock.DefaultLockID`, et `seed_lock_test.go` compare les
// deux plutôt que de recopier sa valeur : une première rédaction de ce commentaire citait un nombre
// qui n'existe nulle part dans le module.
const SeedLockKey int64 = 7_020_020_020_020_020

// Grant est une attribution : le rôle par défaut, et la clé qu'il accorde.
type Grant struct {
	Role string
	Key  permissions.Key
}

// SeedOutcome décrit ce qu'une exécution du seed a changé, et ce qu'elle a trouvé en base sans
// pouvoir l'expliquer. Toutes ses tranches vides, la base était déjà l'image du catalogue.
type SeedOutcome struct {
	PermissionsInserted []permissions.Key
	PermissionsUpdated  []permissions.Key
	RolesInserted       []string
	RolesUpdated        []string
	GrantsAdded         []Grant
	GrantsRevoked       []Grant

	// UnknownPermissions porte les clés que la base garde et que le catalogue ne déclare plus. Elles
	// ne sont **pas** supprimées. Les rôles par défaut, eux, ont bien perdu l'attribution — c'est la
	// révocation de `reconcileGrants`, et elle est rapportée dans `GrantsRevoked` ; ce qui subsiste
	// est la ligne du catalogue, et l'attribution d'un rôle composé à l'écran, que le `RESTRICT` de
	// `role_permissions.permission_key` protège. Retirer la clé est une migration, qui révoque
	// d'abord ce qui reste.
	UnknownPermissions []permissions.Key
	// UnknownRoles porte les rôles marqués `is_default` que le code ne décrit plus. Le seed ne touche
	// pas non plus à leurs attributions : les révoquer les viderait de leur sens sans que personne
	// l'ait demandé.
	UnknownRoles []string
}

// Changed dit si cette exécution a modifié quoi que ce soit. Une divergence signalée n'en est pas
// une : le seed ne l'a pas provoquée et ne l'a pas corrigée.
func (o SeedOutcome) Changed() bool {
	return len(o.PermissionsInserted) > 0 || len(o.PermissionsUpdated) > 0 ||
		len(o.RolesInserted) > 0 || len(o.RolesUpdated) > 0 ||
		len(o.GrantsAdded) > 0 || len(o.GrantsRevoked) > 0
}

// Diverges dit si la base porte du vocabulaire que le code ne déclare plus.
func (o SeedOutcome) Diverges() bool {
	return len(o.UnknownPermissions) > 0 || len(o.UnknownRoles) > 0
}

// Seed projette le catalogue des permissions et les neuf rôles par défaut du §6.10 sur la base
// désignée par dsn. Le rejouer sur une base déjà semée ne change rien et n'échoue pas.
//
// **Une connexion, pas le pool** : trois requêtes jouées une fois par déploiement n'ont rien à faire
// d'un pool de dix connexions, dont la paresse et le recyclage sont réglés pour un serveur qui vit.
//
// L'ordre des trois instructions est imposé par les clés étrangères : `role_permissions` ne peut
// nommer ni un rôle ni une clé qui n'existe pas encore. Elles partagent une transaction, donc une
// base à demi semée n'existe à aucun moment observable.
func Seed(ctx context.Context, dsn string) (SeedOutcome, error) {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		// Comme ailleurs dans ce package, l'erreur de la bibliothèque n'est pas propagée : elle
		// recopie le DSN, dont la rédaction n'est pas hermétique, et celle-ci remonte jusqu'à la
		// sortie de `bootstrap`, donc dans les journaux de déploiement.
		return SeedOutcome{}, errors.New(
			"connexion à la base impossible ; la valeur du DSN n'est pas citée, elle porte le mot de " +
				"passe de la base")
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return SeedOutcome{}, fmt.Errorf("ouvrir la transaction du seed : %w", err)
	}

	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	outcome, err := seedWithin(ctx, tx)
	if err != nil {
		return SeedOutcome{}, err
	}

	if err = tx.Commit(ctx); err != nil {
		return SeedOutcome{}, fmt.Errorf("valider le seed : %w", err)
	}

	return outcome, nil
}

func seedWithin(ctx context.Context, tx pgx.Tx) (SeedOutcome, error) {
	var outcome SeedOutcome

	// Le verrou avant la première lecture, et rendu par la fin de la transaction — `xact` et non
	// `session` : il n'y a rien à libérer à la main, y compris sur le chemin d'erreur.
	//
	// Il existe pour la raison qui a fait poser `WithSessionLocker` sur les migrations : deux
	// exécutions concurrentes sur une base pas encore semée verraient toutes deux la même clé
	// absente et l'insèreraient, et la seconde échouerait sur `permissions_pkey`. Les CTE se gardent
	// par `NOT EXISTS` sur snapshot, ce qui ne sérialise rien. Faire échouer une livraison sur le cas
	// le plus fréquent — la première installation — contredirait DN-4, qui refuse d'arrêter un
	// déploiement pour un état qui n'empêche rien.
	//
	// **Sa position en tête est tenue par la lecture, par aucun test**, et c'est mesuré : le glisser
	// après `seedPermissions` laisse `seed_lock_test.go` vert — il observe que le seed attend, pas
	// qu'il attend avant d'avoir écrit. L'exercer demanderait de voir dans une transaction non
	// validée, ou de lancer deux exécutions en espérant la collision, ce qui rendrait vert « elles ne
	// se sont pas croisées ».
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", SeedLockKey); err != nil {
		return SeedOutcome{}, fmt.Errorf("prendre le verrou du seed : %w", err)
	}

	if err := seedPermissions(ctx, tx, &outcome); err != nil {
		return SeedOutcome{}, err
	}

	if err := seedRoles(ctx, tx, &outcome); err != nil {
		return SeedOutcome{}, err
	}

	if err := seedGrants(ctx, tx, &outcome); err != nil {
		return SeedOutcome{}, err
	}

	return outcome, nil
}

// upsertPermissions classe ce qu'elle fait au lieu de le taire.
//
// **`ON CONFLICT DO NOTHING` ne convient pas**, et c'est le cœur de cette step : il laisserait une
// description modifiée à la main telle quelle, et ne dirait rien d'une clé disparue du catalogue —
// la base garderait indéfiniment un vocabulaire que plus personne ne lit, et le premier symptôme
// serait un écran de rôle affichant une permission que le serveur ignore.
//
// Le `IS DISTINCT FROM` n'est pas une optimisation : sans lui, la seconde exécution réécrirait les
// 44 lignes à l'identique et se rapporterait comme ayant changé quelque chose. C'est lui qui rend
// « rejouer ne change rien » observable plutôt que supposé.
//
// La troisième branche du `SELECT` final — celle qui classe `unknown` — ne peut pas croiser les deux
// autres : son prédicat est `NOT EXISTS (… wanted …)`, et tout ce qu'`inserted` et `updated`
// touchent vient de `wanted`. C'est **ce prédicat** qui fait qu'une base vierge ne se signale pas 44
// clés inconnues à elle-même, et non la sémantique de snapshot — une première rédaction de ce
// commentaire l'attribuait à celle-ci, ce qui expliquait un code correct par une raison qu'il n'a pas.
const upsertPermissions = `
WITH wanted (key, category, description) AS (
	SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
),
inserted AS (
	INSERT INTO permissions (key, category, description)
	SELECT w.key, w.category, w.description FROM wanted w
	WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = w.key)
	RETURNING key
),
updated AS (
	UPDATE permissions p SET category = w.category, description = w.description
	FROM wanted w
	WHERE p.key = w.key
	  AND (p.category, p.description) IS DISTINCT FROM (w.category, w.description)
	RETURNING p.key
)
SELECT 'inserted', key FROM inserted
UNION ALL SELECT 'updated', key FROM updated
UNION ALL SELECT 'unknown', p.key FROM permissions p
	WHERE NOT EXISTS (SELECT 1 FROM wanted w WHERE w.key = p.key)`

func seedPermissions(ctx context.Context, tx pgx.Tx, outcome *SeedOutcome) error {
	catalog := permissions.All()

	keys := make([]string, 0, len(catalog))
	categories := make([]string, 0, len(catalog))
	descriptions := make([]string, 0, len(catalog))

	for _, entry := range catalog {
		keys = append(keys, string(entry.Key))
		categories = append(categories, string(entry.Category))
		descriptions = append(descriptions, entry.Description)
	}

	return eachClassifiedRow(ctx, tx, upsertPermissions,
		func(kind, name string) error {
			switch kind {
			case "inserted":
				outcome.PermissionsInserted = append(outcome.PermissionsInserted, permissions.Key(name))
			case "updated":
				outcome.PermissionsUpdated = append(outcome.PermissionsUpdated, permissions.Key(name))
			case "unknown":
				outcome.UnknownPermissions = append(outcome.UnknownPermissions, permissions.Key(name))
			default:
				return fmt.Errorf("le seed du catalogue rend une classe inattendue : %q", kind)
			}

			return nil
		},
		keys, categories, descriptions)
}

// `created_by` reste NULL, et la colonne est nullable pour cette raison autant que pour le départ
// d'un auteur : ces neuf rôles sont posés par le déploiement, pas par un humain, et c'est ce qui les
// distingue d'un rôle créé depuis l'écran de step-029. Le renseigner ferait d'ailleurs échouer la
// clé étrangère — aucun opérateur n'existe encore, step-021 crée le premier.
//
// `is_default = true` est écrit explicitement : le défaut de la colonne est `false`, et un rôle par
// défaut qui ne se déclarerait pas comme tel échapperait à la révocation ci-dessous comme à
// l'interdiction de suppression que le §6.10 exige.
const upsertRoles = `
WITH wanted (name, description) AS (
	SELECT * FROM unnest($1::text[], $2::text[])
),
inserted AS (
	INSERT INTO roles (name, description, is_default)
	SELECT w.name, w.description, true FROM wanted w
	WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.name = w.name)
	RETURNING name
),
updated AS (
	UPDATE roles r SET description = w.description, is_default = true
	FROM wanted w
	WHERE r.name = w.name
	  AND (r.description, r.is_default) IS DISTINCT FROM (w.description, true)
	RETURNING r.name
)
SELECT 'inserted', name FROM inserted
UNION ALL SELECT 'updated', name FROM updated
UNION ALL SELECT 'unknown', r.name FROM roles r
	WHERE r.is_default AND NOT EXISTS (SELECT 1 FROM wanted w WHERE w.name = r.name)`

// seedRoles projette les neuf rôles par défaut. Ce que la requête ci-dessus ne distingue pas, et
// qu'il faut savoir : **l'identité d'un rôle est son nom**.
// Un rôle composé depuis l'écran qui porterait le nom d'un rôle par défaut — celui d'aujourd'hui, ou
// celui qu'une release future ajoutera — serait basculé en `is_default`, verrait sa description
// écrasée et ses attributions ramenées à la liste du code. Le rapport le compte, donc ce n'est pas
// silencieux, mais c'est destructeur par défaut. C'est la seconde moitié de la question léguée à
// step-029, qui décidera si l'écran interdit ces neuf noms ou ce qu'il fait d'une collision.

func seedRoles(ctx context.Context, tx pgx.Tx, outcome *SeedOutcome) error {
	defaults := permissions.DefaultRoles()

	names := make([]string, 0, len(defaults))
	descriptions := make([]string, 0, len(defaults))

	for _, role := range defaults {
		names = append(names, role.Name)
		descriptions = append(descriptions, role.Description)
	}

	return eachClassifiedRow(ctx, tx, upsertRoles,
		func(kind, name string) error {
			switch kind {
			case "inserted":
				outcome.RolesInserted = append(outcome.RolesInserted, name)
			case "updated":
				outcome.RolesUpdated = append(outcome.RolesUpdated, name)
			case "unknown":
				outcome.UnknownRoles = append(outcome.UnknownRoles, name)
			default:
				return fmt.Errorf("le seed des rôles rend une classe inattendue : %q", kind)
			}

			return nil
		},
		names, descriptions)
}

// La révocation est ce qui distingue ce seed d'un simple remplissage : sans elle, une clé qu'une
// release retire d'un rôle par défaut resterait accordée indéfiniment — la forme temporelle du
// défaut que cette step existe pour éviter.
//
// Elle ne révoque que sur les rôles dont **le code décrit la composition** — `EXISTS (… wanted …)`.
// Ce prédicat en couvre deux à lui seul : un rôle composé depuis l'écran n'a par construction aucune
// ligne dans `wanted`, et un rôle marqué `is_default` que le code ne décrit plus est signalé comme
// inconnu par la requête précédente, qui le laisse intact — le dépouiller ici serait deux traitements
// contraires du même cas.
//
// L'invariant exact est « révoquer sur les rôles **dont le code liste au moins une clé** », et non
// « sur les rôles que le code nomme » : `wanted` est bâtie depuis les couples (rôle, clé), donc un
// rôle par défaut dont la liste deviendrait vide en sortirait, et garderait indéfiniment tout ce
// qu'il détient. Ce n'est pas livrable aujourd'hui — `roles_test.go` exige que chaque rôle accorde
// quelque chose — mais c'est le SQL qui ne se défend pas seul, et deux des neuf rôles n'ont qu'une
// clé.
//
// Un `AND r.is_default` a d'abord été écrit à côté, et **mesuré inatteignable** : le retirer seul
// laissait les huit scénarios et les tests unitaires verts. La raison est deux instructions plus
// haut — `upsertRoles` force `is_default = true` sur exactement les rôles de `wanted`, dans la même
// transaction. Une garde qu'aucune mutation ne peut faire tomber ne garde rien ; elle a été retirée
// plutôt que dotée d'un test de complaisance.
const reconcileGrants = `
WITH wanted (role_name, permission_key) AS (
	SELECT * FROM unnest($1::text[], $2::text[])
),
target AS (
	SELECT r.id AS role_id, r.name, w.permission_key
	FROM wanted w JOIN roles r ON r.name = w.role_name
),
added AS (
	INSERT INTO role_permissions (role_id, permission_key)
	SELECT t.role_id, t.permission_key FROM target t
	WHERE NOT EXISTS (
		SELECT 1 FROM role_permissions rp
		WHERE rp.role_id = t.role_id AND rp.permission_key = t.permission_key
	)
	RETURNING role_id, permission_key
),
revoked AS (
	DELETE FROM role_permissions rp
	USING roles r
	WHERE rp.role_id = r.id
	  AND EXISTS (SELECT 1 FROM wanted w WHERE w.role_name = r.name)
	  AND NOT EXISTS (
		SELECT 1 FROM target t
		WHERE t.role_id = rp.role_id AND t.permission_key = rp.permission_key
	)
	RETURNING r.name, rp.permission_key
)
SELECT 'added', r.name, a.permission_key FROM added a JOIN roles r ON r.id = a.role_id
UNION ALL SELECT 'revoked', name, permission_key FROM revoked`

func seedGrants(ctx context.Context, tx pgx.Tx, outcome *SeedOutcome) error {
	var roleNames, keys []string

	for _, role := range permissions.DefaultRoles() {
		for _, key := range role.Keys {
			roleNames = append(roleNames, role.Name)
			keys = append(keys, string(key))
		}
	}

	rows, err := tx.Query(ctx, reconcileGrants, roleNames, keys)
	if err != nil {
		return fmt.Errorf("semer les attributions des rôles par défaut : %w", err)
	}

	defer rows.Close()

	for rows.Next() {
		var kind, role, key string

		if err = rows.Scan(&kind, &role, &key); err != nil {
			return fmt.Errorf("lire le rapport des attributions : %w", err)
		}

		grant := Grant{Role: role, Key: permissions.Key(key)}

		switch kind {
		case "added":
			outcome.GrantsAdded = append(outcome.GrantsAdded, grant)
		case "revoked":
			outcome.GrantsRevoked = append(outcome.GrantsRevoked, grant)
		default:
			return fmt.Errorf("le seed des attributions rend une classe inattendue : %q", kind)
		}
	}

	if err = rows.Err(); err != nil {
		return fmt.Errorf("lire le rapport des attributions : %w", err)
	}

	return nil
}

// eachClassifiedRow joue une instruction qui rend des couples (classe, nom) et les remet à son
// appelant. Les deux premières requêtes ont la même forme ; la troisième porte une colonne de plus
// et reste écrite à part, une abstraction de plus coûtant ici davantage qu'elle n'économise.
func eachClassifiedRow(
	ctx context.Context, tx pgx.Tx, sql string, classify func(kind, name string) error, args ...any,
) error {
	rows, err := tx.Query(ctx, sql, args...)
	if err != nil {
		return fmt.Errorf("projeter le vocabulaire sur la base : %w", err)
	}

	defer rows.Close()

	for rows.Next() {
		var kind, name string

		if err = rows.Scan(&kind, &name); err != nil {
			return fmt.Errorf("lire le rapport du seed : %w", err)
		}

		if err = classify(kind, name); err != nil {
			return err
		}
	}

	if err = rows.Err(); err != nil {
		return fmt.Errorf("lire le rapport du seed : %w", err)
	}

	return nil
}
