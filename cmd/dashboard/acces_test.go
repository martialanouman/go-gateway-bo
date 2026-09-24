package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"

	"github.com/cucumber/godog"
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
		return w.operators.exec(ctx, `
			UPDATE access_links SET expires_at = now() - interval '1 second'
			WHERE operator_id = (SELECT id FROM operators WHERE lower(email) = lower($1))`, w.operators.comparse)
	})
	ctx.Given(`^le comparse a reçu un second lien$`, func(ctx context.Context) error {
		return w.queueAndSend(ctx, "reset")
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

	return w.queueAndSend(ctx, "activation")
}

func (w *accessWorld) queueAndSend(ctx context.Context, kind string) error {
	err := w.operators.exec(ctx, `
		INSERT INTO access_links (operator_id, kind)
		SELECT id, $2 FROM operators WHERE lower(email) = lower($1)
		ON CONFLICT (operator_id) DO NOTHING`, w.operators.comparse, kind)
	if err != nil {
		return err
	}

	return w.linkIsSent(ctx)
}

// linkIsSent fait ce que le worker fait après un envoi réussi, sur la demande en file.
func (w *accessWorld) linkIsSent(ctx context.Context) error {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return err
	}

	digest := sha256.Sum256(raw)
	w.token = base64.RawURLEncoding.EncodeToString(raw)

	return w.operators.exec(ctx, `
		UPDATE access_links SET token_hash = $2, sent_at = now(), expires_at = now() + interval '1 hour'
		WHERE operator_id = (SELECT id FROM operators WHERE lower(email) = lower($1))`,
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
