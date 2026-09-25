package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"

	"github.com/cucumber/godog"
	"github.com/jackc/pgx/v5"
)

// accessWorld joue le titulaire d'un lien. Le binaire de scénario n'envoie aucun e-mail : le décor
// pose lui-même l'empreinte d'un jeton qu'il a tiré, comme le worker l'aurait fait.
type accessWorld struct {
	operators *operatorsWorld
	token     string
	copied    string
}

func (w *accessWorld) registerSteps(ctx *godog.ScenarioContext) {
	ctx.Given(`^le comparse n'a pas de mot de passe et a reçu un lien d'activation$`, w.receivesActivationLink)
	ctx.Given(`^le lien du comparse est parti$`, w.linkIsSent)
	ctx.Given(`^le lien du comparse a expiré$`, func(ctx context.Context) error {
		return w.execOne(ctx, "faire expirer le lien", `
			UPDATE access_links SET expires_at = now() - interval '1 second'
			WHERE token_hash IS NOT NULL
			  AND operator_id = (SELECT id FROM operators WHERE lower(email) = lower($1))`, w.operators.comparse)
	})
	ctx.Given(`^le comparse garde une copie de son lien$`, func() error {
		w.copied = w.token

		return nil
	})
	ctx.When(`^le comparse utilise son lien avec le mot de passe "([^"]*)"$`, w.useLink)
	ctx.When(`^le comparse réutilise la copie de son lien$`, func() error {
		if w.copied == "" {
			return errors.New("le comparse n'a gardé aucune copie : ce pas ne prouverait rien")
		}

		return w.post(w.copied, "Encore-un-mot-de-passe-2")
	})
	ctx.When(`^quelqu'un utilise un lien inventé avec le mot de passe "([^"]*)"$`, func(password string) error {
		raw := make([]byte, 32)
		if _, err := rand.Read(raw); err != nil {
			return err
		}

		return w.post(base64.RawURLEncoding.EncodeToString(raw), password)
	})
	ctx.When(`^le comparse se connecte avec "([^"]*)"$`, w.signIn)
	ctx.Then(`^le comparse entre avec "([^"]*)"$`, func(password string) error {
		if err := w.signIn(password); err != nil {
			return err
		}

		return w.operators.expect(http.StatusOK, "la connexion du comparse")
	})
	ctx.Then(`^le refus dit "([^"]*)"$`, w.operators.bodyNames)
}

func (w *accessWorld) receivesActivationLink(ctx context.Context) error {
	err := w.operators.exec(ctx, `UPDATE operators SET password_hash = NULL WHERE lower(email) = lower($1)`,
		w.operators.comparse)
	if err != nil {
		return err
	}

	err = w.operators.exec(ctx, `
		INSERT INTO access_links (operator_id, kind)
		SELECT id, 'activation' FROM operators WHERE lower(email) = lower($1)`, w.operators.comparse)
	if err != nil {
		return err
	}

	return w.linkIsSent(ctx)
}

// execOne refuse un décor qui ne touche aucune ligne : il ne prouverait rien.
func (w *accessWorld) execOne(ctx context.Context, what, query string, args ...any) error {
	conn, err := pgx.Connect(ctx, w.operators.login.dsn)
	if err != nil {
		return fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	tag, err := conn.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("%s : %w", what, err)
	}

	if tag.RowsAffected() != 1 {
		return fmt.Errorf("%s : %d ligne(s) touchée(s) au lieu d'une", what, tag.RowsAffected())
	}

	return nil
}

// linkIsSent fait ce que le worker fait après un envoi réussi : il ne prend qu'une demande sans
// empreinte, donc un lien que la redemande n'a pas invalidé fait échouer le décor.
func (w *accessWorld) linkIsSent(ctx context.Context) error {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return err
	}

	digest := sha256.Sum256(raw)
	w.token = base64.RawURLEncoding.EncodeToString(raw)

	return w.execOne(ctx, "envoyer le lien", `
		UPDATE access_links SET token_hash = $2, sent_at = now(), expires_at = now() + interval '1 hour'
		WHERE token_hash IS NULL
		  AND operator_id = (SELECT id FROM operators WHERE lower(email) = lower($1))`,
		w.operators.comparse, digest[:])
}

func (w *accessWorld) post(token, password string) error {
	return w.operators.sendJSON(http.MethodPost, "/api/auth/access-link",
		map[string]string{"token": token, "password": password})
}

func (w *accessWorld) useLink(password string) error {
	if err := w.post(w.token, password); err != nil {
		return err
	}

	if w.operators.login.process.received.status == http.StatusNoContent {
		w.operators.comparsePassword = password
	}

	return nil
}

func (w *accessWorld) signIn(password string) error {
	return w.operators.asComparse(func() error {
		return w.operators.login.postCredentials(w.operators.comparse, password)
	})
}
