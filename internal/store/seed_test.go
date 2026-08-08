package store_test

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"

	"github.com/cucumber/godog"
	"github.com/jackc/pgx/v5"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

func initializeSeedScenario(ctx *godog.ScenarioContext) {
	seed := &seedWorld{}

	ctx.Given(`^une base migrée$`, seed.migratedDatabase)
	ctx.Given(`^le seed déjà joué$`, seed.seedThenRecordVocabulary)
	ctx.Given(`^la description de "([^"]+)" réécrite à la main$`, seed.rewriteDescription)
	ctx.Given(`^une clé "([^"]+)" posée en base hors du catalogue$`, seed.insertUncataloguedKey)
	ctx.Given(`^"([^"]+)" accordée à la main au rôle "([^"]+)"$`, seed.grantByHand)
	ctx.Given(`^un rôle personnalisé "([^"]+)" qui accorde "([^"]+)"$`, seed.createCustomRole)
	ctx.When(`^le seed est (?:joué|rejoué)$`, seed.seed)
	ctx.Then(`^le catalogue du code et celui de la base coïncident$`, seed.catalogsMatch)
	ctx.Then(`^les neuf rôles par défaut accordent ce que le code leur donne$`, seed.defaultRolesMatch)
	ctx.Then(`^le rapport annonce avoir posé tout le vocabulaire$`, seed.reportedSeedingEverything)
	ctx.Then(`^le rapport ne signale aucune divergence$`, seed.reportedNoDivergence)
	ctx.Then(`^la seconde exécution ne rapporte aucun changement$`, seed.lastRunChangedNothing)
	ctx.Then(`^le vocabulaire de la base est inchangé$`, seed.vocabularyIsUnchanged)
	ctx.Then(`^"([^"]+)" a retrouvé la description du catalogue$`, seed.descriptionMatchesCatalog)
	ctx.Then(`^la seconde exécution ne rapporte que la mise à jour de "([^"]+)"$`, seed.lastRunUpdatedOnly)
	ctx.Then(`^le rapport nomme "([^"]+)" comme inconnue du catalogue$`, seed.reportedAsUnknown)
	ctx.Then(`^la clé "([^"]+)" est toujours en base$`, seed.keyIsStillThere)
	ctx.Then(`^le rapport révoque "([^"]+)" du rôle "([^"]+)"$`, seed.reportedAsRevoked)
	ctx.Then(`^le rôle "([^"]+)" n'accorde plus "([^"]+)"$`, seed.roleNoLongerGrants)
	ctx.Then(`^le rôle "([^"]+)" accorde toujours "([^"]+)"$`, seed.roleStillGrants)
	ctx.Then(`^le rapport ne nomme jamais "([^"]+)"$`, seed.reportNeverNames)
}

// seedWorld porte l'état d'un scénario : la base qu'il s'est taillée, ce que la dernière exécution
// du seed a rapporté, et l'empreinte du vocabulaire relevée avant un rejeu. Une struct par
// scénario — godog en construit une neuve à chaque fois, donc rien ne fuit de l'un à l'autre.
type seedWorld struct {
	dsn              string
	lastOutcome      store.SeedOutcome
	vocabularyBefore string
}

func (w *seedWorld) migratedDatabase(ctx context.Context) error {
	dsn, err := createDatabase(ctx)
	if err != nil {
		return err
	}

	if _, err = store.Migrate(ctx, dsn); err != nil {
		return fmt.Errorf("jouer les migrations : %w", err)
	}

	w.dsn = dsn

	return nil
}

func (w *seedWorld) seed(ctx context.Context) error {
	outcome, err := store.Seed(ctx, w.dsn)
	if err != nil {
		return fmt.Errorf("jouer le seed : %w", err)
	}

	w.lastOutcome = outcome

	return nil
}

func (w *seedWorld) seedThenRecordVocabulary(ctx context.Context) error {
	if err := w.seed(ctx); err != nil {
		return err
	}

	fingerprint, err := w.vocabularyFingerprint(ctx)
	if err != nil {
		return err
	}

	w.vocabularyBefore = fingerprint

	return nil
}

func (w *seedWorld) catalogsMatch(ctx context.Context) error {
	rows, err := w.query(ctx, "SELECT key, category, description FROM permissions ORDER BY key")
	if err != nil {
		return err
	}

	inDatabase := map[permissions.Key]permissions.Entry{}

	for _, row := range rows {
		inDatabase[permissions.Key(row[0])] = permissions.Entry{
			Key:         permissions.Key(row[0]),
			Category:    permissions.Category(row[1]),
			Description: row[2],
		}
	}

	// Les deux sens. Une clé du catalogue absente de la base est une garde que personne ne peut
	// détenir ; une clé en base absente du catalogue est un mot que le serveur ignore et que l'écran
	// de rôle propose quand même.
	for _, entry := range permissions.All() {
		stored, exists := inDatabase[entry.Key]
		if !exists {
			return fmt.Errorf("la base n'a pas la clé %q du catalogue", entry.Key)
		}

		if stored != entry {
			return fmt.Errorf("la base décrit %q autrement que le catalogue : %+v contre %+v",
				entry.Key, stored, entry)
		}

		delete(inDatabase, entry.Key)
	}

	if len(inDatabase) > 0 {
		return fmt.Errorf("la base porte %d clé(s) que le catalogue ne déclare pas : %v",
			len(inDatabase), slices.Sorted(maps.Keys(inDatabase)))
	}

	return nil
}

