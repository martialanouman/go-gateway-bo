package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/cucumber/godog"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/legacy"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Les scénarios exercent le binaire livré, pas une fonction appelée en bibliothèque : ce qui est
// décrit ici est le comportement d'un process — il démarre, il refuse, il sert l'application qu'il
// embarque, il s'arrête sur un signal. Ce fichier porte donc la compilation du binaire, le harnais
// qui le lance et l'interroge, et les définitions de steps ; les assets qu'il embarque sont mis en
// scène par `webassets_fixtures_test.go`.
var dashboardBinary string

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

// runTests existe pour que tout ce qui est posé avant les scénarios soit défait par un `defer` : le
// répertoire embarqué appartient à l'arbre de travail, et `os.Exit` n'en déroule aucun. Le code de
// sortie est nommé parce qu'une restauration ratée le remplace après coup.
func runTests(m *testing.M) (code int) {
	restoreAssets, err := stageAssetFixtures()
	if err != nil {
		fmt.Fprintln(os.Stderr, "mise en scène des assets:", err)

		return 1
	}
	defer func() { code = restoreOrFail(code, restoreAssets, os.Stderr) }()

	dir, err := os.MkdirTemp("", "dashboard-bin")
	if err != nil {
		fmt.Fprintln(os.Stderr, "répertoire temporaire:", err)

		return 1
	}
	defer os.RemoveAll(dir)

	dashboardBinary = filepath.Join(dir, "dashboard")
	if err := buildBinary(dashboardBinary, buildTimeout); err != nil {
		fmt.Fprintln(os.Stderr, "compilation du binaire:", err)

		return 1
	}

	return m.Run()
}

// Ce qui précède `m.Run` n'échappe pas à toute limite — `cmd/go` en arme une **externe**, qui couvre
// le process entier : `testKillTimeout = testTimeout + 1*time.Minute`, posée autour du lancement du
// binaire (`cmd/go/internal/test/test.go:841` et `:1641`, « add a last-ditch deadline to detect and
// stop wedged binaires »). Avec le `-timeout` de 10 minutes par défaut, une compilation partie en
// vrille est donc tuée vers 11 minutes.
//
// Ce qui lui échappe est la borne **interne** au binaire, celle que `m.Run` arme : pas de panique
// horodatée, pas de dump de goroutines, pas de test à qui attribuer l'attente. Le dernier recours de
// `cmd/go` affiche « *** Test killed: ran too long » et ne dit pas ce qui pendait. C'est ce que cette
// borne-ci achète : deux minutes et un message qui nomme la compilation, plutôt que onze minutes et
// un message muet. Elle est large parce qu'elle vise la compilation en vrille, pas la machine lente.
const buildTimeout = 2 * time.Minute

// buildBinary fabrique lui-même son contexte : la borne n'a ainsi qu'un site, celui que le test
// exerce. Portée par le contexte de l'appelant, elle se retirait d'un `context.Background()` posé au
// site d'appel, sans qu'aucun test ne rougisse.
func buildBinary(path string, within time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), within)
	defer cancel()

	build := exec.CommandContext(ctx, "go", "build", "-o", path, ".")
	build.Stderr = os.Stderr

	if err := build.Run(); err != nil {
		return errors.Join(err, ctx.Err())
	}

	return nil
}

// La borne est prouvée là où elle est posée. La version d'avant fabriquait son propre contexte et le
// passait à `buildBinary` : elle prouvait la propagation dans `exec.CommandContext`, pas que le seul
// appel réel soit borné — remplacer ce contexte par un `context.Background()` au site d'appel laissait
// la suite verte. Il n'y a plus de contexte à remplacer : `buildBinary` porte le sien.
func TestTheBuildStopsWhenItsDeadlinePasses(t *testing.T) {
	t.Parallel()

	err := buildBinary(filepath.Join(t.TempDir(), "dashboard"), time.Nanosecond)

	require.Error(t, err, "la compilation ignore la borne qu'on lui donne : elle peut pendre sans "+
		"limite, et sans dire que c'est elle qui pendait")
	assert.ErrorIs(t, err, context.DeadlineExceeded)
}

