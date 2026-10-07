package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"time"

	"github.com/cucumber/godog"
	"github.com/jackc/pgx/v5"

	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/martialanouman/go-gateway-bo/internal/fakegateway"
	"github.com/martialanouman/go-gateway-bo/internal/gateway"
)

type gatewayTokenWorld struct {
	process  *process
	login    *loginWorld
	verifier *fakegateway.Verifier
	upstream *httptest.Server
}

func (w *gatewayTokenWorld) registerSteps(ctx *godog.ScenarioContext) {
	ctx.Given(`^une passerelle qui vérifie les jetons du tableau de bord$`, w.verifyingGateway)
	ctx.Given(`^une passerelle qui refuse tout jeton$`, func() error {
		return w.answering(http.StatusUnauthorized, "unauthenticated")
	})
	ctx.Given(`^une passerelle qui répond (\d+) "([^"]*)"$`, w.answering)
	ctx.Then(`^la passerelle a reçu un jeton au nom de l'opérateur avec le scope "([^"]*)"$`, w.receivedOperatorToken)
	ctx.Then(`^la passerelle n'a reçu aucun cookie$`, w.receivedNoCookie)
	ctx.Then(`^aucune sortie ne porte le jeton reçu par la passerelle$`, w.outputHidesTheToken)
	ctx.Then(`^la passerelle a ouvert le flux "([^"]*)" au nom de l'identité système avec le scope "([^"]*)"$`, w.openedFeedAsSystem)
	ctx.Then(`^la réponse publie une clé ES256 sans partie privée$`, w.publishesPublicKeyOnly)
	ctx.After(func(ctx context.Context, _ *godog.Scenario, _ error) (context.Context, error) {
		if w.upstream != nil {
			w.upstream.Close()
		}

		return ctx, nil
	})
}

// verifyingGateway fixe l'adresse du serveur avant son démarrage : la passerelle doit connaître l'URL
// du JWKS, et le serveur ouvre ses flux dès qu'il écoute.
func (w *gatewayTokenWorld) verifyingGateway() error {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}

	addr := listener.Addr().String()
	_ = listener.Close()

	w.process.env["DASHBOARD_ADDR"] = addr
	w.verifier = fakegateway.Verifying(config.MockTokenIssuer, "http://"+addr+"/.well-known/jwks.json")
	w.upstream = httptest.NewServer(w.verifier)
	w.process.env["DASHBOARD_GATEWAY_BASE_URL"] = w.upstream.URL

	return nil
}

func (w *gatewayTokenWorld) answering(status int, code string) error {
	w.upstream = httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, _ *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		rw.WriteHeader(status)
		_, _ = fmt.Fprintf(rw, `{"code":%q,"message":"refus de scénario"}`, code)
	}))
	w.process.env["DASHBOARD_GATEWAY_BASE_URL"] = w.upstream.URL

	return nil
}

func (w *gatewayTokenWorld) lastOn(prefix string) (fakegateway.Principal, error) {
	seen := w.verifier.Seen()
	for i := len(seen) - 1; i >= 0; i-- {
		if strings.HasPrefix(seen[i].Path, prefix) {
			return seen[i], nil
		}
	}

	return fakegateway.Principal{}, fmt.Errorf("aucun appel vérifié sur %s, reçus : %v", prefix, seen)
}

func (w *gatewayTokenWorld) operatorID(ctx context.Context) (string, error) {
	conn, err := pgx.Connect(ctx, w.login.dsn)
	if err != nil {
		return "", fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	var id string
	err = conn.QueryRow(ctx, `SELECT id::text FROM operators WHERE lower(email) = $1`,
		strings.ToLower(scenarioEmail)).Scan(&id)

	return id, err
}

func (w *gatewayTokenWorld) receivedOperatorToken(ctx context.Context, scope string) error {
	got, err := w.lastOn("/admin/customer-groups")
	if err != nil {
		return err
	}

	id, err := w.operatorID(ctx)
	if err != nil {
		return err
	}

	if got.Subject != id || got.Scope != scope {
		return fmt.Errorf("jeton reçu au nom de %q avec %q, attendu %q avec %q", got.Subject, got.Scope, id, scope)
	}

	return nil
}

func (w *gatewayTokenWorld) receivedNoCookie() error {
	for _, p := range w.verifier.Seen() {
		if p.Cookie != "" {
			return fmt.Errorf("la passerelle a reçu un cookie sur %s", p.Path)
		}
	}

	return nil
}

func (w *gatewayTokenWorld) outputHidesTheToken() error {
	got, err := w.lastOn("/admin/customer-groups")
	if err != nil {
		return err
	}

	return w.process.outputHides(got.Token)
}

func (w *gatewayTokenWorld) openedFeedAsSystem(path, scope string) error {
	deadline := time.Now().Add(statusWait)

	for {
		got, err := w.lastOn(path)
		if err == nil {
			if got.Subject != gateway.SystemSubject || got.Scope != scope {
				return fmt.Errorf("flux ouvert au nom de %q avec %q", got.Subject, got.Scope)
			}

			return nil
		}

		if time.Now().After(deadline) {
			return err
		}

		time.Sleep(50 * time.Millisecond)
	}
}

func (w *gatewayTokenWorld) publishesPublicKeyOnly() error {
	var set struct {
		Keys []map[string]any `json:"keys"`
	}

	if err := json.Unmarshal([]byte(w.process.received.body), &set); err != nil {
		return err
	}

	if len(set.Keys) == 0 || set.Keys[0]["alg"] != "ES256" {
		return fmt.Errorf("aucune clé ES256 publiée : %v", set.Keys)
	}

	if _, private := set.Keys[0]["d"]; private {
		return fmt.Errorf("le JWKS publie la partie privée d'une clé")
	}

	return nil
}
