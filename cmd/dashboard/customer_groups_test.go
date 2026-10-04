package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/cucumber/godog"
)

// suiteGatewayURL est le mock Prism de la suite, lancé par `TestScenarios` : il n'existe qu'une fois,
// et seuls les scénarios qui le demandent y pointent le binaire.
var suiteGatewayURL string

type customerGroupsWorld struct {
	process  *process
	upstream *httptest.Server
	received atomic.Int32
	mu       sync.Mutex
	queries  []string
}

func (w *customerGroupsWorld) registerSteps(ctx *godog.ScenarioContext) {
	ctx.Given(`^une passerelle servie par le mock du contrat$`, w.servedByTheMock)
	ctx.Given(`^une passerelle qui refuse la liste des groupes sur le champ "([^"]*)"$`, w.refusingOnField)
	ctx.Given(`^une passerelle qui répond 500 avec le message "([^"]*)"$`, w.failingWithMessage)
	ctx.Given(`^une passerelle qui compte les requêtes reçues$`, func() error {
		return w.answering(http.StatusOK, `[]`)
	})
	ctx.When(`^le navigateur envoie (POST|PUT|PATCH|DELETE) "([^"]*)"(?: avec le corps '([^']*)')?$`, w.send)
	ctx.Then(`^la passerelle n'a reçu aucune requête$`, w.receivedNothing)
	ctx.Then(`^la passerelle a reçu "([^"]*)"$`, w.receivedQuery)
	ctx.Then(`^la passerelle a reçu '([^']*)'$`, w.receivedQuery)
	ctx.Then(`^la passerelle a reçu le secret que la réponse rend$`, w.receivedTheReturnedSecret)
	ctx.Given(`^une passerelle qui refuse les canaux sur le champ "([^"]*)"$`, w.refusingOnField)
	ctx.Given(`^une passerelle qui crée un webhook$`, w.creatingAWebhook)
	// Le détachement ne s'écrit qu'en `null` : la passerelle exige le champ présent.
	ctx.Then(`^la passerelle a reçu un détachement de groupe$`, func() error {
		return w.receivedQuery(`"group_id":null`)
	})
	ctx.Given(`^une passerelle dont le client a (\d+) comptes, dont (\d+) actifs et (\d+) fermé$`, w.servingAccounts)
	ctx.Given(`^une passerelle qui répond 409 (?:à l'enregistrement d'un sender ID|à la création|à la création d'un webhook)$`, func() error {
		return w.answering(http.StatusConflict, `{"code":"conflict","message":"sender id already exists"}`)
	})
	ctx.Then(`^la réponse compte (\d+) comptes, dont (\d+) actifs et (\d+) fermé$`, w.countsAccounts)
	ctx.Given(`^une passerelle injoignable$`, w.unreachable)
	ctx.Then(`^la réponse ne porte pas "([^"]*)"$`, w.responseOmits)
	ctx.Then(`^la réponse liste au moins un groupe$`, w.listsAtLeastOneGroup)
	ctx.Then(`^le refus place une erreur sous le champ "([^"]*)"$`, w.refusalPlacesAnErrorUnder)
	ctx.Then(`^la sortie du serveur porte "([^"]*)"$`, w.process.messageNames)
	ctx.After(func(ctx context.Context, _ *godog.Scenario, err error) (context.Context, error) {
		if w.upstream != nil {
			w.upstream.Close()
		}

		return ctx, err
	})
}

func (w *customerGroupsWorld) servedByTheMock() error {
	w.process.env["DASHBOARD_GATEWAY_BASE_URL"] = suiteGatewayURL

	return nil
}

func (w *customerGroupsWorld) refusingOnField(field string) error {
	return w.answering(http.StatusUnprocessableEntity, fmt.Sprintf(
		`{"code":"validation_error","message":"invalid request","errors":[{"field":%q,"message":"rejected"}]}`,
		field))
}

// failingWithMessage rend l'enveloppe du contrat : son `message` est du texte amont, que ni la
// réponse ni le journal ne doivent porter.
func (w *customerGroupsWorld) failingWithMessage(message string) error {
	return w.answering(http.StatusInternalServerError, fmt.Sprintf(`{"code":"internal_error","message":%q}`,
		message))
}

func (w *customerGroupsWorld) answering(status int, body string) error {
	return w.answeringBy(func(*http.Request) int { return status }, body)
}

func (w *customerGroupsWorld) answeringBy(statusFor func(*http.Request) int, body string) error {
	w.upstream = httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		// Le hub ouvre aussi ses flux temps réel sur cette adresse : seul l'appel relayé compte.
		if strings.HasPrefix(r.URL.Path, "/admin/customer-groups") || strings.HasPrefix(r.URL.Path, "/admin/customers") ||
			strings.HasPrefix(r.URL.Path, "/admin/smpp-accounts") {
			w.received.Add(1)
			sent, _ := io.ReadAll(r.Body)
			w.mu.Lock()
			w.queries = append(w.queries, r.URL.RawQuery+" "+string(sent))
			w.mu.Unlock()
		}

		rw.Header().Set("Content-Type", "application/json")
		rw.WriteHeader(statusFor(r))
		_, _ = rw.Write([]byte(body))
	}))
	w.process.env["DASHBOARD_GATEWAY_BASE_URL"] = w.upstream.URL

	return nil
}