// Ces scénarios sont le seul endroit où le câblage réel est exercé (DN-3, niveau 2). Or `godog` ne
// pose aucun plancher : `Paths` qui ne trouve rien rend une suite vide et réussie, et `Strict` ne
// couvre que les steps non définies d'un scénario **lu**. Un `.feature` déplacé, renommé ou vidé
// laisserait donc la suite verte sans que rien du binaire n'ait tourné. Le registre ferme les deux
// trous : un plancher sur ce qui a réellement tourné, et l'exigence que chaque `.feature` du
// répertoire ait porté au moins un scénario.
func TestScenarios(t *testing.T) {
	ran := &scenarioLedger{}

	suite := godog.TestSuite{
		Name: "dashboard",
		ScenarioInitializer: func(ctx *godog.ScenarioContext) {
			ran.watch(ctx)
			initializeScenario(ctx)
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

	ran.requireCorpusExercised(t, runFilter())
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

// filtersScenarios dit si le filtre coupe dans les scénarios eux-mêmes. `-test.run` découpe son motif
// sur les `/`, un niveau par profondeur de sous-test : sans `/`, il ne choisit que le test de tête, et
// les scénarios que celui-ci porte tournent tous.
func filtersScenarios(runFilter string) bool {
	return strings.Contains(runFilter, "/")
}

// minimumScenarios est un plancher, pas un compte : en ajouter un n'oblige à rien ici, en retirer un
// demande de le dire — c'est exactement la relecture qu'on veut provoquer.
const minimumScenarios = 5

// scenarioLedger note ce que la suite a réellement exécuté. Le verrou n'est pas décoratif : `godog`
// exécute les scénarios en parallèle dès que `Concurrency` dépasse 1, et ce jour-là le compteur se
// tairait sous `-race` plutôt que de compter faux.
type scenarioLedger struct {
	mu       sync.Mutex
	byFile   map[string]int
	executed int
}

func (l *scenarioLedger) watch(ctx *godog.ScenarioContext) {
	ctx.Before(func(ctx context.Context, sc *godog.Scenario) (context.Context, error) {
		l.mu.Lock()
		defer l.mu.Unlock()

		if l.byFile == nil {
			l.byFile = make(map[string]int)
		}
		// `sc.Uri` est le chemin relatif au répertoire que godog a parcouru, séparé par des `/` :
		// c'est la forme que `featureFiles` reproduit, et deux `.feature` de même nom rangés dans des
		// sous-répertoires différents y restent distincts.
		l.byFile[sc.Uri]++
		l.executed++

		return ctx, nil
	})
}

func (l *scenarioLedger) requireCorpusExercised(t *testing.T, runFilter string) {
	t.Helper()

	// `TestingT: t` fait de chaque pickle un sous-test, et `t.Run` rend `true` sans exécuter sa closure
	// — donc sans le hook `Before` du registre — quand le nom ne correspond pas au filtre. Le registre
	// ne voit alors qu'une partie du corpus, et les deux exigences accuseraient celui qui débogue un
	// scénario seul d'avoir fait fondre le corpus. Le dire, plutôt que se taire, pour que personne ne
	// croie la porte active.
	if filtersScenarios(runFilter) {
		t.Logf("plancher et couverture du corpus non vérifiés : `-run %s` ne demande qu'une partie des "+
			"scénarios. Ces deux portes ne mordent qu'une suite lancée en entier", runFilter)

		return
	}

	features, err := featureFiles(".")
	if err != nil {
		t.Fatal(err)
	}

	for _, shortfall := range l.shortfalls(features) {
		t.Error(shortfall)
	}
}

// shortfalls rend ce que le registre reproche au corpus, et rien quand il est entièrement exercé.
func (l *scenarioLedger) shortfalls(features []string) []string {
	l.mu.Lock()
	defer l.mu.Unlock()

	var shortfalls []string

	if l.executed < minimumScenarios {
		shortfalls = append(shortfalls, fmt.Sprintf(
			"%d scénario(s) exécuté(s) pour un plancher de %d : le corpus a fondu, ou la suite ne le "+
				"trouve plus — dans les deux cas elle ne prouve plus rien du binaire",
			l.executed, minimumScenarios))
	}

	for _, feature := range features {
		if l.byFile[feature] == 0 {
			shortfalls = append(shortfalls, fmt.Sprintf(
				"%s n'a exécuté aucun scénario : il est présent mais la suite l'ignore", feature))
		}
	}

	return shortfalls
}

// featureFiles nomme les scénarios que la suite doit exercer, dans la forme où godog les nomme :
// relatifs à `root`, séparés par des `/`. La recherche descend dans les sous-répertoires parce que
// `Paths: ["."]` y descend aussi — un glob `*.feature` ne verrait que le répertoire courant, et un
// `.feature` rangé plus bas tournerait sans que personne n'exige qu'il tourne.
func featureFiles(root string) ([]string, error) {
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
	if err != nil {
		return nil, fmt.Errorf("lecture des fichiers de scénarios sous %s: %w", root, err)
	}

	return features, nil
}

// `TestingT: t` fait de chaque pickle un sous-test, et les hooks `Before` s'exécutent **dans** la
// closure de `t.Run` — or `t.Run` rend `true` sans l'exécuter quand le nom ne correspond pas à
// `-test.run`. Déboguer un scénario seul n'ouvre donc qu'un `Before` sur cinq : le registre compterait
// 1 et accuserait le corpus d'avoir fondu, sur un flux de travail parfaitement normal.
func TestARunFilterStandsTheCorpusFloorDown(t *testing.T) {
	t.Parallel()

	// Registre vide, comme après un `-run 'TestScenarios/aucun_nom_ne_correspond'`. Si la porte
	// mordait encore, c'est ce test-ci qui tomberait.
	(&scenarioLedger{}).requireCorpusExercised(t, "TestScenarios/une_URL_collée")
}

// La porte ne se retire que devant un filtre qui coupe vraiment dans les scénarios. `-test.run`
// découpe son motif sur les `/`, un niveau par profondeur de sous-test : sans `/`, il ne choisit que
// le test de tête et les cinq scénarios tournent tous — se taire là rendrait le plancher retirable
// par un `go test -run TestScenarios`, qui est la commande de tous les jours.
func TestOnlyASubtestFilterStandsTheCorpusFloorDown(t *testing.T) {
	t.Parallel()

	for filter, standsDown := range map[string]bool{
		"":                                 false,
		"TestScenarios":                    false,
		"TestSc":                           false,
		"TestScenarios/une_URL_collée.*":   true,
		"TestScenarios/aucun_nom_ne_colle": true,
	} {
		assert.Equal(t, standsDown, filtersScenarios(filter), "-run %q", filter)
	}
}

func TestTheLedgerReportsACorpusThatShrank(t *testing.T) {
	t.Parallel()

	ran := ledgerOf("assets.feature", minimumScenarios-1)

	shortfalls := ran.shortfalls([]string{"assets.feature"})

	require.NotEmpty(t, shortfalls,
		"le corpus a fondu sous le plancher sans que le registre le dise : la suite ne prouve plus "+
			"grand-chose du binaire et se tait")
	assert.Contains(t, strings.Join(shortfalls, "\n"), "plancher")
}

func TestTheLedgerReportsAFeatureThatRanNothing(t *testing.T) {
	t.Parallel()

	ran := ledgerOf("assets.feature", minimumScenarios)

	shortfalls := ran.shortfalls([]string{"assets.feature", "sous-repertoire/silencieux.feature"})

	require.Len(t, shortfalls, 1,
		"un `.feature` présent que la suite n'ouvre jamais — mal nommé, mal rangé, filtré par un tag — "+
			"est un comportement décrit que personne n'exerce")
	assert.Contains(t, shortfalls[0], "sous-repertoire/silencieux.feature")
}

func TestTheLedgerIsSilentOnAFullyExercisedCorpus(t *testing.T) {
	t.Parallel()

	ran := ledgerOf("assets.feature", minimumScenarios)

	assert.Empty(t, ran.shortfalls([]string{"assets.feature"}),
		"un corpus entièrement exercé n'a rien à se reprocher")
}

// `Paths: ["."]` descend dans les sous-répertoires, là où un glob `*.feature` ne voit que le
// répertoire courant : l'exigence doit couvrir exactement ce que godog exécute.
func TestFeatureFilesAreFoundInSubdirectoriesToo(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, "sous-repertoire"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(root, "racine.feature"), nil, 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(root, "sous-repertoire", "range.feature"), nil, 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(root, "pas-un-scenario.go"), nil, 0o644))

	features, err := featureFiles(root)

	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"racine.feature", "sous-repertoire/range.feature"}, features,
		"un `.feature` rangé dans un sous-répertoire tournerait sans que personne n'exige qu'il tourne")
}