func (w *seedWorld) defaultRolesMatch(ctx context.Context) error {
	granted, err := w.grantsByRole(ctx)
	if err != nil {
		return err
	}

	described, err := w.roleDescriptions(ctx)
	if err != nil {
		return err
	}

	for _, role := range permissions.DefaultRoles() {
		actual, exists := granted[role.Name]
		if !exists {
			return fmt.Errorf("le rôle par défaut %q n'existe pas en base", role.Name)
		}

		expected := make([]string, 0, len(role.Keys))
		for _, key := range role.Keys {
			expected = append(expected, string(key))
		}

		slices.Sort(expected)
		slices.Sort(actual)

		if !slices.Equal(expected, actual) {
			return fmt.Errorf("le rôle %q accorde %v en base, et %v dans le code",
				role.Name, actual, expected)
		}

		// La description est de la copie que l'écran de gestion des rôles affiche telle quelle : sans
		// ce contrôle, le seed pouvait projeter n'importe quel texte sans qu'une porte le voie.
		if described[role.Name] != role.Description {
			return fmt.Errorf("le rôle %q est décrit en base par %q, et dans le code par %q",
				role.Name, described[role.Name], role.Description)
		}

		delete(granted, role.Name)
	}

	// Le reliquat, sans quoi la boucle ci-dessus se lisait comme une comparaison bidirectionnelle
	// sans en être une : un rôle `is_default` de trop passait inaperçu.
	if len(granted) > 0 {
		return fmt.Errorf("la base porte %d rôle(s) que le code ne décrit pas : %v",
			len(granted), slices.Sorted(maps.Keys(granted)))
	}

	return nil
}

func (w *seedWorld) roleDescriptions(ctx context.Context) (map[string]string, error) {
	rows, err := w.query(ctx, "SELECT name, description FROM roles")
	if err != nil {
		return nil, err
	}

	described := map[string]string{}
	for _, row := range rows {
		described[row[0]] = row[1]
	}

	return described, nil
}

func (w *seedWorld) reportedSeedingEverything() error {
	catalog := permissions.All()
	if len(w.lastOutcome.PermissionsInserted) != len(catalog) {
		return fmt.Errorf("le rapport annonce %d clé(s) posée(s) pour %d au catalogue",
			len(w.lastOutcome.PermissionsInserted), len(catalog))
	}

	defaults := permissions.DefaultRoles()
	if len(w.lastOutcome.RolesInserted) != len(defaults) {
		return fmt.Errorf("le rapport annonce %d rôle(s) posé(s) pour %d dans le code",
			len(w.lastOutcome.RolesInserted), len(defaults))
	}

	var expectedGrants int
	for _, role := range defaults {
		expectedGrants += len(role.Keys)
	}

	if len(w.lastOutcome.GrantsAdded) != expectedGrants {
		return fmt.Errorf("le rapport annonce %d attribution(s) pour %d dans le code",
			len(w.lastOutcome.GrantsAdded), expectedGrants)
	}

	if !w.lastOutcome.Changed() {
		return errors.New("le rapport se dit sans changement après avoir rempli une base vide")
	}

	return nil
}

// reportedNoDivergence est le pendant négatif, et il manquait : `Diverges()` n'était jamais affirmé
// faux nulle part. Retirer le `NOT EXISTS` de la branche qui classe `unknown` faisait alors signaler
// les 44 clés du catalogue comme inconnues **du catalogue**, à chaque déploiement, suite verte.
func (w *seedWorld) reportedNoDivergence() error {
	if w.lastOutcome.Diverges() {
		return fmt.Errorf("le rapport signale une divergence sur une base que le seed vient de "+
			"remplir lui-même : permissions %v, rôles %v",
			w.lastOutcome.UnknownPermissions, w.lastOutcome.UnknownRoles)
	}

	return nil
}

func (w *seedWorld) lastRunChangedNothing() error {
	if w.lastOutcome.Changed() {
		return fmt.Errorf("la seconde exécution a rapporté des changements : %+v", w.lastOutcome)
	}

	return nil
}

