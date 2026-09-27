package main

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"

	"github.com/cucumber/godog"
	"github.com/jackc/pgx/v5"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
)

const notificationReaderEmail = "claire.nguessan@exemple.test"

type notificationsWorld struct {
	operators    *operatorsWorld
	realtime     *realtimeWorld
	notification string
	// secondCookies est le navigateur du second opérateur, retenu pour lire son centre plus tard.
	secondCookies map[string]string
}

func (w *notificationsWorld) registerSteps(ctx *godog.ScenarioContext) {
	ctx.Given(`^une notification de facturation déjà écrite$`, w.writeBillingNotification)
	ctx.Given(`^un second opérateur détenant le rôle "([^"]*)"$`, w.secondOperatorWithRole)
	ctx.When(`^l'opérateur marque la notification lue$`, func() error { return w.markRead(w.notification) })
	ctx.When(`^l'opérateur marque lue une notification qui n'existe pas$`, func() error {
		return w.markRead("0199a000-0000-7000-8000-000000000000")
	})
	ctx.Then(`^la socket reçoit une notification de facturation$`, func() error {
		w.realtime.expected = map[string]any{"kind": "billing_alert", "source": "billing_alert_stream"}

		return w.realtime.receivesExpected("notifications")
	})
	ctx.Then(`^le centre de l'opérateur compte (\d+) notifications? non lues?$`, w.centreCounts)
	ctx.Then(`^le centre du second opérateur compte (\d+) notifications? non lues?$`, func(unread int) error {
		return w.asSecond(func() error { return w.centreCounts(unread) })
	})
	ctx.Then(`^le journal d'audit porte "([^"]*)" sur cette notification$`, w.auditCarries)
}

func (w *notificationsWorld) process() *process { return w.operators.login.process }

func (w *notificationsWorld) writeBillingNotification(ctx context.Context) error {
	conn, err := pgx.Connect(ctx, w.operators.login.dsn)
	if err != nil {
		return fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	return conn.QueryRow(ctx, `
		INSERT INTO notifications (source, severity, kind, details)
		VALUES ('billing_alert_stream', 'warning', 'billing_alert',
		        '{"customerId":"cust-1","ownerType":"customer","ownerId":"cust-1",
		          "alert":"mo_floor_reached","balance":5000}')
		RETURNING id::text`).Scan(&w.notification)
}

// secondOperatorWithRole ouvre la session élevée du second opérateur dans son propre navigateur, puis
// rend au scénario un navigateur vierge pour l'opérateur principal.
func (w *notificationsWorld) secondOperatorWithRole(ctx context.Context, role string) error {
	hash, err := auth.Hash(scenarioPassword)
	if err != nil {
		return fmt.Errorf("hacher le mot de passe du second opérateur : %w", err)
	}

	err = w.operators.exec(ctx, `
		WITH o AS (INSERT INTO operators (email, display_name, password_hash)
		           VALUES ($1, 'Claire Nguessan', $2) RETURNING id)
		INSERT INTO operator_roles (operator_id, role_id)
		SELECT o.id, r.id FROM o, roles r WHERE r.name = $3`, notificationReaderEmail, hash, role)
	if err != nil {
		return err
	}

	return w.asSecond(func() error {
		login := w.operators.login
		factor := &mfaWorld{login: login}

		if err := login.postCredentials(notificationReaderEmail, scenarioPassword); err != nil {
			return err
		}

		if err := factor.enroll(); err != nil {
			return err
		}

		if err := factor.presentCodeAtOffset(0)(ctx); err != nil {
			return err
		}

		return w.operators.expect(http.StatusNoContent, "l'élévation du second opérateur")
	})
}

func (w *notificationsWorld) asSecond(do func() error) error {
	p := w.process()
	own, challenge := maps.Clone(p.cookies), w.operators.login.challenge
	p.cookies = maps.Clone(w.secondCookies)

	err := do()

	w.secondCookies = maps.Clone(p.cookies)
	p.cookies, w.operators.login.challenge = own, challenge

	return err
}

func (w *notificationsWorld) markRead(id string) error {
	if err := w.process().post("/api/notifications/"+id+"/read", ""); err != nil {
		return err
	}

	if w.process().received.status >= http.StatusBadRequest {
		w.operators.login.refusals = append(w.operators.login.refusals, *w.process().received)
	}

	return nil
}

func (w *notificationsWorld) centreCounts(unread int) error {
	if err := w.process().fetch("/api/notifications"); err != nil {
		return err
	}

	if err := w.operators.expect(http.StatusOK, "le centre de notifications"); err != nil {
		return err
	}

	var page struct {
		UnreadCount int `json:"unreadCount"`
	}
	if err := json.Unmarshal([]byte(w.process().received.body), &page); err != nil {
		return fmt.Errorf("relire le centre : %w", err)
	}

	if page.UnreadCount != unread {
		return fmt.Errorf("le centre compte %d non lues, %d attendues :\n%s", page.UnreadCount, unread,
			w.process().received.body)
	}

	return nil
}

func (w *notificationsWorld) auditCarries(ctx context.Context, action string) error {
	conn, err := pgx.Connect(ctx, w.operators.login.dsn)
	if err != nil {
		return fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	var count int

	err = conn.QueryRow(ctx, `
		SELECT count(*) FROM audit_log
		WHERE action = $1 AND target_type = 'notification' AND target_id = $2`,
		action, w.notification).Scan(&count)
	if err != nil {
		return fmt.Errorf("lire le journal : %w", err)
	}

	if count != 1 {
		return fmt.Errorf("le journal porte %d événement %q sur la notification, 1 attendu", count, action)
	}

	return nil
}
