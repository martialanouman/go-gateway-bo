package gateway_test

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cucumber/godog"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/martialanouman/go-gateway-bo/internal/gateway"
)

// Les scénarios de ce package exercent le client sortant contre le **mock Prism**, monté sur le
// contrat publié : c'est la frontière du système sous test. Le harnais lance Prism lui-même depuis
// `web/node_modules/.bin/prism` — le binaire installé, prêt en ~1,0 s (mesuré le 02/08/2026) — et
// jamais par `npx`, qui repaie une résolution de paquet à chaque lancement.
//
// Rien ici ne se saute : ni `t.Skip()`, ni tag exclu, ni build tag. Un binaire ou un contrat absent
// fait rouge et nomme la sortie de secours. C'est ce qui range ce package du côté à deux toolchains —
// le contrat ne vit que sous `web/node_modules/`, et le job « Tests Go » de la CI reçoit donc l'action
// de setup du versant client.
const (
	prismBinary   = "web/node_modules/.bin/prism"
	adminContract = "web/node_modules/@martialanouman/gateway-api-contracts/openapi-admin.yaml"
)

// envMockBaseURL signale un mock déjà lancé — c'est ce que `make mock` affiche. Le harnais s'y
// raccorde au lieu d'en démarrer un second : une boucle locale ne repaie alors pas le démarrage à
// chaque lancement de la suite.
const envMockBaseURL = "PRISM_MOCK_BASE_URL"

// prismStartup est large parce qu'elle vise un démarrage parti en vrille, pas une machine lente :
// mesuré à ~1,0 s ici, et le runner de CI paie en plus le premier chargement de Node.
const prismStartup = 30 * time.Second

// `godog` ne pose aucun plancher : `Paths` qui ne trouve rien rend une suite **vide et réussie**, et
// `Strict` ne couvre que les steps non définies d'un scénario lu. Vérifié le 02/08/2026 en renommant
// `passerelle.feature` — la suite rend `ok` sans avoir joint le mock une seule fois. Le registre
// ferme les deux trous : un plancher sur ce qui a tourné, et l'exigence que chaque `.feature` du
// répertoire ait porté au moins un scénario.
func TestScenarios(t *testing.T) {
	baseURL := adminMock(t)
	ran := &scenarioLedger{}

	suite := godog.TestSuite{
		Name: "gateway",
		ScenarioInitializer: func(ctx *godog.ScenarioContext) {
			ran.watch(ctx)
			initializeScenario(ctx, baseURL)
		},
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"."},
			TestingT: t,
			// Une step non définie est un échec : sans ça, un scénario dont personne n'a écrit
			// l'implémentation passe pour vert.
			Strict: true,
		},
	}

	if suite.Run() != 0 {
		t.Fatal("des scénarios ont échoué")
	}

	ran.requireCorpusExercised(t)
}

// La ligne de DoD « le mock sert les 133 opérations » est établie ici, et par les deux affirmations
// que voici plutôt que par un comptage dans le YAML — qui dirait ce que le contrat déclare, jamais ce
// qu'un mock répond.
//
//  1. **Ce que Prism annonce égale ce que le contrat déclare.** Prism imprime une ligne par opération
//     au démarrage ; le contrat, lui, est compté sur ses lignes `operationId:`. Deux sources, une
//     égalité.
//  2. **Chaque route annoncée répond autre chose qu'un refus de routage.** La sonde les interroge
//     toutes. Ce qu'elle établit est le routage, pas la validité de chaque réponse : une opération à
//     corps obligatoire rend un 422 de validation, qui prouve qu'elle est servie et rien de plus. Ce
//     que les scénarios ajoutent, eux, est qu'une route annoncée rend bien l'exemple typé du contrat.
func TestTheMockServesEveryOperationTheContractDeclares(t *testing.T) {
	// Une instance à soi : les routes annoncées se lisent au démarrage, qu'un mock signalé par
	// `make mock` n'a pas laissé voir. Ce test-ci ne réutilise donc jamais.
	mock := startPrism(t)
	declared := declaredOperations(t)

	t.Logf("%d opérations déclarées au contrat, %d routes annoncées par le mock", declared, len(mock.routes))

	require.Lenf(t, mock.routes, declared,
		"le mock annonce %d routes pour %d opérations déclarées au contrat : `make mock` ne sert pas ce "+
			"que le contrat décrit, et les scénarios n'exercent qu'une partie de la passerelle",
		len(mock.routes), declared)

	unserved := unservedRoutes(t, mock.routes)

	// Les premières suffisent à orienter : une sonde qui se trompe de cible les fait toutes tomber, et
	// cent trente lignes dans un rapport de CI cachent le reste de la suite.
	assert.Emptyf(t, firstFew(unserved),
		"%d opération(s) annoncée(s) sur %d ne sont pas routées : le mock est en désaccord avec lui-même",
		len(unserved), len(mock.routes))
}

