package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
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
}

func (w *customerGroupsWorld) registerSteps(ctx *godog.ScenarioContext) {
	ctx.Given(`^une passerelle servie par le mock du contrat$`, w.servedByTheMock)
	ctx.Given(`^une passerelle qui refuse la liste des groupes sur le champ "([^"]*)"$`, w.refusingOnField)
	ctx.Given(`^une passerelle qui répond 500 avec le message "([^"]*)"$`, w.failingWithMessage)
	ctx.Given(`^une passerelle qui compte les requêtes reçues$`, func() error {
		return w.answering(http.StatusOK, `[]`)
	})
	ctx.Then(`^la passerelle n'a reçu aucune requête$`, w.receivedNothing)
	ctx.Given(`^une passerelle injoignable$`, w.unreachable)
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
	w.upstream = httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		// Le hub ouvre aussi ses flux temps réel sur cette adresse : seul l'appel relayé compte.
		if r.URL.Path == "/admin/customer-groups" {
			w.received.Add(1)
		}

		rw.Header().Set("Content-Type", "application/json")
		rw.WriteHeader(status)
		_, _ = rw.Write([]byte(body))
	}))
	w.process.env["DASHBOARD_GATEWAY_BASE_URL"] = w.upstream.URL

	return nil
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
