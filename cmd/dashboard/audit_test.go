package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/cucumber/godog"
	"github.com/jackc/pgx/v5"
)

// auditWorld relit le journal **dans la base**, et non ce qu'une route en dirait : aucune ne le rend
// avant step-184, et l'écran de consultation n'existera pas avant M9. Ce que ces pas observent est
// donc l'écriture elle-même, à l'endroit où une enquête irait la chercher.
type auditWorld struct {
	login *loginWorld
	mfa   *mfaWorld
}

func (w *auditWorld) registerSteps(ctx *godog.ScenarioContext) {
	ctx.Then(`^le journal porte (\d+) événement "([^"]+)"$`, w.journalHolds)
	ctx.Then(`^l'événement porte l'adresse de l'appelant$`, w.eventCarriesTheAddress)
	ctx.Then(`^le journal ne porte ni le secret ni les codes de récupération$`, w.journalHidesSecrets)
	ctx.Given(`^les partitions du journal sont retirées$`, w.auditPartitionsRemoved)
	ctx.When(`^l'opérateur remplace son application d'authentification$`,
		w.mfa.replaceProvingTheCurrentCode)
	ctx.When(`^l'opérateur retire sa clé d'accès$`, w.removeTheRegisteredPasskey)
	ctx.Then(`^la requête est refusée$`, w.requestIsRefused)
	ctx.Then(`^l'ancien second facteur est toujours en place$`, w.oldSecondFactorStillWorks)
	ctx.Then(`^l'opérateur ne détient aucune clé d'accès$`, func() error { return w.passkeysHeld(0) })
	// Deux clés au décor, à cause de la garde du dernier facteur (§6.9) : en retirer une laisserait
	// toujours en compter deux si le retrait n'a pas eu lieu, une seule si le journal manquant ne l'a
	// pas empêché.
	ctx.Then(`^l'opérateur détient toujours sa clé d'accès$`, func() error { return w.passkeysHeld(2) })
}

func (w *auditWorld) connect(ctx context.Context) (*pgx.Conn, error) {
	conn, err := pgx.Connect(ctx, w.login.dsn)
	if err != nil {
		return nil, fmt.Errorf("joindre la base du scénario : %w", err)
	}

	return conn, nil
}

