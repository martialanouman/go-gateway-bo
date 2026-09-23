package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strings"

	"github.com/cucumber/godog"
	"github.com/jackc/pgx/v5"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
	"github.com/martialanouman/go-gateway-bo/internal/permissions"
)

// chosenPassword est celui que l'administrateur choisit pour les comptes qu'il crée : douze
// caractères au moins, la politique du bootstrap.
const chosenPassword = "un mot de passe choisi par l'administrateur"

// operatorsWorld porte deux navigateurs : celui de l'administrateur, que le harnais tient, et celui
// du comparse, mis de côté pendant que l'administrateur agit.
type operatorsWorld struct {
	login    *loginWorld
	mfa      *mfaWorld
	comparse string
	// comparseCookies est le navigateur du comparse, retenu pour être rejoué après le geste de
	// l'administrateur.
	comparseCookies map[string]string
}

func (w *operatorsWorld) registerSteps(ctx *godog.ScenarioContext) {
	ctx.Given(`^l'opérateur détient le rôle "([^"]*)"$`, w.holdOnly)
	ctx.Given(`^l'opérateur ne détient plus que le rôle "([^"]*)"$`, w.holdOnly)
	ctx.Given(`^l'opérateur ne détient plus que le rôle personnalisé "([^"]*)" accordant "([^"]*)"$`,
		w.holdOnlyCustomRole)
	ctx.Given(`^un comparse "([^"]*)" sans rôle$`, w.comparseWithoutRole)
	ctx.Given(`^l'opérateur ouvre une session élevée$`, w.openElevatedSession)
	ctx.Given(`^le comparse est connecté dans un autre navigateur$`, w.comparseSignsInElsewhere)
	ctx.Given(`^le comparse a enrôlé une application d'authentification$`, w.comparseEnrolls)
	ctx.Given(`^l'opérateur a créé le rôle "([^"]*)" accordant "([^"]*)"$`, w.createRole)
	ctx.Given(`^l'opérateur a attribué le rôle "([^"]*)" au comparse$`, w.assignRoleToComparse)

	ctx.When(`^l'opérateur crée l'opérateur "([^"]*)"$`, func(email string) error {
		return w.createOperator(email, chosenPassword)
	})
	ctx.When(`^l'opérateur crée l'opérateur "([^"]*)" avec le mot de passe "([^"]*)"$`, w.createOperator)
	ctx.When(`^l'opérateur demande la liste des opérateurs$`, func() error {
		return w.login.process.fetch("/api/operators")
	})
	ctx.When(`^l'opérateur demande la liste des rôles$`, func() error {
		return w.login.process.fetch("/api/roles")
	})
	ctx.When(`^l'opérateur attribue le rôle "([^"]*)" au comparse$`, w.assignRoleToComparse)
	ctx.When(`^l'opérateur s'attribue le seul rôle "([^"]*)"$`, w.assignRoleToSelf)
	ctx.When(`^l'opérateur désactive son propre compte$`, func(ctx context.Context) error {
		return w.setStatus(ctx, scenarioEmail, "disabled")
	})
	ctx.When(`^l'opérateur désactive le comparse$`, func(ctx context.Context) error {
		return w.setStatus(ctx, w.comparse, "disabled")
	})
	ctx.When(`^l'opérateur réactive le comparse$`, func(ctx context.Context) error {
		return w.setStatus(ctx, w.comparse, "active")
	})
	ctx.When(`^l'opérateur réinitialise le second facteur du comparse$`, func(ctx context.Context) error {
		return w.resetSecondFactors(ctx, w.comparse)
	})
	ctx.When(`^l'opérateur réinitialise son propre second facteur$`, func(ctx context.Context) error {
		return w.resetSecondFactors(ctx, scenarioEmail)
	})
	ctx.When(`^l'opérateur crée le rôle "([^"]*)" accordant "([^"]*)"$`, w.createRole)
	ctx.When(`^l'opérateur accorde aussi "([^"]*)" au rôle "([^"]*)"$`, w.grantToRole)
	ctx.When(`^l'opérateur retire "([^"]*)" du rôle "([^"]*)"$`, w.revokeFromRole)
	ctx.When(`^l'opérateur supprime le rôle "([^"]*)"$`, w.deleteRole)

	ctx.Then(`^le refus nomme la permission "([^"]*)"$`, w.bodyNames)
	ctx.Then(`^le refus nomme "([^"]*)"$`, w.bodyNames)
	ctx.Then(`^"([^"]*)" se connecte avec le mot de passe choisi pour elle$`, w.signsInWithChosenPassword)
	ctx.Then(`^la liste porte "([^"]*)" sans rôle$`, w.listCarriesOperatorWithoutRole)
	ctx.Then(`^la liste porte les neuf rôles par défaut$`, w.listCarriesDefaultRoles)
	ctx.Then(`^l'opérateur détient toujours la permission "([^"]*)"$`, w.stillHolds)
	ctx.Then(`^la session du comparse est refusée$`, w.comparseSessionIsRefused)
	ctx.Then(`^le comparse se reconnecte sans aucun second facteur$`, w.comparseSignsInWithoutFactor)
}