func ledgerOf(feature string, scenarios int) *scenarioLedger {
	return &scenarioLedger{byFile: map[string]int{feature: scenarios}, executed: scenarios}
}

func initializeScenario(ctx *godog.ScenarioContext) {
	p := &process{}

	ctx.Given(`^une configuration complète dont on retire "([^"]*)"$`, p.configurationWithout)
	ctx.Given(`^une configuration complète dont on passe "([^"]*)" à "([^"]*)"$`, p.configurationWith)
	ctx.Given(`^un serveur démarré$`, p.startAndServe)
	ctx.When(`^le serveur démarre$`, p.start)
	ctx.When(`^le serveur reçoit SIGTERM$`, p.signalTerm)
	ctx.When(`^le navigateur demande "([^"]*)"$`, p.fetch)
	ctx.When(`^le navigateur demande le script que la coquille référence$`, p.fetchReferencedScript)
	ctx.Then(`^le serveur refuse de démarrer$`, p.refusesToStart)
	ctx.Then(`^le message d'erreur nomme "([^"]*)"$`, p.messageNames)
	ctx.Then(`^le serveur s'arrête sans erreur$`, p.exitsCleanly)
	ctx.Then(`^le tableau de bord s'affiche$`, p.servesDashboard)
	ctx.Then(`^le script est servi$`, p.servesScript)
	ctx.Then(`^le serveur répond (\d+)$`, p.respondsWith)
	ctx.Then(`^la réponse n'est pas une page HTML$`, p.responseIsNotHTML)
	ctx.Then(`^le navigateur garde la réponse en cache un an$`, p.responseIsCachedForAYear)
	ctx.Then(`^le navigateur ne garde pas la réponse en cache$`, p.responseIsNeverCached)
	ctx.Then(`^la réponse valide le contrat du BFF$`, p.responseMatchesTheContract)
	ctx.Then(`^le service se déclare "([^"]*)"$`, p.reportsStatus)

	ctx.After(func(ctx context.Context, _ *godog.Scenario, err error) (context.Context, error) {
		p.kill()

		return ctx, err
	})
}