// declaredOperations compte ce que le contrat déclare, sur la ligne qui le déclare : une clé
// `operationId:`, jamais une mention en prose ou en commentaire — même discriminant que
// `contrat_test.go`. Le plancher refuse un compte nul : un fichier déplacé ou une clé renommée en
// amont rendrait 0, et l'égalité avec un mock qui n'annonce rien passerait pour verte.
func declaredOperations(t *testing.T) int {
	t.Helper()

	contract, err := os.ReadFile(filepath.Join(repositoryRoot(t), adminContract))
	require.NoError(t, err, "lecture du contrat de l'API Admin")

	declared := 0

	for line := range strings.SplitSeq(string(contract), "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "operationId:") {
			declared++
		}
	}

	require.Positive(t, declared, "le contrat ne déclare aucune opération : il a bougé, ou la clé "+
		"`operationId` a changé de nom en amont")

	return declared
}

// probeToken n'ouvre rien : Prism applique le `security` du contrat **avant** de router — sans en-tête
// `Authorization`, tout répond 401 et la sonde ne distinguerait plus une route servie d'une route
// absente. Mesuré le 02/08/2026 : n'importe quel `Bearer` suffit au mock.
//
//nolint:gosec // G101 : voir juste au-dessus.
const probeToken = "Bearer jeton-de-sonde"

func firstFew(routes []string) []string {
	const reported = 5

	if len(routes) <= reported {
		return routes
	}

	return routes[:reported]
}

// unservedRoutes interroge chaque route annoncée et rend celles que le mock ne route pas, nommées.
func unservedRoutes(t *testing.T, routes []announcedRoute) []string {
	t.Helper()

	probe := &http.Client{Timeout: callTimeout}

	var unserved []string

	for _, route := range routes {
		if reason := probeRoute(t, probe, route); reason != "" {
			unserved = append(unserved, route.String()+" — "+reason)
		}
	}

	return unserved
}

