package bff_test

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/cucumber/godog"
	"github.com/martialanouman/go-gateway-bo/internal/bff"
)

func TestFeatures(t *testing.T) {
	// godog rend `exitSuccess` quand il ne trouve aucun `.feature` : sans ce
	// compteur, supprimer le fichier laisserait le lanceur vert. `Strict` ne
	// couvre que les steps non définies, pas une feature absente.
	var executed atomic.Int64

	suite := godog.TestSuite{
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			executed.Add(1)
			initializeScenarios(sc)
		},
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
	if executed.Load() == 0 {
		t.Fatal("aucun scénario n'a été exécuté : le fichier .feature est-il présent ?")
	}
}

type world struct {
	baseURL      string
	stop         context.CancelFunc
	served       chan error
	statusCode   int
	contentType  string
	cacheControl string
	body         string
}

func initializeScenarios(sc *godog.ScenarioContext) {
	w := &world{}

	sc.After(func(ctx context.Context, _ *godog.Scenario, _ error) (context.Context, error) {
		if w.stop != nil {
			w.stop()
			<-w.served
		}
		return ctx, nil
	})

	sc.Step(`^un serveur démarré$`, w.startServer)
	sc.Step(`^un serveur démarré avec des assets embarqués$`, w.startServer)
	sc.Step(`^"([^"]*)" est demandé$`, w.request)
	sc.Step(`^le statut de la réponse est (\d+)$`, w.responseStatusIs)
	sc.Step(`^le corps de la réponse est le JSON (.+)$`, w.responseBodyIs)
	sc.Step(`^le type de la réponse est "([^"]*)"$`, w.responseTypeIs)
	sc.Step(`^la réponse n'est pas du HTML$`, w.responseIsNotHTML)
	sc.Step(`^le serveur reçoit l'ordre de s'arrêter$`, w.stopServer)
	sc.Step(`^le serveur rend la main sans erreur$`, w.serverReturnedCleanly)
	sc.Step(`^le corps de la réponse est celui de l'index$`, w.responseBodyIsTheIndex)
	sc.Step(`^la réponse porte un cache immuable$`, w.responseCacheIsImmutable)
	sc.Step(`^la réponse interdit la mise en cache$`, w.responseForbidsCaching)
}

func (w *world) startServer(scenarioCtx context.Context) error {
	listener, err := new(net.ListenConfig).Listen(scenarioCtx, "tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(context.WithoutCancel(scenarioCtx))
	w.stop = cancel
	w.baseURL = "http://" + listener.Addr().String()
	w.served = make(chan error, 1)

	go func() { w.served <- bff.Serve(ctx, listener, bff.NewRouter(assetsDeTest()), time.Second) }()

	return nil
}

func (w *world) request(ctx context.Context, path string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, w.baseURL+path, nil)
	if err != nil {
		return err
	}

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		return err
	}

	w.statusCode = response.StatusCode
	w.contentType = response.Header.Get("Content-Type")
	w.cacheControl = response.Header.Get("Cache-Control")
	w.body = strings.TrimSpace(string(body))

	return nil
}

func (w *world) responseStatusIs(expected int) error {
	if w.statusCode != expected {
		return fmt.Errorf("statut %d au lieu de %d", w.statusCode, expected)
	}
	return nil
}

func (w *world) responseBodyIs(expected string) error {
	if w.body != strings.TrimSpace(expected) {
		return fmt.Errorf("corps %q au lieu de %q", w.body, expected)
	}
	return nil
}

// Une arborescence en mémoire plutôt que la sortie de Vite : les tests Go ne
// doivent pas dépendre d'un build client, sinon `go test ./...` échoue sur un
// clone neuf — le faux vert que step-001 a payé une fois.
func assetsDeTest() fs.FS {
	return fstest.MapFS{
		"index.html":              {Data: []byte(indexDeTest)},
		"assets/index-abc123.js":  {Data: []byte("console.log('bundle')")},
		"assets/index-abc123.css": {Data: []byte("body{}")},
	}
}

const indexDeTest = `<!doctype html><html lang="fr"><body><div id="squelette"></div></body></html>`

func (w *world) responseBodyIsTheIndex() error {
	if w.body != indexDeTest {
		return fmt.Errorf("le corps n'est pas l'index : %q", w.body)
	}
	return nil
}

func (w *world) responseCacheIsImmutable() error {
	if !strings.Contains(w.cacheControl, "immutable") {
		return fmt.Errorf("Cache-Control %q n'est pas immuable", w.cacheControl)
	}
	return nil
}

func (w *world) responseForbidsCaching() error {
	if !strings.Contains(w.cacheControl, "no-cache") {
		return fmt.Errorf("Cache-Control %q autorise la mise en cache", w.cacheControl)
	}
	return nil
}

func (w *world) responseTypeIs(expected string) error {
	if !strings.Contains(w.contentType, expected) {
		return fmt.Errorf("type %q, attendu %q", w.contentType, expected)
	}
	return nil
}

// Anticipe le repli SPA de step-002. Il ne discrimine rien aujourd'hui — chi
// rend déjà 404 text/plain — mais il n'est portant que si le repli est monté
// **dans NewRouter** ; monté autour du routeur, c'est le parcours Playwright
// contre le binaire qui le couvrira. La contrainte est notée dans step-002.
func (w *world) responseIsNotHTML() error {
	if strings.Contains(w.contentType, "text/html") {
		return fmt.Errorf("la réponse est du HTML (%s)", w.contentType)
	}
	return nil
}

func (w *world) stopServer() error {
	w.stop()
	// Nettoyé ici et non dans la branche réussie de `serverReturnedCleanly` :
	// sinon un serveur qui ne rend pas la main fait attendre le hook `After` sur
	// un canal que personne ne remplira, et l'échec se manifeste par le timeout
	// de 10 minutes de `go test` au lieu du message du scénario.
	w.stop = nil
	return nil
}

func (w *world) serverReturnedCleanly() error {
	select {
	case err := <-w.served:
		return err
	case <-time.After(5 * time.Second):
		return fmt.Errorf("le serveur n'a pas rendu la main")
	}
}