func (w *seedWorld) vocabularyIsUnchanged(ctx context.Context) error {
	if w.vocabularyBefore == "" {
		return errors.New("aucune empreinte du vocabulaire n'a été relevée avant la seconde " +
			"exécution : le scénario ne compare rien")
	}

	after, err := w.vocabularyFingerprint(ctx)
	if err != nil {
		return err
	}

	if after != w.vocabularyBefore {
		return fmt.Errorf("le vocabulaire a changé en rejouant le seed.\navant :\n%s\naprès :\n%s",
			w.vocabularyBefore, after)
	}

	return nil
}

func (w *seedWorld) rewriteDescription(ctx context.Context, key string) error {
	return w.exec(ctx, "UPDATE permissions SET description = 'réécrite à la main' WHERE key = $1", key)
}

// grantsByRole, roleDescriptions et les `Étant donné` qui écrivent partagent une exigence : avoir
// touché une ligne. Sans elle, `Étant donné la description de "audit:reed" réécrite à la main` ne
// prépare rien, et le `Alors` qui suit est vrai sans avoir rien observé.

func (w *seedWorld) descriptionMatchesCatalog(ctx context.Context, key string) error {
	rows, err := w.query(ctx, "SELECT description FROM permissions WHERE key = $1", key)
	if err != nil {
		return err
	}

	if len(rows) != 1 {
		return fmt.Errorf("la clé %q n'est plus en base", key)
	}

	for _, entry := range permissions.All() {
		if entry.Key != permissions.Key(key) {
			continue
		}

		if rows[0][0] != entry.Description {
			return fmt.Errorf("la base décrit %q par %q, le catalogue par %q",
				key, rows[0][0], entry.Description)
		}

		return nil
	}

	return fmt.Errorf("la clé %q n'est pas au catalogue : le scénario ne prouve rien", key)
}

func (w *seedWorld) lastRunUpdatedOnly(key string) error {
	updated := w.lastOutcome.PermissionsUpdated

	if !slices.Equal(updated, []permissions.Key{permissions.Key(key)}) {
		return fmt.Errorf("la seconde exécution rapporte %v en mise à jour, et non la seule %q",
			updated, key)
	}

	// Le reste du rapport doit être muet : une remise en état qui insérerait ou révoquerait autre
	// chose au passage ferait plus que ce qu'on lui demande.
	stripped := w.lastOutcome
	stripped.PermissionsUpdated = nil

	if stripped.Changed() {
		return fmt.Errorf("la seconde exécution a changé autre chose que la description : %+v", stripped)
	}

	return nil
}

func (w *seedWorld) insertUncataloguedKey(ctx context.Context, key string) error {
	return w.exec(ctx,
		"INSERT INTO permissions (key, category, description) VALUES ($1, 'audit', 'clé d’une "+
			"release précédente')", key)
}

func (w *seedWorld) reportedAsUnknown(key string) error {
	if !slices.Contains(w.lastOutcome.UnknownPermissions, permissions.Key(key)) {
		return fmt.Errorf("le rapport ne nomme pas %q : la base garderait un vocabulaire que plus "+
			"personne ne lit, sans que rien ne le dise", key)
	}

	return nil
}

func (w *seedWorld) keyIsStillThere(ctx context.Context, key string) error {
	rows, err := w.query(ctx, "SELECT 1 FROM permissions WHERE key = $1", key)
	if err != nil {
		return err
	}

	if len(rows) != 1 {
		return fmt.Errorf("la clé %q a été supprimée : un retrait silencieux dépossède les rôles qui "+
			"la détiennent, et c'est une migration qui révoque d'abord", key)
	}

	return nil
}

func (w *seedWorld) grantByHand(ctx context.Context, key, role string) error {
	return w.exec(ctx,
		"INSERT INTO role_permissions (role_id, permission_key) "+
			"SELECT id, $1 FROM roles WHERE name = $2", key, role)
}

func (w *seedWorld) reportedAsRevoked(key, role string) error {
	if !slices.Contains(w.lastOutcome.GrantsRevoked, store.Grant{Role: role, Key: permissions.Key(key)}) {
		return fmt.Errorf("le rapport ne révoque pas %q du rôle %q : ce qu'une release retire d'un "+
			"rôle par défaut resterait accordé indéfiniment", key, role)
	}

	return nil
}

func (w *seedWorld) roleNoLongerGrants(ctx context.Context, role, key string) error {
	granted, err := w.grantsByRole(ctx)
	if err != nil {
		return err
	}

	if slices.Contains(granted[role], key) {
		return fmt.Errorf("le rôle %q accorde toujours %q", role, key)
	}

	return nil
}

func (w *seedWorld) createCustomRole(ctx context.Context, role, key string) error {
	if err := w.exec(ctx,
		"INSERT INTO roles (name, description, is_default) VALUES ($1, 'rôle créé à l’écran', false)",
		role); err != nil {
		return err
	}

	return w.grantByHand(ctx, key, role)
}