// probeRoute rend vide quand la route est servie, et le motif du refus sinon. Une route servie répond
// n'importe quoi d'autre : 200 sur une lecture, 422 quand Prism refuse un corps absent, 101 sur un
// flux. Les deux refus de **routage**, eux, se nomment dans le corps — mesuré le 02/08/2026 :
// `NO_PATH_MATCHED_ERROR` en 404 sur un chemin inconnu, `NO_METHOD_MATCHED_ERROR` en 405 sur une
// méthode que le chemin ne déclare pas.
func probeRoute(t *testing.T, probe *http.Client, route announcedRoute) string {
	t.Helper()

	request, err := http.NewRequestWithContext(t.Context(), route.method, route.url, nil)
	require.NoErrorf(t, err, "sonde de %s", route)

	request.Header.Set("Authorization", probeToken)

	response, err := probe.Do(request)
	if err != nil {
		return err.Error()
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusNotFound && response.StatusCode != http.StatusMethodNotAllowed {
		return ""
	}

	// Le corps est lu borné : ce qui est cherché tient dans l'en-tête du document d'erreur, et un flux
	// qui ne se termine pas n'a pas à faire pendre la sonde.
	refusal, err := io.ReadAll(io.LimitReader(response.Body, 1024))
	require.NoErrorf(t, err, "lecture du refus de %s", route)

	for _, routingError := range []string{"NO_PATH_MATCHED_ERROR", "NO_METHOD_MATCHED_ERROR"} {
		if strings.Contains(string(refusal), routingError) {
			return routingError
		}
	}

	return ""
}

// minimumScenarios est un plancher, pas un compte : en ajouter un n'oblige à rien ici, en retirer un
// demande de le dire.
const minimumScenarios = 2

// scenarioLedger note ce que la suite a réellement exécuté. Le verrou n'est pas décoratif : godog
// exécute les scénarios en parallèle dès que `Concurrency` dépasse 1, et ce jour-là le compteur se
// tairait sous `-race` plutôt que de compter faux.
type scenarioLedger struct {
	mu     sync.Mutex
	byFile map[string]int
	total  int
}

func (l *scenarioLedger) watch(ctx *godog.ScenarioContext) {
	ctx.Before(func(ctx context.Context, sc *godog.Scenario) (context.Context, error) {
		l.mu.Lock()
		defer l.mu.Unlock()

		if l.byFile == nil {
			l.byFile = make(map[string]int)
		}
		l.byFile[sc.Uri]++
		l.total++

		return ctx, nil
	})
}

func (l *scenarioLedger) requireCorpusExercised(t *testing.T) {
	t.Helper()

	// `TestingT: t` fait de chaque pickle un sous-test, et `t.Run` rend `true` sans exécuter sa closure
	// — donc sans le hook `Before` — quand le nom ne correspond pas au filtre. Déboguer un scénario
	// seul est un flux de travail normal : le dire, plutôt que d'accuser le corpus d'avoir fondu.
	if filter := runFilter(); strings.Contains(filter, "/") {
		t.Logf("plancher et couverture du corpus non vérifiés : `-run %s` ne demande qu'une partie des "+
			"scénarios", filter)

		return
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	assert.GreaterOrEqualf(t, l.total, minimumScenarios,
		"%d scénario(s) exécuté(s) pour un plancher de %d : le corpus a fondu, ou la suite ne le trouve "+
			"plus — dans les deux cas elle ne prouve plus rien du client sortant", l.total, minimumScenarios)

	for _, feature := range featureFiles(t, ".") {
		assert.Positivef(t, l.byFile[feature],
			"%s n'a exécuté aucun scénario : il est présent mais la suite l'ignore", feature)
	}
}

// runFilter rend le motif que `-run` a posé, vide quand la suite tourne en entier. `test.run` est
// enregistré par `testing.Init`, que `m.Run` appelle : il existe donc quand un test s'exécute.
func runFilter() string {
	filter := flag.Lookup("test.run")
	if filter == nil {
		return ""
	}

	return filter.Value.String()
}

// featureFiles nomme les scénarios que la suite doit exercer, dans la forme où godog les nomme :
// relatifs à `root`, séparés par des `/`. La recherche descend dans les sous-répertoires parce que
// `Paths: ["."]` y descend aussi — un glob `*.feature` ne verrait que le répertoire courant, et un
// `.feature` rangé plus bas tournerait sans que personne n'exige qu'il tourne.
func featureFiles(t *testing.T, root string) []string {
	t.Helper()

	var features []string

	err := fs.WalkDir(os.DirFS(root), ".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if !entry.IsDir() && strings.HasSuffix(path, ".feature") {
			features = append(features, path)
		}

		return nil
	})
	require.NoErrorf(t, err, "lecture des fichiers de scénarios sous %s", root)

	return features
}

func initializeScenario(ctx *godog.ScenarioContext, baseURL string) {
	calls := &adminCalls{}

	ctx.Given(`^le mock de l'API Admin monté sur le contrat publié$`, func() error {
		return calls.connect(baseURL)
	})
	ctx.When(`^le BFF demande la liste des clients$`, calls.listCustomers)
	ctx.When(`^la passerelle refuse la liste des clients en (\d+)$`, calls.refusedListing)
	ctx.Then(`^il obtient une page de clients à afficher$`, calls.gotAPageOfCustomers)
	ctx.Then(`^le BFF rend une erreur qui porte le motif "([^"]*)"$`, calls.gotErrorWithCode)
}

// callTimeout borne un appel au mock. Toute attente du harnais est bornée : sans limite, un mock qui
// ne répond pas devient un scénario qui ne finit pas, et le hook qui tue Prism n'est alors jamais
// atteint.
const callTimeout = 10 * time.Second

// adminCalls porte l'état d'un scénario — le client gréé, et ce que le dernier appel a rapporté. Une
// struct par scénario plutôt qu'un `context.Context` : godog en construit une neuve à chaque scénario,
// donc rien ne fuit de l'un à l'autre.
type adminCalls struct {
	client      *gateway.ClientWithResponses
	page        *gateway.CustomerPage
	err         error
	refusedWith int
}