// Toute attente du harnais est bornée. Sans limite, un serveur qui ne répond pas devient un test qui
// ne finit pas, et le hook de fin — celui qui tue l'enfant — n'est alors jamais atteint. Le hook a
// lui aussi sa borne : au-delà, il rend la main sans avoir constaté la mort de l'enfant, ce qui vaut
// mieux qu'un scénario suspendu, mais reste un abandon.
var browser = &http.Client{Timeout: 2 * time.Second}

// completeConfiguration est le plus petit environnement avec lequel le binaire démarre. Le port 0
// laisse le système en choisir un libre, et le mode `mock` n'exige de la passerelle que son adresse —
// aucun scénario d'ici ne la joint, mais la configuration se valide au démarrage, avant tout appel.
func completeConfiguration() map[string]string {
	return map[string]string{
		"DASHBOARD_ADDR":             "127.0.0.1:0",
		"DASHBOARD_GATEWAY_MODE":     "mock",
		"DASHBOARD_GATEWAY_BASE_URL": "http://127.0.0.1:4010",
	}
}

type process struct {
	env      map[string]string
	cmd      *exec.Cmd
	output   *syncBuffer
	exited   chan error
	addr     string
	received *response
}

// response est ce qu'un navigateur voit d'une réponse : son code, ses en-têtes et son corps. Le
// harnais le garde parce qu'un scénario enchaîne — il lit la coquille, puis demande le fichier
// qu'elle référence.
// La méthode et le chemin sont gardés avec la réponse : les confronter au contrat demande de retrouver
// l'opération que celui-ci destine à la requête, et une réponse orpheline ne dit plus à quoi la
// comparer.
type response struct {
	method string
	path   string
	status int
	header http.Header
	body   string
}

func (p *process) configurationWithout(name string) error {
	if err := p.startFromCompleteConfiguration(name); err != nil {
		return err
	}
	delete(p.env, name)

	return nil
}

func (p *process) configurationWith(name, value string) error {
	if err := p.startFromCompleteConfiguration(name); err != nil {
		return err
	}
	p.env[name] = value

	return nil
}

