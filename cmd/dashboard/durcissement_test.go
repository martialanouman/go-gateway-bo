package main

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/cucumber/godog"
)

// hardeningHeaders est ce que toute réponse porte, quelle que soit la surface. Les trois valeurs sont
// écrites ici plutôt qu'importées du serveur : un décor qui lirait la constante du produit validerait
// n'importe quelle valeur, y compris celle qu'une régression vient d'y écrire.
var hardeningHeaders = map[string]string{
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options":        "DENY",
	"Referrer-Policy":        "same-origin",
}

// bodyHangCeiling borne l'attente du client dans le scénario du corps qui n'arrive pas. Elle est
// délibérément **très** au-dessus de l'échéance du serveur, et ne la nomme pas : ce que le scénario
// garde est qu'il en existe une, pas sa valeur. Sans échéance côté serveur, la lecture ci-dessous
// atteint cette borne et le scénario rougit ; avec elle, la réponse arrive bien avant.
const bodyHangCeiling = 20 * time.Second

type hardeningWorld struct {
	process *process
	conn    net.Conn
	started time.Time
}

func (w *hardeningWorld) registerSteps(ctx *godog.ScenarioContext) {
	ctx.When(`^le navigateur envoie la connexion depuis l'origine "([^"]*)"$`, w.signInFrom)
	ctx.When(`^le navigateur envoie la connexion sans annoncer d'origine$`, w.signInWithoutOrigin)
	ctx.When(`^le navigateur envoie la connexion depuis la bonne origine en "([^"]*)"$`, w.signInAs)
	ctx.When(`^le navigateur annonce un corps de connexion qu'il n'envoie pas$`, w.announceABodyNeverSent)
	ctx.Then(`^la réponse porte les en-têtes de durcissement$`, w.responseCarriesHardeningHeaders)
	ctx.Then(`^le serveur rend la main avant la fin du corps annoncé$`, w.serverGivesUp)
}

// Le corps est valide et l'opérateur n'existe pas : ce qui refuse doit être l'origine ou le type de
// contenu, jamais la forme du corps. Un corps illisible rendrait 400 et le scénario ne saurait pas
// lequel des deux contrôles l'a produit.
const wellFormedLogin = `{"email":"personne@exemple.test","password":"un-mot-de-passe"}`

func (w *hardeningWorld) signInFrom(origin string) error {
	return w.process.sendFrom(http.MethodPost, "/api/auth/login", origin, "application/json", wellFormedLogin)
}

func (w *hardeningWorld) signInWithoutOrigin() error {
	return w.process.sendFrom(http.MethodPost, "/api/auth/login", "", "application/json", wellFormedLogin)
}

func (w *hardeningWorld) signInAs(contentType string) error {
	return w.process.sendFrom(http.MethodPost, "/api/auth/login", configuredOrigin, contentType, wellFormedLogin)
}

func (w *hardeningWorld) responseCarriesHardeningHeaders() error {
	if w.process.received == nil {
		return errors.New("aucune réponse à examiner : rien n'a été demandé au serveur")
	}

	for name, expected := range hardeningHeaders {
		if served := w.process.received.header.Get(name); served != expected {
			return fmt.Errorf("%s sur %s : %q attendu, reçu %q",
				name, w.process.received.path, expected, served)
		}
	}

	return nil
}

// announceABodyNeverSent ouvre une connexion à la main : `net/http` côté client n'a aucun moyen
// d'annoncer un corps puis de ne pas l'envoyer — c'est précisément ce qu'un attaquant fait.
func (w *hardeningWorld) announceABodyNeverSent() error {
	conn, err := net.DialTimeout("tcp", w.process.addr, 5*time.Second)
	if err != nil {
		return fmt.Errorf("connexion à %s: %w", w.process.addr, err)
	}

	w.conn = conn
	w.started = time.Now()

	// Un octet de corps sur les soixante-quatre annoncés, et pas un de plus. Les en-têtes sont
	// complets : ce qui traîne est le corps, donc `ReadHeaderTimeout` ne s'applique pas.
	request := "POST /api/auth/login HTTP/1.1\r\n" +
		"Host: " + w.process.addr + "\r\n" +
		"Origin: " + configuredOrigin + "\r\n" +
		"Content-Type: application/json\r\n" +
		"Content-Length: 64\r\n" +
		"\r\n" +
		"{"

	if _, err = conn.Write([]byte(request)); err != nil {
		return fmt.Errorf("envoi de la requête tronquée: %w", err)
	}

	return nil
}

func (w *hardeningWorld) serverGivesUp() error {
	defer func() { _ = w.conn.Close() }()

	if err := w.conn.SetReadDeadline(time.Now().Add(bodyHangCeiling)); err != nil {
		return fmt.Errorf("pose de la borne de lecture: %w", err)
	}

	answer, err := io.ReadAll(w.conn)
	if err != nil {
		return fmt.Errorf("le serveur n'a rien rendu en %s : il attend toujours le corps annoncé (%w)",
			time.Since(w.started).Round(time.Millisecond), err)
	}

	if len(answer) == 0 {
		return fmt.Errorf("le serveur a fermé sans rien dire après %s",
			time.Since(w.started).Round(time.Millisecond))
	}

	if !strings.HasPrefix(string(answer), "HTTP/1.1 ") {
		return fmt.Errorf("réponse illisible après %s :\n%s",
			time.Since(w.started).Round(time.Millisecond), answer)
	}

	return nil
}

// outputHides garde la contraposée de `messageNames` : un refus qui nomme la variable **sans** citer
// ce qu'elle portait.
func (p *process) outputHides(secret string) error {
	if output := p.output.String(); strings.Contains(output, secret) {
		return fmt.Errorf("la sortie porte %q :\n%s", secret, output)
	}

	return nil
}