func (w *operatorsWorld) exec(ctx context.Context, query string, args ...any) error {
	conn, err := pgx.Connect(ctx, w.login.dsn)
	if err != nil {
		return fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	if _, err = conn.Exec(ctx, query, args...); err != nil {
		return fmt.Errorf("préparer le décor : %w", err)
	}

	return nil
}

func (w *operatorsWorld) idOf(ctx context.Context, query, name string) (string, error) {
	conn, err := pgx.Connect(ctx, w.login.dsn)
	if err != nil {
		return "", fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	var id string
	if err = conn.QueryRow(ctx, query, name).Scan(&id); err != nil {
		return "", fmt.Errorf("retrouver %q : %w", name, err)
	}

	return id, nil
}

func (w *operatorsWorld) operatorID(ctx context.Context, email string) (string, error) {
	return w.idOf(ctx, `SELECT id::text FROM operators WHERE lower(email) = lower($1)`, email)
}

func (w *operatorsWorld) roleID(ctx context.Context, name string) (string, error) {
	return w.idOf(ctx, `SELECT id::text FROM roles WHERE name = $1`, name)
}

func (w *operatorsWorld) holdOnly(ctx context.Context, role string) error {
	return w.exec(ctx, `
		WITH o AS (SELECT id FROM operators WHERE lower(email) = $1),
		     cleared AS (DELETE FROM operator_roles WHERE operator_id = (SELECT id FROM o))
		INSERT INTO operator_roles (operator_id, role_id)
		SELECT o.id, r.id FROM o, roles r WHERE r.name = $2`, scenarioEmail, role)
}

func (w *operatorsWorld) holdOnlyCustomRole(ctx context.Context, role, keys string) error {
	err := w.exec(ctx, `
		WITH created AS (INSERT INTO roles (name, description) VALUES ($1, '') RETURNING id)
		INSERT INTO role_permissions (role_id, permission_key)
		SELECT created.id, key FROM created, unnest($2::text[]) AS key`, role, strings.Fields(keys))
	if err != nil {
		return err
	}

	return w.holdOnly(ctx, role)
}

func (w *operatorsWorld) comparseWithoutRole(ctx context.Context, email string) error {
	hash, err := auth.Hash(scenarioPassword)
	if err != nil {
		return fmt.Errorf("hacher le mot de passe du comparse : %w", err)
	}

	w.comparse = email

	return w.exec(ctx,
		`INSERT INTO operators (email, display_name, password_hash) VALUES ($1, 'Martin Leroy', $2)`,
		email, hash)
}

func (w *operatorsWorld) openElevatedSession(ctx context.Context) error {
	if err := w.login.signInWithTheRightPassword(); err != nil {
		return err
	}

	if err := w.mfa.enroll(); err != nil {
		return err
	}

	if err := w.mfa.presentCodeAtOffset(0)(ctx); err != nil {
		return err
	}

	return w.expect(http.StatusNoContent, "l'élévation de l'administrateur")
}

// asComparse fait agir le comparse dans son propre navigateur, puis rend la main à l'administrateur
// avec les cookies qu'il portait.
func (w *operatorsWorld) asComparse(do func() error) error {
	admin := maps.Clone(w.login.process.cookies)
	w.login.process.cookies = maps.Clone(w.comparseCookies)

	err := do()

	w.comparseCookies = maps.Clone(w.login.process.cookies)
	w.login.process.cookies = admin

	return err
}

func (w *operatorsWorld) comparseSignsInElsewhere() error {
	return w.asComparse(func() error {
		if err := w.login.postCredentials(w.comparse, scenarioPassword); err != nil {
			return err
		}

		return w.expect(http.StatusOK, "la connexion du comparse")
	})
}

func (w *operatorsWorld) comparseEnrolls() error {
	return w.asComparse(func() error {
		if err := w.login.postCredentials(w.comparse, scenarioPassword); err != nil {
			return err
		}

		if err := w.login.process.post("/api/auth/mfa/totp/enroll", "{}"); err != nil {
			return err
		}

		return w.expect(http.StatusOK, "l'enrôlement du comparse")
	})
}

func (w *operatorsWorld) expect(status int, what string) error {
	if got := w.login.process.received.status; got != status {
		return fmt.Errorf("%s a répondu %d au lieu de %d :\n%s", what, got, status,
			w.login.process.received.body)
	}

	return nil
}

func (w *operatorsWorld) sendJSON(method, path string, body any) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("composer le corps : %w", err)
	}

	return w.login.process.send(method, path, "application/json", string(encoded))
}