func (w *auditWorld) journalHolds(ctx context.Context, expected int, action string) error {
	conn, err := w.connect(ctx)
	if err != nil {
		return err
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	var written int

	err = conn.QueryRow(ctx, `SELECT count(*) FROM audit_log WHERE action = $1`, action).Scan(&written)
	if err != nil {
		return fmt.Errorf("compter les événements %q : %w", action, err)
	}

	if written != expected {
		return fmt.Errorf("le journal porte %d événement(s) %q pour %d attendu(s)",
			written, action, expected)
	}

	return nil
}

// eventCarriesTheAddress observe ce que l'enquête cherche en second, après le nom de l'action. Un
// journal qui perdrait l'adresse ne le dirait nulle part : la colonne est nullable.
func (w *auditWorld) eventCarriesTheAddress(ctx context.Context) error {
	conn, err := w.connect(ctx)
	if err != nil {
		return err
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	var addressed int

	err = conn.QueryRow(ctx,
		`SELECT count(*) FROM audit_log WHERE ip_address IS NOT NULL`).Scan(&addressed)
	if err != nil {
		return fmt.Errorf("lire les adresses du journal : %w", err)
	}

	if addressed == 0 {
		return fmt.Errorf("aucun événement ne porte d'adresse : une enquête ne saurait pas d'où " +
			"l'action est partie")
	}

	return nil
}

// journalHidesSecrets cherche les **valeurs**, pas les noms de champ. Chercher `"secret"` dans le
// journal dirait seulement qu'aucune clé ne s'appelle ainsi ; ce qui compte est que la valeur rendue
// à l'opérateur ne s'y trouve pas, sous quelque nom que ce soit.
func (w *auditWorld) journalHidesSecrets(ctx context.Context) error {
	if w.mfa.enrolled.Secret == "" {
		return fmt.Errorf("aucun enrôlement n'a eu lieu : ce pas ne chercherait rien")
	}

	conn, err := w.connect(ctx)
	if err != nil {
		return err
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	var journal string

	err = conn.QueryRow(ctx,
		`SELECT coalesce(string_agg(coalesce(before_json::text, '') || ' ' ||
			coalesce(after_json::text, '') || ' ' || coalesce(target_id, ''), ' '), '')
		FROM audit_log`).Scan(&journal)
	if err != nil {
		return fmt.Errorf("relire le journal : %w", err)
	}

	if strings.Contains(journal, w.mfa.enrolled.Secret) {
		return fmt.Errorf("le secret du second facteur est dans le journal d'audit")
	}

	for _, code := range w.mfa.enrolled.RecoveryCodes {
		if strings.Contains(journal, code) {
			return fmt.Errorf("un code de récupération est dans le journal d'audit")
		}
	}

	return nil
}

// auditPartitionsRemoved place la base dans l'état du mois où plus personne ne renouvelle les
// partitions : toute écriture au journal échoue. C'est la seule façon d'observer, de bout en bout,
// qu'une action refuse d'aboutir sans sa trace.
//
// Le SQL est celui de `internal/store/audit_partitions_test.go`, recopié parce que ce helper-là est
// privé à son paquet de test : l'exporter du produit pour un décor ferait entrer le harnais dans le
// livré.
func (w *auditWorld) auditPartitionsRemoved(ctx context.Context) error {
	conn, err := w.connect(ctx)
	if err != nil {
		return err
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	const partitions = `
		SELECT child.relname
		FROM pg_inherits
		JOIN pg_class AS parent ON parent.oid = pg_inherits.inhparent
		JOIN pg_class AS child ON child.oid = pg_inherits.inhrelid
		WHERE parent.relname = 'audit_log'`

	rows, err := conn.Query(ctx, partitions)
	if err != nil {
		return fmt.Errorf("lister les partitions du journal : %w", err)
	}

	var names []string

	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			rows.Close()

			return fmt.Errorf("lire le nom d'une partition : %w", err)
		}

		names = append(names, name)
	}

	rows.Close()

	if err = rows.Err(); err != nil {
		return fmt.Errorf("parcourir les partitions du journal : %w", err)
	}

	if len(names) == 0 {
		return errors.New("aucune partition à retirer : le décor n'exercerait rien")
	}

	for _, name := range names {
		// Le nom vient du catalogue de cette base, jamais d'une donnée reçue.
		if _, err = conn.Exec(ctx, "DROP TABLE "+name); err != nil {
			return fmt.Errorf("retirer la partition %s : %w", name, err)
		}
	}

	return nil
}

// requestIsRefused observe ce que le navigateur reçoit quand l'audit ne peut pas s'écrire : la
// transaction de l'action emporte son écriture, l'erreur remonte, et le contrat n'a qu'une réponse
// pour une erreur qui remonte ainsi — 500 `internal_error`, la même que toute panne côté serveur.
func (w *auditWorld) requestIsRefused() error {
	if status := w.login.process.received.status; status != http.StatusInternalServerError {
		return fmt.Errorf("la requête a répondu %d et non 500 : l'action semble avoir eu lieu malgré "+
			"la trace manquante", status)
	}

	return nil
}

// oldSecondFactorStillWorks présente un code de récupération de l'enrôlement d'avant. Le secret et
// ses dix codes sont écrits dans la même transaction : des codes qui ouvrent encore disent que rien
// de l'ancien facteur n'a été remplacé.
//
// **Pas un code TOTP, et ce n'est pas un choix** : la preuve qu'exige le remplacement vient de
// consommer le pas de temps, et l'anti-rejeu — qui, lui, s'écrit hors de la transaction de
// l'enrôlement — refuserait ensuite les deux seuls pas encore dans la fenêtre de dérive. Le 401 dirait
// alors « rejeu » là où ce pas veut lire « secret disparu », et il le dirait dans les deux cas.
//
// Les partitions sont rétablies d'abord : sans journal inscriptible, **toute** route répond 500 — y
// compris celle-ci — et ce pas passerait sans avoir rien observé.
func (w *auditWorld) oldSecondFactorStillWorks(ctx context.Context) error {
	if len(w.mfa.enrolled.RecoveryCodes) == 0 {
		return errors.New("aucun enrôlement : le scénario n'a pas d'ancien facteur à présenter")
	}

	if err := w.auditPartitionsRestored(ctx); err != nil {
		return err
	}

	if err := w.mfa.presentFirstRecoveryCode(); err != nil {
		return err
	}

	if status := w.login.process.received.status; status != http.StatusNoContent {
		return fmt.Errorf("un code de récupération de l'ancien facteur est refusé (%d) : le "+
			"remplacement a détruit ce que la trace manquante devait retenir", status)
	}

	return nil
}

func (w *auditWorld) auditPartitionsRestored(ctx context.Context) error {
	conn, err := w.connect(ctx)
	if err != nil {
		return err
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	if _, err = conn.Exec(ctx, "SELECT ensure_audit_log_partitions(now())"); err != nil {
		return fmt.Errorf("rétablir les partitions du journal : %w", err)
	}

	return nil
}

// removeTheRegisteredPasskey retire la clé d'accès du compte, désignée par son identifiant en base :
// c'est par lui que la route la retrouve, jamais par celui que l'authentificateur s'est choisi.
func (w *auditWorld) removeTheRegisteredPasskey(ctx context.Context) error {
	conn, err := w.connect(ctx)
	if err != nil {
		return err
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	var id string

	err = conn.QueryRow(ctx, `SELECT id FROM webauthn_credentials LIMIT 1`).Scan(&id)
	if err != nil {
		return fmt.Errorf("lire la clé d'accès enregistrée : %w", err)
	}

	return w.login.process.remove("/api/auth/mfa/webauthn/passkeys/" + id)
}

// passkeysHeld relit `/auth/me`, seul endroit d'où le client apprend ce qu'il détient.
func (w *auditWorld) passkeysHeld(expected int) error {
	if err := w.login.process.fetch("/api/auth/me"); err != nil {
		return err
	}

	if w.login.process.received.status != http.StatusOK {
		return fmt.Errorf("/auth/me a répondu %d : ce pas ne peut rien affirmer du compte",
			w.login.process.received.status)
	}

	var decoded me

	if err := json.Unmarshal([]byte(w.login.process.received.body), &decoded); err != nil {
		return fmt.Errorf("relire le corps de /auth/me : %w", err)
	}

	if decoded.SecondFactors.Passkeys != expected {
		return fmt.Errorf("l'opérateur détient %d clé(s) d'accès pour %d attendue(s)",
			decoded.SecondFactors.Passkeys, expected)
	}

	return nil
}
