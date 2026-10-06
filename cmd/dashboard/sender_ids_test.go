package main

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/cucumber/godog"
)

func (w *customerGroupsWorld) registerSenderIDSteps(ctx *godog.ScenarioContext) {
	ctx.Given(`^une passerelle dont le sender ID "([^"]*)" est classé "([^"]*)"$`, w.servingASenderClassedAs)
	ctx.Given(`^une passerelle qui répond 409 à la suppression d'un sender ID$`, func() error {
		return w.answering(http.StatusConflict, `{"code":"conflict","message":"sender id already used"}`)
	})
	ctx.Then(`^la passerelle n'a reçu aucune écriture$`, w.receivedNoWrite)
	ctx.Given(`^une passerelle dont le sender ID a déjà servi et compte (\d+) signalements$`, w.servingAUsedSender)
	ctx.Then(`^la réponse porte '([^']*)'$`, w.responseCarries)
	ctx.Given(`^une passerelle qui a refusé un bind "([^"]*)" de "([^"]*)" en "([^"]*)" pour la cause "([^"]*)"$`,
		func(bindType, remoteIP, commandStatus, reason string) error {
			return w.answering(http.StatusOK, fmt.Sprintf(`{"data":[{"at":"2026-10-06T09:41:02Z","remote_ip":%q,`+
				`"bind_type":%q,"command_status":%q,"reason":%q}]}`, remoteIP, bindType, commandStatus, reason))
		})
}

// servingASenderClassedAs sert la liste avant le PATCH, puis le sender ID reclassé : seule la liste
// porte l'ancienne catégorie, que l'audit doit retrouver.
func (w *customerGroupsWorld) servingASenderClassedAs(senderID, category string) error {
	sender := func(category string) string {
		return fmt.Sprintf(`{"id":%q,"customer_id":"0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b","address":"ACME",`+
			`"status":"active","traffic_category":%q,"recent_category_mismatches_24h":0,"rate_limit":null,`+
			`"created_at":"2026-09-30T08:00:00Z","updated_at":"2026-09-30T08:00:00Z"}`, senderID, category)
	}

	return w.replying(func(r *http.Request) (int, string) {
		if r.Method == http.MethodGet {
			return http.StatusOK, "[" + sender(category) + "]"
		}

		return http.StatusOK, sender("otp")
	})
}

func (w *customerGroupsWorld) receivedNoWrite() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	for _, query := range w.queries {
		if !strings.HasPrefix(query, http.MethodGet+" ") {
			return fmt.Errorf("la passerelle a reçu une écriture : %q", query)
		}
	}

	return nil
}

func (w *customerGroupsWorld) servingAUsedSender(mismatches int) error {
	return w.answering(http.StatusOK, fmt.Sprintf(`[{"id":"0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7d",`+
		`"customer_id":"0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b","address":"ACME","status":"active",`+
		`"traffic_category":"otp","recent_category_mismatches_24h":%d,`+
		`"rate_limit":{"max_per_sec":50,"burst_capacity":100},"first_used_at":"2026-10-01T08:00:00Z",`+
		`"created_at":"2026-09-30T08:00:00Z","updated_at":"2026-09-30T08:00:00Z"}]`, mismatches))
}

func (w *customerGroupsWorld) responseCarries(fragment string) error {
	if !strings.Contains(w.process.received.body, fragment) {
		return fmt.Errorf("la réponse ne porte pas %s :\n%s", fragment, w.process.received.body)
	}

	return nil
}
