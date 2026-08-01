package bff_test

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/cucumber/godog"
	"github.com/martialanouman/go-gateway-bo/internal/bff"
)

func TestFeatures(t *testing.T) {
	suite := godog.TestSuite{
		ScenarioInitializer: initializeScenarios,
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"."},
			Strict:   true,
			TestingT: t,
		},
	}

	if suite.Run() != 0 {
		t.Fatal("des scénarios ont échoué")
	}
}

type world struct {
	baseURL  string
	stop     context.CancelFunc
	served   chan error
	response *http.Response
}

func initializeScenarios(sc *godog.ScenarioContext) {
	w := &world{}

	sc.After(func(ctx context.Context, _ *godog.Scenario, _ error) (context.Context, error) {
		if w.stop != nil {
			w.stop()
			<-w.served
		}
		if w.response != nil {
			_ = w.response.Body.Close()
		}
		*w = world{}
		return ctx, nil
	})

	sc.Step(`^un serveur démarré$`, w.startServer)
	sc.Step(`^"([^"]*)" est demandé$`, w.request)
	sc.Step(`^le statut de la réponse est (\d+)$`, w.responseStatusIs)
	sc.Step(`^la réponse n'est pas du HTML$`, w.responseIsNotHTML)
	sc.Step(`^le serveur reçoit l'ordre de s'arrêter$`, w.stopServer)
	sc.Step(`^le serveur rend la main sans erreur$`, w.serverReturnedCleanly)
}

func (w *world) startServer() error {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(context.Background())
	w.stop = cancel
	w.baseURL = "http://" + listener.Addr().String()
	w.served = make(chan error, 1)

	go func() { w.served <- bff.Serve(ctx, listener, bff.NewRouter(), time.Second) }()

	return nil
}

func (w *world) request(path string) error {
	response, err := http.Get(w.baseURL + path) //nolint:noctx // requête de test, sans annulation utile
	if err != nil {
		return err
	}
	w.response = response
	return nil
}

func (w *world) responseStatusIs(expected int) error {
	if w.response.StatusCode != expected {
		return fmt.Errorf("statut %d au lieu de %d", w.response.StatusCode, expected)
	}
	return nil
}

// Anticipe le repli SPA de step-002 : le jour où il existe, une route /api
// inconnue ne doit pas se mettre à rendre l'index.
func (w *world) responseIsNotHTML() error {
	if contentType := w.response.Header.Get("Content-Type"); strings.Contains(contentType, "text/html") {
		return fmt.Errorf("la réponse est du HTML (%s)", contentType)
	}
	return nil
}

func (w *world) stopServer() error {
	w.stop()
	w.stop = nil
	return nil
}

func (w *world) serverReturnedCleanly() error {
	select {
	case err := <-w.served:
		w.served = make(chan error, 1)
		close(w.served)
		return err
	case <-time.After(5 * time.Second):
		return fmt.Errorf("le serveur n'a pas rendu la main")
	}
}
