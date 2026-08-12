package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
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

	"github.com/martialanouman/go-gateway-bo/internal/bddtest"
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
	// Le conteneur naît avant la compilation du binaire : les deux prennent quelques secondes, et
	// échouer sur un Docker absent avant d'avoir compilé rend la main plus vite.
	terminatePostgres, err := startPostgres(context.Background())
	defer terminatePostgres()

	if err != nil {
		fmt.Fprintln(os.Stderr, err)

		return 1
	}

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

// Ces scénarios sont le seul endroit où le câblage réel est exercé (DN-3, niveau 2). Le registre qui
// exige qu'ils aient tourné vit dans `internal/bddtest`, avec ses propres tests unitaires.
func TestScenarios(t *testing.T) {
	ran := &bddtest.Ledger{}
	visited := &bddtest.OperationLedger{}

	suite := godog.TestSuite{
		Name: "dashboard",
		ScenarioInitializer: func(ctx *godog.ScenarioContext) {
			ran.Watch(ctx)
			initializeScenario(ctx, visited)
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

	ran.RequireCorpusExercised(t, ".", minimumScenarios)

	// Chaque opération du contrat doit avoir été confrontée à lui par un scénario. C'est la seule porte
	// qui attrape un type de réponse écrit à la main dont le `Visit…` sérialise ce qu'il veut : les
	// portes structurelles de `internal/bff` regardent la forme des champs déclarés, et un type sans
	// champ n'en a aucun à examiner. Elle vit ici parce que c'est ici que les scénarios valident.
	visited.RequireEveryOperationVisited(t, contractPath)
}

// minimumScenarios est un plancher, pas un compte : en ajouter un n'oblige à rien ici, en retirer un
// demande de le dire — c'est exactement la relecture qu'on veut provoquer.
//
// Il vaut donc le corpus, sans jeu. Laissé à 5 quand le corpus est passé à 7, il n'exigeait plus rien :
// mesuré, `contrat.feature` renommé en `.feature.disabled` laissait la suite verte, et deux fichiers
// entiers retirés aussi. Un plancher qui survit à ce qu'il doit interdire est une phrase, pas une porte.
const minimumScenarios = 42

// Le registre d'opérations est passé par la suite et non construit ici : `initializeScenario` est
// rappelé à chaque scénario, et un registre neuf à chaque fois n'aurait jamais vu que la dernière
// opération validée.
func initializeScenario(ctx *godog.ScenarioContext, visited *bddtest.OperationLedger) {
	p := &process{visited: visited}

	ctx.Given(`^une configuration complète dont on retire "([^"]*)"$`, p.configurationWithout)
	ctx.Given(`^une configuration complète dont on passe "([^"]*)" à "([^"]*)"$`, p.configurationWith)
	ctx.Given(`^un serveur démarré$`, p.startAndServe)

	schema := &schemaWorld{process: p}

	login := &loginWorld{process: p}

	ctx.Given(`^une installation avec un opérateur$`, login.installationWithOneOperator)
	ctx.Given(`^l'opérateur se connecte (\d+) fois avec un mauvais mot de passe$`, login.signInWithAWrongPasswordTimes)
	ctx.When(`^l'opérateur se connecte (\d+) fois avec un mauvais mot de passe$`, login.signInWithAWrongPasswordTimes)
	ctx.When(`^l'opérateur se connecte avec son mot de passe$`, login.signInWithTheRightPassword)
	ctx.When(`^l'opérateur se connecte avec un mauvais mot de passe$`, login.signInWithAWrongPassword)
	ctx.When(`^quelqu'un se connecte avec une adresse qui n'existe pas$`, login.signInWithAnUnknownAddress)
	ctx.When(`^le verrou arrive à échéance$`, login.lockExpires)
	ctx.When(`^le navigateur envoie un corps qui n'est pas du JSON à la connexion$`, login.postMalformedBody)
	ctx.Then(`^un challenge est émis avec son échéance$`, login.challengeIsIssued)
	ctx.Then(`^le navigateur reçoit un cookie de session$`, p.receivedASessionCookie)
	ctx.Then(`^le refus ne nomme ni l'adresse ni le facteur en cause$`, login.refusalNamesNothing)
	ctx.Then(`^les deux refus sont indiscernables$`, login.refusalsAreIndistinguishable)
	ctx.Then(`^la réponse porte l'en-tête "([^"]+)"$`, login.responseCarriesHeader)
	ctx.Then(`^le message annonce la durée restante$`, login.messageAnnouncesTheRemainingDelay)
	ctx.Then(`^la réponse est conforme au contrat du BFF$`, p.responseMatchesTheContract)

	sessions := &sessionWorld{login: login}

	ctx.Given(`^l'opérateur détient les rôles "([^"]*)" et "([^"]*)"$`, sessions.grantRoles)
	ctx.Given(`^l'opérateur se connecte avec son mot de passe$`, login.signInWithTheRightPassword)
	ctx.When(`^le sceau du cookie de session est altéré$`, sessions.alterSessionSeal)
	ctx.When(`^la session reste (\d+) heures sans requête$`, sessions.idleFor)
	ctx.When(`^la session dépasse son échéance absolue$`, sessions.expireAbsolutely)
	ctx.When(`^la table des sessions devient illisible$`, sessions.breakSessionsTable)
	ctx.When(`^le navigateur se déconnecte$`, sessions.signOut)
	ctx.Given(`^le navigateur retient son cookie de session$`, sessions.rememberCookie)
	ctx.When(`^le navigateur rejoue le cookie qu'il avait retenu$`, sessions.replayTheRememberedCookie)
	ctx.Then(`^le cookie de session est expiré$`, sessions.sessionCookieIsCleared)
	ctx.Then(`^la réponse nomme l'opérateur connecté$`, sessions.namesTheOperator)
	ctx.Then(`^la réponse annonce que le second facteur n'est pas vérifié$`,
		sessions.secondFactorIsNotVerified)
	ctx.Then(`^la réponse interdit toute mise en cache$`, sessions.forbidsCaching)
	ctx.Then(`^les permissions rendues sont celles des deux rôles réunis$`,
		sessions.permissionsAreTheUnionOfHeldRoles)
	ctx.Then(`^aucune permission n'est rendue deux fois$`, sessions.noPermissionIsRenderedTwice)
	ctx.Then(`^le refus ne dit pas ce qui manque à la session$`,
		sessions.refusalSaysNothingAboutTheSession)
	ctx.Then(`^redemander "([^"]*)" est refusé de même$`, sessions.refusedAgain)

	(&mfaWorld{login: login, session: sessions}).registerSteps(ctx)

	ctx.Given(`^une base dont le schéma est en retard d'une migration$`, schema.outdatedSchema)
	ctx.Given(`^une base vierge$`, schema.freshSchema)
	ctx.Given(`^l'adresse d'écoute déjà occupée$`, schema.occupyListenAddress)
	ctx.Then(`^le message d'erreur nomme la version trouvée et la version attendue$`,
		schema.messageNamesBothVersions)
	ctx.Then(`^le message d'erreur parle du schéma et non de l'adresse$`,
		schema.messageNamesTheSchemaNotTheAddress)
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
		schema.release()

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
//
// Le DSN, lui, désigne une **vraie base à jour** depuis step-020 : le binaire contrôle la version du
// schéma avant de lier son port, et une adresse qui ne répond pas le ferait refuser de démarrer.
// C'était l'inverse jusqu'ici — le DSN était exigé, validé en forme, et jamais composé.
func completeConfiguration() map[string]string {
	return map[string]string{
		"DASHBOARD_ADDR":             "127.0.0.1:0",
		"DASHBOARD_GATEWAY_MODE":     "mock",
		"DASHBOARD_GATEWAY_BASE_URL": "http://127.0.0.1:4010",
		"DASHBOARD_DATABASE_URL":     migratedSuiteDSN,
		// Obligatoire depuis step-021, et sans repli : le binaire refuse de démarrer sans elle. Sa
		// valeur ici n'a rien d'un secret — aucun scénario ne relit un HMAC, ils observent le verrou.
		"DASHBOARD_BRUTEFORCE_SALT": "un-sel-de-scenario-assez-long-pour-la-borne",
		// Obligatoire depuis step-022, et sans repli de même. Les scénarios de session, eux, relisent
		// bien ce que cette clé scelle : c'est le serveur qui signe et vérifie, jamais le harnais.
		"DASHBOARD_SESSION_SECRET": "une-cle-de-scenario-assez-longue-pour-la-borne",
		// Obligatoire depuis step-023, et sans repli de même. Le harnais ne la relit jamais : le secret
		// TOTP lui arrive **en clair par la réponse d'enrôlement**, qui existe pour ça, donc aucun
		// scénario n'a besoin de déchiffrer une colonne.
		"DASHBOARD_TOTP_ENCRYPTION_KEY": "une-cle-de-chiffrement-de-scenario-assez-longue",
	}
}

type process struct {
	visited  *bddtest.OperationLedger
	env      map[string]string
	cmd      *exec.Cmd
	output   *bddtest.SyncBuffer
	exited   chan error
	addr     string
	received *response
	// cookies est ce que le navigateur du scénario porte d'une requête à l'autre. Voir `send` pour la
	// raison de ne pas employer un `cookiejar`.
	cookies map[string]string
}

// response est ce qu'un navigateur voit d'une réponse : son code, ses en-têtes et son corps. Le
// harnais le garde parce qu'un scénario enchaîne — il lit la coquille, puis demande le fichier
// qu'elle référence.
// La méthode et le chemin sont gardés avec la réponse : les confronter au contrat demande de retrouver
// l'opération que celui-ci destine à la requête, et une réponse orpheline ne dit plus à quoi la
// comparer.
type response struct {
	// Aucun test ne rougit si ce champ disparaît, ce qui a été vérifié plutôt que supposé : toutes les
	// steps qui interrogent le serveur passent par `fetch`, donc en GET, et le remplacer par un
	// `http.MethodGet` codé en dur au site de validation laisse la suite verte. Il reste parce que
	// c'est lui qui laissera passer un HEAD sans corps le jour où un scénario en demandera un
	// (`openapi3filter/validate_response.go:23`) — codé en dur, ce scénario-là échouerait sur une
	// comparaison qui ment plutôt que sur ce qu'il décrit.
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

	p.output = &bddtest.SyncBuffer{}
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

	addr, err := p.awaitListenAddr(startupTimeout)
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

// startupTimeout vise un démarrage parti en vrille, pas une machine chargée — même arbitrage que
// `prismStartup` dans `internal/gateway`, et pour une raison mesurée ici le 03/08/2026 : sous un
// `go test -race ./...`, où dix paquets compilent et tournent de front, le binaire n'avait **rien**
// écrit au bout des 5 s que cette borne valait alors. Le message d'échec le montrait, son journal
// étant vide. Le scénario avait tout d'un défaut du produit et n'était qu'une machine occupée ; la
// même suite lancée seule passait, et le passage suivant sur l'arbre entier aussi.
//
// Aucun test ne rougit si cette valeur revient à 5 s, ce qui a été vérifié plutôt que supposé : le
// défaut ne se reproduit que sous une charge qu'aucune porte ne fabrique. C'est un flottement, et un
// flottement se corrige à la source de son ambiguïté — ici, une borne qui confondait « le serveur ne
// démarre pas » et « le serveur n'a pas encore eu la main ».
const startupTimeout = 30 * time.Second

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
	return p.send(http.MethodGet, path, "", "")
}

// send porte les cookies **à la main** plutôt que par un `net/http/cookiejar`. Un jar refuserait tout
// cookie `Secure` servi en clair sur `127.0.0.1`, donc les scénarios de session échoueraient tous sur
// une cause étrangère au produit. Et le rejeu après déconnexion a besoin de renvoyer un cookie qu'un
// jar aurait justement supprimé.
func (p *process) send(method, path, contentType, body string) error {
	request, err := http.NewRequestWithContext(context.Background(), method, p.url(path),
		strings.NewReader(body))
	if err != nil {
		return fmt.Errorf("composer la requête vers %s: %w", path, err)
	}

	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}

	for name, value := range p.cookies {
		request.AddCookie(&http.Cookie{Name: name, Value: value})
	}

	resp, err := browser.Do(request)
	if err != nil {
		return fmt.Errorf("la requête vers %s a échoué: %w", path, err)
	}
	defer resp.Body.Close()

	received, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("lecture de la réponse de %s: %w", path, err)
	}

	p.remember(resp.Cookies())

	p.received = &response{
		method: method,
		path:   path,
		status: resp.StatusCode,
		header: resp.Header,
		body:   string(received),
	}

	return nil
}

// remember imite ce qu'un navigateur retient : un cookie dont l'échéance est passée est **oublié**,
// il n'est pas conservé avec une valeur vide.
func (p *process) remember(cookies []*http.Cookie) {
	for _, cookie := range cookies {
		if p.cookies == nil {
			p.cookies = map[string]string{}
		}

		if cookie.MaxAge < 0 {
			delete(p.cookies, cookie.Name)

			continue
		}

		p.cookies[cookie.Name] = cookie.Value
	}
}

// post envoie un corps JSON. Le harnais n'avait que `fetch`, en GET : `POST /auth/login` est la
// première opération du contrat à porter un corps, et `responseMatchesTheContract` a besoin de la
// **méthode** pour retrouver la route dans le YAML.
func (p *process) post(path, body string) error {
	return p.send(http.MethodPost, path, "application/json", body)
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
// plutôt que `gorillamux`, et ce que ce choix évite est plus étroit que « ajouter `gorilla/mux` au
// graphe de dépendances » : mesuré le 02/08/2026, `gorilla/mux v1.8.0` est **déjà** dans le `go.sum`
// de cette branche, tiré par le graphe de modules de `kin-openapi`
// (`go mod why -m` : `cmd/dashboard.test → openapi3filter.test → routers/gorillamux → gorilla/mux`).
// Ce que `legacy` évite est de le faire entrer dans les `require` de `go.mod` et dans le graphe de
// **compilation** — mesuré, `go list -deps ./cmd/... ./internal/...` n'en rapporte aucune occurrence.
// Le premier rapproche par ailleurs la requête du contrat par son seul chemin
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

	// L'opération n'est portée au registre qu'**ici**, une fois la validation passée — pas au moment où
	// le scénario demande le chemin. Une route qu'un scénario appelle sans confronter sa réponse au
	// contrat reste donc à découvert, ce qui est exactement le défaut que la porte cherche.
	p.visited.Visit(route.Operation.OperationID)

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