// startFromCompleteConfiguration refuse une variable que la configuration complète ne porte pas :
// sinon un nom mal orthographié décrirait un environnement que personne n'a, et le scénario passerait
// pour avoir exercé ce qu'il annonce.
func (p *process) startFromCompleteConfiguration(name string) error {
	p.env = completeConfiguration()
	if _, ok := p.env[name]; !ok {
		return fmt.Errorf("%q n'appartient pas à la configuration complète du scénario", name)
	}

	return nil
}

func (p *process) start() error {
	if p.env == nil {
		p.env = completeConfiguration()
	}

	p.output = &syncBuffer{}
	p.cmd = exec.Command(dashboardBinary)
	p.cmd.Env = environment(p.env)
	p.cmd.Stdout = p.output
	p.cmd.Stderr = p.output

	if err := p.cmd.Start(); err != nil {
		return fmt.Errorf("lancement du binaire: %w", err)
	}

	// Le canal est refermé après l'envoi : une step lit le code de sortie, et le hook de fin le
	// relit sans se bloquer sur un canal déjà vidé.
	p.exited = make(chan error, 1)
	go func() {
		p.exited <- p.cmd.Wait()
		close(p.exited)
	}()

	return nil
}

func (p *process) startAndServe() error {
	if err := p.start(); err != nil {
		return err
	}

	addr, err := p.awaitListenAddr(5 * time.Second)
	if err != nil {
		return err
	}
	p.addr = addr

	resp, err := browser.Get(p.url("/api/health"))
	if err != nil {
		return fmt.Errorf("le serveur ne répond pas: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("la sonde de vivacité rend %s", resp.Status)
	}

	return nil
}

// awaitListenAddr lit l'adresse effectivement obtenue dans le journal de démarrage. C'est ce qui
// permet au scénario de demander le port 0 : il ne suppose aucun port libre sur la machine de CI.
func (p *process) awaitListenAddr(timeout time.Duration) (string, error) {
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		for line := range strings.SplitSeq(p.output.String(), "\n") {
			var entry struct {
				Addr string `json:"addr"`
			}

			if json.Unmarshal([]byte(line), &entry) == nil && entry.Addr != "" {
				return entry.Addr, nil
			}
		}

		time.Sleep(20 * time.Millisecond)
	}

	return "", fmt.Errorf("le serveur n'a pas annoncé son adresse d'écoute :\n%s", p.output.String())
}

func (p *process) signalTerm() error {
	return p.cmd.Process.Signal(syscall.SIGTERM)
}

func (p *process) exitsCleanly() error {
	select {
	case err := <-p.exited:
		if err != nil {
			return fmt.Errorf("le process s'est arrêté en erreur: %w\n%s", err, p.output.String())
		}

		return nil
	case <-time.After(10 * time.Second):
		return errors.New("le process n'a pas rendu la main : l'orchestrateur devra le tuer")
	}
}

func (p *process) url(path string) string {
	return "http://" + p.addr + path
}