func (w *operatorsWorld) createOperator(email, password string) error {
	return w.sendJSON(http.MethodPost, "/api/operators", map[string]string{
		"email": email, "displayName": "Nadia Benali", "password": password,
	})
}

func (w *operatorsWorld) setRoles(ctx context.Context, email string, roles ...string) error {
	id, err := w.operatorID(ctx, email)
	if err != nil {
		return err
	}

	roleIDs := make([]string, 0, len(roles))

	for _, role := range roles {
		roleID, err := w.roleID(ctx, role)
		if err != nil {
			return err
		}

		roleIDs = append(roleIDs, roleID)
	}

	return w.sendJSON(http.MethodPost, "/api/operators/"+id+"/roles", map[string][]string{"roleIds": roleIDs})
}

func (w *operatorsWorld) assignRoleToComparse(ctx context.Context, role string) error {
	return w.setRoles(ctx, w.comparse, role)
}

func (w *operatorsWorld) assignRoleToSelf(ctx context.Context, role string) error {
	return w.setRoles(ctx, scenarioEmail, role)
}

func (w *operatorsWorld) setStatus(ctx context.Context, email, status string) error {
	id, err := w.operatorID(ctx, email)
	if err != nil {
		return err
	}

	return w.sendJSON(http.MethodPatch, "/api/operators/"+id, map[string]string{"status": status})
}

func (w *operatorsWorld) resetSecondFactors(ctx context.Context, email string) error {
	id, err := w.operatorID(ctx, email)
	if err != nil {
		return err
	}

	return w.login.process.remove("/api/operators/" + id + "/second-factors")
}

func (w *operatorsWorld) createRole(role, keys string) error {
	return w.sendJSON(http.MethodPost, "/api/roles", map[string]any{
		"name": role, "description": "", "permissions": strings.Fields(keys),
	})
}