func (w *seedWorld) roleStillGrants(ctx context.Context, role, key string) error {
	granted, err := w.grantsByRole(ctx)
	if err != nil {
		return err
	}

	if !slices.Contains(granted[role], key) {
		return fmt.Errorf("le rôle %q n'accorde plus %q : le seed a touché un rôle qu'un "+
			"administrateur a composé", role, key)
	}

	return nil
}

func (w *seedWorld) reportNeverNames(role string) error {
	named := slices.Concat(w.lastOutcome.RolesInserted, w.lastOutcome.RolesUpdated,
		w.lastOutcome.UnknownRoles)

	if slices.Contains(named, role) {
		return fmt.Errorf("le rapport nomme %q, qui n'est pas un rôle par défaut", role)
	}

	for _, grant := range slices.Concat(w.lastOutcome.GrantsAdded, w.lastOutcome.GrantsRevoked) {
		if grant.Role == role {
			return fmt.Errorf("le rapport touche aux attributions de %q", role)
		}
	}

	return nil
}

// vocabularyFingerprint rend une empreinte textuelle et ordonnée du **contenu** semé — la même forme
// que l'empreinte de schéma de `base_test.go`, appliquée aux lignes plutôt qu'aux colonnes.
//
// `roles.id` en est délibérément absent : c'est un `uuidv7()` posé par la base, il diffère d'une base
// à l'autre et n'est pas ce qu'on compare. `created_at` non plus, pour la même raison.
const vocabularyCatalog = `
	SELECT coalesce(string_agg(entry, E'\n' ORDER BY entry), '')
	FROM (
		SELECT format('permission %s %s %s', key, category, description) AS entry FROM permissions
		UNION ALL
		SELECT format('role %s %s %s', name, is_default, description) FROM roles
		UNION ALL
		SELECT format('attribution %s %s', r.name, rp.permission_key)
		FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
	) AS vocabulaire`

func (w *seedWorld) vocabularyFingerprint(ctx context.Context) (string, error) {
	rows, err := w.query(ctx, vocabularyCatalog)
	if err != nil {
		return "", err
	}

	fingerprint := rows[0][0]

	// Le garde-fou déjà appris sur l'empreinte de schéma : sans lui, « avant = après » est vrai sur
	// deux chaînes vides, c'est-à-dire sur une base où le seed n'aurait rien écrit du tout.
	if fingerprint == "" {
		return "", errors.New("l'empreinte du vocabulaire est vide : la base n'a ni permission, ni " +
			"rôle, donc la comparaison « avant/après » serait vraie sans rien observer")
	}

	return fingerprint, nil
}

func (w *seedWorld) grantsByRole(ctx context.Context) (map[string][]string, error) {
	rows, err := w.query(ctx,
		"SELECT r.name, rp.permission_key FROM role_permissions rp JOIN roles r ON r.id = rp.role_id")
	if err != nil {
		return nil, err
	}

	granted := map[string][]string{}
	for _, row := range rows {
		granted[row[0]] = append(granted[row[0]], row[1])
	}

	return granted, nil
}

// query rend les lignes en texte : ces scénarios observent des noms et des descriptions, et un
// typage par colonne n'ajouterait ici qu'un scan à écrire.
func (w *seedWorld) query(ctx context.Context, sql string, args ...any) ([][]string, error) {
	conn, err := w.connect(ctx)
	if err != nil {
		return nil, err
	}

	defer func() { _ = conn.Close(ctx) }()

	rows, err := conn.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("interroger la base du scénario : %w", err)
	}

	defer rows.Close()

	var collected [][]string

	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, fmt.Errorf("lire une ligne : %w", err)
		}

		row := make([]string, 0, len(values))
		for _, value := range values {
			row = append(row, fmt.Sprint(value))
		}

		collected = append(collected, row)
	}

	return collected, rows.Err()
}

func (w *seedWorld) exec(ctx context.Context, sql string, args ...any) error {
	conn, err := w.connect(ctx)
	if err != nil {
		return err
	}

	defer func() { _ = conn.Close(ctx) }()

	tag, err := conn.Exec(ctx, sql, args...)
	if err != nil {
		return fmt.Errorf("écrire dans la base du scénario : %w", err)
	}

	if tag.RowsAffected() == 0 {
		return fmt.Errorf("la mise en scène du scénario n'a touché aucune ligne : %s", sql)
	}

	return nil
}

func (w *seedWorld) connect(ctx context.Context) (*pgx.Conn, error) {
	if w.dsn == "" {
		return nil, errors.New("aucune base n'a été taillée pour ce scénario")
	}

	conn, err := pgx.Connect(ctx, w.dsn)
	if err != nil {
		return nil, fmt.Errorf("se connecter à la base du scénario : %w", err)
	}

	return conn, nil
}