func (p *process) fetch(path string) error {
	resp, err := browser.Get(p.url(path))
	if err != nil {
		return fmt.Errorf("la requête vers %s a échoué: %w", path, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("lecture de la réponse de %s: %w", path, err)
	}

	p.received = &response{
		method: http.MethodGet,
		path:   path,
		status: resp.StatusCode,
		header: resp.Header,
		body:   string(body),
	}

	return nil
}

// La coquille référence ses fichiers hachés en absolu : les relire dans le corps rendu, plutôt que
// de coder un nom en dur, exerce le chemin qu'un navigateur emprunte vraiment.
var referencedScript = regexp.MustCompile(`src="(/assets/[^"]+\.js)"`)

func (p *process) fetchReferencedScript() error {
	if p.received == nil {
		return errors.New("aucune réponse à lire : la coquille n'a pas été demandée")
	}

	match := referencedScript.FindStringSubmatch(p.received.body)
	if match == nil {
		return fmt.Errorf("la coquille ne référence aucun script sous /assets/ :\n%s", p.received.body)
	}

	return p.fetch(match[1])
}

func (p *process) servesDashboard() error {
	if err := p.respondsWith(http.StatusOK); err != nil {
		return err
	}

	if err := p.contentTypeContains("text/html"); err != nil {
		return err
	}

	for _, marker := range []string{"<!doctype html", `id="app"`} {
		if !strings.Contains(p.received.body, marker) {
			return fmt.Errorf("la réponse ne porte pas %q, ce n'est pas le tableau de bord :\n%s",
				marker, p.received.body)
		}
	}

	return nil
}

func (p *process) servesScript() error {
	if err := p.respondsWith(http.StatusOK); err != nil {
		return err
	}

	return p.contentTypeContains("javascript")
}

func (p *process) respondsWith(status int) error {
	if p.received == nil {
		return errors.New("aucune réponse à examiner : rien n'a été demandé au serveur")
	}

	if p.received.status != status {
		return fmt.Errorf("le serveur a répondu %d au lieu de %d :\n%s",
			p.received.status, status, p.received.body)
	}

	return nil
}

func (p *process) responseIsNotHTML() error {
	if p.received == nil {
		return errors.New("aucune réponse à examiner : rien n'a été demandé au serveur")
	}

	if contentType := p.received.header.Get("Content-Type"); strings.Contains(contentType, "text/html") {
		return fmt.Errorf("la réponse est du HTML (%s) : le client la lira comme une page, pas comme une erreur",
			contentType)
	}

	return nil
}

func (p *process) responseIsCachedForAYear() error {
	directives, err := p.cacheControl()
	if err != nil {
		return err
	}

	for _, expected := range []string{"max-age=31536000", "immutable"} {
		if !strings.Contains(directives, expected) {
			return fmt.Errorf("la réponse annonce %q, sans %q : le navigateur la redemandera",
				directives, expected)
		}
	}

	return nil
}

func (p *process) responseIsNeverCached() error {
	directives, err := p.cacheControl()
	if err != nil {
		return err
	}

	if !strings.Contains(directives, "no-cache") {
		return fmt.Errorf("la réponse annonce %q : un onglet ouvert après un déploiement demanderait des fichiers disparus",
			directives)
	}

	return nil
}

// contractPath désigne le contrat du dépôt lui-même, jamais une copie : une copie divergerait du
// fichier dont les deux moitiés du produit dérivent, et la validation se mettrait à répondre d'un
// document que plus personne ne relit. Le chemin est relatif au répertoire du paquet, celui d'où
// `go test` lance le binaire de test.
const contractPath = "../../api/openapi-bff.yaml"

// contractRouter lie une requête HTTP à l'opération que le contrat lui destine. Le routeur `legacy`
// plutôt que `gorillamux` : ce dernier ajouterait `gorilla/mux` au graphe de dépendances du dépôt,
// et le premier rapproche la requête du contrat par son seul chemin
// (`routers/legacy/router.go:121` → `openapi3.Servers.MatchURL`), ce qu'un `servers.url` relatif
// comme `/api` demande. Il valide au passage le document lui-même (`routers/legacy/router.go:62`).
func contractRouter(ctx context.Context) (routers.Router, error) {
	doc, err := (&openapi3.Loader{Context: ctx}).LoadFromFile(contractPath)
	if err != nil {
		return nil, fmt.Errorf("lecture du contrat %s: %w", contractPath, err)
	}

	router, err := legacy.NewRouter(doc)
	if err != nil {
		return nil, fmt.Errorf("le contrat %s ne décrit aucune route exploitable: %w", contractPath, err)
	}

	return router, nil
}

func (p *process) responseMatchesTheContract() error {
	if p.received == nil {
		return errors.New("aucune réponse à examiner : rien n'a été demandé au serveur")
	}

	ctx := context.Background()

	router, err := contractRouter(ctx)
	if err != nil {
		return err
	}

	// La requête est rejouée sous la forme que le routeur compare au contrat — une méthode, un
	// chemin. La validation n'en lit rien d'autre : la méthode, pour laisser passer un HEAD sans
	// corps (`openapi3filter/validate_response.go:23`), et la route trouvée ici.
	request := httptest.NewRequest(p.received.method, p.received.path, nil)

	route, pathParams, err := router.FindRoute(request)
	if err != nil {
		return fmt.Errorf("le contrat ne décrit pas %s %s: %w", p.received.method, p.received.path, err)
	}

	err = openapi3filter.ValidateResponse(ctx, &openapi3filter.ResponseValidationInput{
		RequestValidationInput: &openapi3filter.RequestValidationInput{
			Request:    request,
			PathParams: pathParams,
			Route:      route,
		},
		Status: p.received.status,
		Header: p.received.header,
		Body:   io.NopCloser(strings.NewReader(p.received.body)),
		// Sans cette option, un statut que le contrat ne documente pas est tenu pour valide
		// (`openapi3filter/validate_response.go:52-57`) — or c'est justement une réponse dont le
		// client n'a aucun type. Mesuré : un 201 simulé échoue « status is not supported » avec
		// l'option, et passe sans elle.
		Options: &openapi3filter.Options{IncludeResponseStatus: true},
	})
	if err != nil {
		return fmt.Errorf("la réponse servie ne valide pas le contrat: %w\n%s", err, p.received.body)
	}

	return nil
}

// reportsStatus lit le corps sans passer par le validateur. Aucune mutation du produit ne le fait
// tomber seul — l'enum du contrat n'a qu'un membre, donc toute valeur qui le contredit casse d'abord
// la validation. Ce qu'il couvre est l'autre panne : un validateur devenu inerte, qui rendrait le
// scénario vert sans rien lire. Mesuré : validation neutralisée **et** statut `vivant`, c'est ce
// step-ci qui rougit.
func (p *process) reportsStatus(expected string) error {
	if p.received == nil {
		return errors.New("aucune réponse à examiner : rien n'a été demandé au serveur")
	}

	var probe struct {
		Status string `json:"status"`
	}

	if err := json.Unmarshal([]byte(p.received.body), &probe); err != nil {
		return fmt.Errorf("la réponse n'est pas du JSON: %w\n%s", err, p.received.body)
	}

	if probe.Status != expected {
		return fmt.Errorf("le service se déclare %q et non %q", probe.Status, expected)
	}

	return nil
}

func (p *process) cacheControl() (string, error) {
	if p.received == nil {
		return "", errors.New("aucune réponse à examiner : rien n'a été demandé au serveur")
	}

	directives := p.received.header.Get("Cache-Control")
	if directives == "" {
		return "", errors.New("la réponse ne dit rien de sa mise en cache : le navigateur décidera pour elle")
	}

	return directives, nil
}

func (p *process) contentTypeContains(expected string) error {
	if contentType := p.received.header.Get("Content-Type"); !strings.Contains(contentType, expected) {
		return fmt.Errorf("la réponse est de type %q et non %q", contentType, expected)
	}

	return nil
}

func (p *process) refusesToStart() error {
	select {
	case err := <-p.exited:
		// Les deux échecs sont distingués : sans ça, le cas le plus fréquent — une sortie en succès,
		// donc une erreur nulle — se présenterait comme une erreur vide.
		if err == nil {
			return errors.New("le process a rendu un code 0 : il aurait dû refuser de démarrer")
		}

		var exit *exec.ExitError
		if !errors.As(err, &exit) {
			return fmt.Errorf("le process ne s'est pas arrêté normalement: %w", err)
		}

		return nil
	case <-time.After(5 * time.Second):
		return errors.New("le process tourne toujours : il a démarré avec une configuration incomplète")
	}
}

func (p *process) messageNames(name string) error {
	if output := p.output.String(); !strings.Contains(output, name) {
		return fmt.Errorf("le message ne nomme pas %q :\n%s", name, output)
	}

	return nil
}

func (p *process) kill() {
	if p.cmd == nil || p.cmd.Process == nil {
		return
	}

	_ = p.cmd.Process.Kill()

	select {
	case <-p.exited:
	case <-time.After(5 * time.Second):
	}
}

func environment(vars map[string]string) []string {
	// Un environnement construit de zéro : hériter de celui du test laisserait un DASHBOARD_ADDR
	// posé dans le shell rendre le scénario vert sans que le code y soit pour rien.
	env := make([]string, 0, len(vars)+1)
	//nolint:forbidigo // PATH n'est pas une configuration du produit : c'est ce qui permet à l'enfant
	// de trouver un exécutable. L'exemption est nommée ici plutôt que posée sur tous les `_test.go`,
	// qui laisserait un test lire la vraie configuration depuis l'environnement.
	env = append(env, "PATH="+os.Getenv("PATH"))
	for name, value := range vars {
		env = append(env, name+"="+value)
	}

	return env
}

// Le process écrit depuis sa propre goroutine pendant que les steps lisent : sans verrou, `-race`
// signale la course avant même que le scénario n'échoue.
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