func (c *adminCalls) connect(baseURL string) error {
	// Le mode `mock` est celui du développement local : pas de mTLS, pas d'endpoint de jeton, un
	// `Bearer` factice. Prism applique le `security` global du contrat — mesuré le 02/08/2026, il
	// refuse en 401 une requête sans en-tête `Authorization` et accepte n'importe quel `Bearer` — donc
	// ces scénarios traversent bien l'authentification sortante, sans rien exiger d'une passerelle.
	client, err := gateway.NewAdminClient(config.GatewayConfig{
		Mode:    config.GatewayModeMock,
		BaseURL: baseURL,
		Timeout: callTimeout,
	})
	if err != nil {
		return fmt.Errorf("client de l'API Admin sur le mock: %w", err)
	}

	c.client = client

	return nil
}

func (c *adminCalls) listCustomers(ctx context.Context) error {
	_, err := c.list(ctx)

	return err
}

// refusedListing demande au mock la réponse d'erreur que le contrat déclare pour cette opération, et
// refuse de continuer s'il ne l'a pas rendue : un scénario qui observerait un 200 en croyant observer
// un refus déclarerait vert un chemin d'erreur que personne n'a emprunté.
func (c *adminCalls) refusedListing(ctx context.Context, status int) error {
	c.refusedWith = status

	observed, err := c.list(ctx, preferStatus(status))
	if err != nil {
		return err
	}

	if observed != status {
		return fmt.Errorf("le mock a répondu %d là où `Prefer: code=%d` demandait un refus : le scénario "+
			"n'observe aucune erreur", observed, status)
	}

	return nil
}

func (c *adminCalls) list(ctx context.Context, editors ...gateway.RequestEditorFn) (int, error) {
	response, err := c.client.ListCustomersWithResponse(ctx, nil, editors...)
	if err != nil {
		return 0, fmt.Errorf("appel de list-customers sur le mock: %w", err)
	}

	c.page = response.JSON200
	c.err = gateway.ErrorFrom(response.StatusCode(), response.Body)

	return response.StatusCode(), nil
}

// preferStatus demande à Prism la réponse d'un statut précis. Mesuré le 02/08/2026 sur
// `/admin/customers` : `Prefer: code=422` rend le corps `forbidden_scope` que le contrat déclare, avec
// le statut 422. Sans ce levier, un scénario d'erreur devrait remplacer le serveur par un double,
// c'est-à-dire ne plus rien exercer du contrat.
func preferStatus(status int) gateway.RequestEditorFn {
	return func(_ context.Context, request *http.Request) error {
		request.Header.Set("Prefer", "code="+strconv.Itoa(status))

		return nil
	}
}

func (c *adminCalls) gotAPageOfCustomers() error {
	if c.err != nil {
		return fmt.Errorf("la passerelle n'a pas rendu de page: %w", c.err)
	}

	if c.page == nil {
		return errors.New("la réponse n'a pas été décodée dans le type du contrat : l'écran n'aurait " +
			"rien à afficher")
	}

	if len(c.page.Data) == 0 {
		return errors.New("la page ne porte aucun client : le décodage a réussi sur une enveloppe vide")
	}

	// Le premier client est examiné parce qu'une enveloppe décodée sur des champs vides passerait les
	// deux contrôles précédents : ce qui est observé est qu'un écran aurait de quoi remplir une ligne.
	if first := c.page.Data[0]; first.Name == "" || first.Status == "" {
		return fmt.Errorf("le premier client n'a ni nom ni statut (%+v) : une ligne de tableau resterait "+
			"vide", first)
	}

	return nil
}

// gotErrorWithCode observe ce dont un écran a besoin pour dire *pourquoi* : une erreur reconnaissable
// par `errors.As`, portant le code stable de la passerelle et le statut de son refus. Le message que
// la passerelle a écrit n'est pas observé ici — c'est du texte amont, que l'invariant (a) tient hors
// de tout rendu et que `errors_test.go` garde.
func (c *adminCalls) gotErrorWithCode(code string) error {
	var apiErr *gateway.APIError

	if !errors.As(c.err, &apiErr) {
		return fmt.Errorf("le refus de la passerelle n'est pas arrivé comme une erreur typée (%v) : "+
			"l'écran n'aurait rien à dire de plus qu'« une erreur est survenue »", c.err)
	}

	if apiErr.Code != code {
		return fmt.Errorf("l'erreur porte le motif %q et non %q", apiErr.Code, code)
	}

	if apiErr.Status != c.refusedWith {
		return fmt.Errorf("l'erreur porte le statut %d et non le %d du refus", apiErr.Status, c.refusedWith)
	}

	return nil
}