func (w *operatorsWorld) rolePermissions(ctx context.Context, role string) ([]string, error) {
	conn, err := pgx.Connect(ctx, w.login.dsn)
	if err != nil {
		return nil, fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	var keys []string

	err = conn.QueryRow(ctx, `
		SELECT coalesce(array_agg(rp.permission_key), '{}')
		FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
		WHERE r.name = $1`, role).Scan(&keys)
	if err != nil {
		return nil, fmt.Errorf("lire les permissions de %q : %w", role, err)
	}

	return keys, nil
}

func (w *operatorsWorld) updateRole(ctx context.Context, role string, edit func([]string) []string) error {
	id, err := w.roleID(ctx, role)
	if err != nil {
		return err
	}

	keys, err := w.rolePermissions(ctx, role)
	if err != nil {
		return err
	}

	return w.sendJSON(http.MethodPatch, "/api/roles/"+id, map[string]any{
		"description": "", "permissions": edit(keys),
	})
}

func (w *operatorsWorld) grantToRole(ctx context.Context, key, role string) error {
	return w.updateRole(ctx, role, func(keys []string) []string { return append(keys, key) })
}

func (w *operatorsWorld) revokeFromRole(ctx context.Context, key, role string) error {
	return w.updateRole(ctx, role, func(keys []string) []string {
		return slices.DeleteFunc(keys, func(held string) bool { return held == key })
	})
}

func (w *operatorsWorld) deleteRole(ctx context.Context, role string) error {
	id, err := w.roleID(ctx, role)
	if err != nil {
		return err
	}

	return w.login.process.remove("/api/roles/" + id)
}

func (w *operatorsWorld) bodyNames(fragment string) error {
	if body := w.login.process.received.body; !strings.Contains(body, fragment) {
		return fmt.Errorf("la réponse ne nomme pas %q :\n%s", fragment, body)
	}

	return nil
}

func (w *operatorsWorld) signsInWithChosenPassword(email string) error {
	if err := w.login.postCredentials(email, chosenPassword); err != nil {
		return err
	}

	return w.expect(http.StatusOK, "la connexion de l'opérateur créé")
}

type listedOperator struct {
	Email string `json:"email"`
	Roles []struct {
		Name string `json:"name"`
	} `json:"roles"`
}

func (w *operatorsWorld) listCarriesOperatorWithoutRole(email string) error {
	var listed []listedOperator
	if err := json.Unmarshal([]byte(w.login.process.received.body), &listed); err != nil {
		return fmt.Errorf("relire la liste : %w", err)
	}

	for _, operator := range listed {
		if operator.Email == email {
			if len(operator.Roles) != 0 {
				return fmt.Errorf("%s détient %d rôle(s)", email, len(operator.Roles))
			}

			return nil
		}
	}

	return fmt.Errorf("la liste ne porte pas %s :\n%s", email, w.login.process.received.body)
}

func (w *operatorsWorld) listCarriesDefaultRoles() error {
	var listed []struct {
		Name      string `json:"name"`
		IsDefault bool   `json:"isDefault"`
	}
	if err := json.Unmarshal([]byte(w.login.process.received.body), &listed); err != nil {
		return fmt.Errorf("relire la liste : %w", err)
	}

	var defaults []string

	for _, role := range listed {
		if role.IsDefault {
			defaults = append(defaults, role.Name)
		}
	}

	var expected []string
	for _, role := range permissions.DefaultRoles() {
		expected = append(expected, role.Name)
	}

	slices.Sort(expected)
	slices.Sort(defaults)

	if !slices.Equal(defaults, expected) {
		return fmt.Errorf("rôles par défaut listés %v, attendus %v", defaults, expected)
	}

	return nil
}

func (w *operatorsWorld) stillHolds(key string) error {
	if err := w.login.process.fetch("/api/auth/me"); err != nil {
		return err
	}

	var decoded me
	if err := json.Unmarshal([]byte(w.login.process.received.body), &decoded); err != nil {
		return fmt.Errorf("relire /auth/me : %w", err)
	}

	if !slices.Contains(decoded.Permissions, key) {
		return fmt.Errorf("l'opérateur ne détient plus %q : il s'est enfermé dehors", key)
	}

	return nil
}

func (w *operatorsWorld) comparseSessionIsRefused() error {
	if w.comparseCookies == nil {
		return errors.New("le comparse n'a jamais ouvert de session : ce pas ne prouverait rien")
	}

	status := 0

	err := w.asComparse(func() error {
		if err := w.login.process.fetch("/api/auth/me"); err != nil {
			return err
		}

		status = w.login.process.received.status

		return nil
	})
	if err != nil {
		return err
	}

	if status != http.StatusUnauthorized {
		return fmt.Errorf("la session du comparse répond %d : elle a survécu au geste", status)
	}

	return nil
}

func (w *operatorsWorld) comparseSignsInWithoutFactor() error {
	var factors me

	err := w.asComparse(func() error {
		if err := w.login.postCredentials(w.comparse, scenarioPassword); err != nil {
			return err
		}

		if err := w.login.process.fetch("/api/auth/me"); err != nil {
			return err
		}

		return json.Unmarshal([]byte(w.login.process.received.body), &factors)
	})
	if err != nil {
		return err
	}

	if factors.SecondFactors.TOTP || factors.SecondFactors.Passkeys != 0 {
		return fmt.Errorf("le comparse détient encore un second facteur : %+v", factors.SecondFactors)
	}

	return nil
}
