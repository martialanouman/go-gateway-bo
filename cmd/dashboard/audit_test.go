package main

import (
	"context"
	"fmt"
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