// adminMock rend l'URL du mock que les scénarios interrogent : celui qu'on nous signale, ou le nôtre.
func adminMock(t *testing.T) string {
	t.Helper()

	//nolint:forbidigo // Ce n'est pas une configuration du produit mais le signalement d'un mock déjà
	// lancé par `make mock`, qui n'existe que pour le harnais. L'exemption est nommée ici plutôt que
	// posée sur le fichier, qui laisserait un test lire la vraie configuration depuis l'environnement.
	if signaled := os.Getenv(envMockBaseURL); signaled != "" {
		t.Logf("mock déjà lancé, réutilisé : %s (%s)", signaled, envMockBaseURL)

		return signaled
	}

	return startPrism(t).baseURL
}

// prismMock est un mock lancé par le harnais : son URL, et les routes qu'il a annoncées au démarrage.
type prismMock struct {
	baseURL string
	routes  []announcedRoute
}

// announcedRoute est une opération que Prism dit servir. Il en imprime une ligne par opération du
// document au démarrage, l'URL portant déjà les exemples de ses paramètres de chemin.
type announcedRoute struct {
	method string
	url    string
}

func (r announcedRoute) String() string {
	return r.method + " " + r.url
}

// startPrism lance un mock sur un port libre et rend la main quand il écoute.
//
// Le port est **choisi par le système** (`--port 0`, l'adresse effective se lit dans le journal de
// démarrage) et non fixé : le port 4010 de `make mock` est souvent déjà pris sur le poste, et Prism
// n'échoue pas discrètement dans ce cas — il imprime son mode d'emploi entier suivi d'un
// `listen EADDRINUSE`, ce qui donne un rouge que personne ne relie à un port occupé.
func startPrism(t *testing.T) *prismMock {
	t.Helper()

	root := repositoryRoot(t)
	binary := filepath.Join(root, prismBinary)
	contract := filepath.Join(root, adminContract)

	for _, required := range []string{binary, contract} {
		_, err := os.Stat(required)
		require.NoErrorf(t, err, "%s est absent — le mock et le contrat viennent de GitHub Packages : "+
			"pnpm -C web install", required)
	}

	output := &syncBuffer{}
	prism := exec.Command(binary, "mock", "--port", "0", "--host", "127.0.0.1", contract)
	prism.Stdout = output
	prism.Stderr = output

	require.NoError(t, prism.Start(), "lancement du mock Prism")

	// Un mock laissé vivant tient un port et fait échouer la suite suivante. Le hook s'exécute aussi
	// quand un scénario tombe ; il ne couvre pas un binaire de test tué de l'extérieur.
	t.Cleanup(func() {
		_ = prism.Process.Kill()
		_ = prism.Wait()
	})

	mock, err := awaitPrism(output, prismStartup)
	require.NoError(t, err)

	return mock
}

var (
	// « Prism is listening on http://127.0.0.1:59086 » — la dernière ligne du démarrage.
	prismListening = regexp.MustCompile(`Prism is listening on (http://\S+)`)
	// « ℹ  info      GET        http://127.0.0.1:59086/admin/customers » — une ligne par opération.
	prismRouteAnnouncement = regexp.MustCompile(`info\s+([A-Z]+)\s+(http://\S+)`)
)

func awaitPrism(output *syncBuffer, within time.Duration) (*prismMock, error) {
	deadline := time.Now().Add(within)

	for time.Now().Before(deadline) {
		printed := output.String()

		if listening := prismListening.FindStringSubmatch(printed); listening != nil {
			return &prismMock{baseURL: listening[1], routes: announcedRoutes(printed)}, nil
		}

		time.Sleep(20 * time.Millisecond)
	}

	return nil, fmt.Errorf("le mock Prism n'a pas annoncé son écoute en %s :\n%s", within, output.String())
}

func announcedRoutes(printed string) []announcedRoute {
	var routes []announcedRoute

	for _, announcement := range prismRouteAnnouncement.FindAllStringSubmatch(printed, -1) {
		routes = append(routes, announcedRoute{method: announcement[1], url: announcement[2]})
	}

	return routes
}

// Prism écrit depuis sa propre goroutine pendant que le harnais lit : sans verrou, `-race` signale la
// course avant même que quoi que ce soit n'échoue.
type syncBuffer struct {
	mu       sync.Mutex
	contents strings.Builder
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.contents.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.contents.String()
}