func (w *customerGroupsWorld) send(method, path, body string) error {
	contentType := ""
	if body != "" {
		contentType = "application/json"
	}

	return w.process.send(method, path, contentType, body)
}

func (w *customerGroupsWorld) listsAtLeastOneGroup() error {
	var groups []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}

	if err := json.Unmarshal([]byte(w.process.received.body), &groups); err != nil {
		return fmt.Errorf("la réponse n'est pas une liste de groupes : %w\n%s", err, w.process.received.body)
	}

	if len(groups) == 0 || groups[0].ID == "" || groups[0].Name == "" {
		return fmt.Errorf("la réponse ne liste aucun groupe nommé :\n%s", w.process.received.body)
	}

	return nil
}

func (w *customerGroupsWorld) refusalPlacesAnErrorUnder(field string) error {
	var refusal struct {
		Errors []struct {
			Field string `json:"field"`
		} `json:"errors"`
	}

	if err := json.Unmarshal([]byte(w.process.received.body), &refusal); err != nil {
		return fmt.Errorf("le refus n'est pas du JSON : %w", err)
	}

	for _, placed := range refusal.Errors {
		if placed.Field == field {
			return nil
		}
	}

	return fmt.Errorf("le refus ne place rien sous %q :\n%s", field, w.process.received.body)
}

func (w *customerGroupsWorld) receivedQuery(fragment string) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	for _, query := range w.queries {
		if strings.Contains(query, fragment) {
			return nil
		}
	}

	return fmt.Errorf("aucune requête reçue ne porte %q : %q", fragment, w.queries)
}

func (w *customerGroupsWorld) receivedNothing() error {
	if received := w.received.Load(); received != 0 {
		return fmt.Errorf("la passerelle a reçu %d requête(s) de liste des groupes", received)
	}

	return nil
}

// unreachable désigne un port qui vient d'être libéré : la connexion y est refusée.
func (w *customerGroupsWorld) unreachable() error {
	closed := httptest.NewServer(http.NotFoundHandler())
	closed.Close()
	w.process.env["DASHBOARD_GATEWAY_BASE_URL"] = closed.URL

	return nil
}

func (w *customerGroupsWorld) responseOmits(fragment string) error {
	if strings.Contains(w.process.received.body, fragment) {
		return fmt.Errorf("la réponse porte %q :\n%s", fragment, w.process.received.body)
	}

	return nil
}

func (w *customerGroupsWorld) servingAccounts(total, active, closed int) error {
	accounts := make([]string, 0, total)
	for index := range total {
		status := "suspended"
		if index < active {
			status = "active"
		} else if index < active+closed {
			status = "closed"
		}

		accounts = append(accounts, fmt.Sprintf(`{"id":"0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a%02d",`+
			`"customer_id":"0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b","name":"compte %d","status":%q,`+
			`"smpp_enabled":true,"rest_enabled":false,"sender_id_policy":"strict","allowed_bind_types":"trx",`+
			`"max_sessions":1,"created_at":"2026-09-30T00:00:00Z","updated_at":"2026-09-30T00:00:00Z"}`,
			index, index, status))
	}

	return w.answering(http.StatusOK, "["+strings.Join(accounts, ",")+"]")
}

func (w *customerGroupsWorld) countsAccounts(total, active, closed int) error {
	var impact struct {
		Accounts       int `json:"accounts"`
		ActiveAccounts int `json:"activeAccounts"`
		ClosedAccounts int `json:"closedAccounts"`
	}

	if err := json.Unmarshal([]byte(w.process.received.body), &impact); err != nil {
		return fmt.Errorf("la réponse n'est pas un impact : %w\n%s", err, w.process.received.body)
	}

	if impact.Accounts != total || impact.ActiveAccounts != active || impact.ClosedAccounts != closed {
		return fmt.Errorf("la réponse compte %d comptes dont %d actifs et %d fermés, attendu %d, %d et %d",
			impact.Accounts, impact.ActiveAccounts, impact.ClosedAccounts, total, active, closed)
	}

	return nil
}

// creatingAWebhook rend le même webhook à la création (201) et à la rotation (200), que le client
// engendré ne lit que sous leur statut propre.
func (w *customerGroupsWorld) creatingAWebhook() error {
	return w.answeringBy(func(r *http.Request) int {
		if r.Method == http.MethodPost {
			return http.StatusCreated
		}

		return http.StatusOK
	}, `{"id":"0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7f","account_id":"0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e",`+
		`"event_type":"dlr","url":"https://client.example/dlr","status":"active"}`)
}

func (w *customerGroupsWorld) receivedTheReturnedSecret() error {
	secret, err := returnedSecret(w.process.received.body)
	if err != nil {
		return err
	}

	return w.receivedQuery(fmt.Sprintf(`"secret":%q`, secret))
}

func returnedSecret(body string) (string, error) {
	var returned struct {
		Secret string `json:"secret"`
	}

	if err := json.Unmarshal([]byte(body), &returned); err != nil || returned.Secret == "" {
		return "", fmt.Errorf("la réponse ne rend aucun secret :\n%s", body)
	}

	return returned.Secret, nil
}
