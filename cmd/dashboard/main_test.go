package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
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
)

// Les scénarios exercent le binaire livré, pas une fonction appelée en bibliothèque : ce qui est
// décrit ici est le comportement d'un process — il démarre, il refuse, il s'arrête sur un signal.
var dashboardBinary string

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

// runTests existe pour que tout ce qui est posé avant les scénarios soit défait par un `defer` : le
// répertoire embarqué appartient à l'arbre de travail, et `os.Exit` n'en déroule aucun.
func runTests(m *testing.M) int {
	restoreAssets, err := stageAssetFixtures()
	if err != nil {
		fmt.Fprintln(os.Stderr, "mise en scène des assets:", err)

		return 1
	}
	defer func() {
		if err := restoreAssets(); err != nil {
			fmt.Fprintln(os.Stderr, "restauration de "+distDir+":", err)
		}
	}()

	dir, err := os.MkdirTemp("", "dashboard-bin")
	if err != nil {
		fmt.Fprintln(os.Stderr, "répertoire temporaire:", err)

		return 1
	}
	defer os.RemoveAll(dir)

	dashboardBinary = filepath.Join(dir, "dashboard")
	build := exec.Command("go", "build", "-o", dashboardBinary, ".")
	build.Stderr = os.Stderr
	if err := build.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "compilation du binaire:", err)

		return 1
	}

	return m.Run()
}

const (
	distDir = "../../internal/webassets/dist"
	// `.gitkeep` est le seul fichier commité du répertoire : `internal/webassets` s'y ancre, et un
	// `dist/` sans lui ne compile plus sur un clone neuf. La mise en scène ne le touche jamais.
	committedKeepFile = ".gitkeep"
)

// Les noms reproduisent la sortie réelle de Vite — la coquille à la racine, les fichiers hachés sous
// `assets/` et référencés en absolu depuis elle — parce que c'est cette forme-là que le routeur
// distingue, et que le scénario suit la référence au lieu de coder un nom en dur.
const (
	fixtureScript = "assets/index-Aa1Bb2Cc.js"
	fixtureStyle  = "assets/index-Dd3Ee4Ff.css"
)

const fixtureShell = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <title>Tableau de bord — Passerelle SMS</title>
    <script type="module" crossorigin src="/` + fixtureScript + `"></script>
    <link rel="stylesheet" crossorigin href="/` + fixtureStyle + `">
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`

// stageAssetFixtures pose une sortie de client minimale dans le répertoire qu'`internal/webassets`
// embarque, et rend de quoi remettre en place ce qui s'y trouvait.
//
// Sans elle, les scénarios se tairaient partout où le client n'a jamais été construit — un clone
// neuf, le job de CI qui n'a ni Node ni pnpm — donc ils seraient verts sans rien prouver de la
// chaîne qu'ils existent pour tenir : embed, `fs.Sub`, routeur, binaire lancé. Les assets sont une
// entrée du système sous test, comme le mock Prism l'est côté passerelle ; rien n'est simulé dans le
// produit. Le répertoire est ignoré par git, donc la mise en scène ne salit pas l'arbre — et ce
// qu'un `make build` y aurait déjà déposé est rangé de côté, jamais détruit.
func stageAssetFixtures() (func() error, error) {
	stash, err := os.MkdirTemp("", "dashboard-assets")
	if err != nil {
		return nil, fmt.Errorf("répertoire de mise à l'écart: %w", err)
	}

	restore := func() error {
		if err := clearStagedAssets(); err != nil {
			return err
		}

		if err := copyDistEntries(stash, distDir); err != nil {
			return err
		}

		return os.RemoveAll(stash)
	}

	if err := copyDistEntries(distDir, stash); err != nil {
		return nil, errors.Join(fmt.Errorf("mise à l'écart des assets existants: %w", err), os.RemoveAll(stash))
	}

	if err := clearStagedAssets(); err != nil {
		return nil, errors.Join(err, restore())
	}

	if err := writeAssetFixtures(); err != nil {
		return nil, errors.Join(err, restore())
	}

	return restore, nil
}

func writeAssetFixtures() error {
	if err := os.MkdirAll(filepath.Join(distDir, "assets"), 0o755); err != nil {
		return fmt.Errorf("création de assets/: %w", err)
	}

	fixtures := map[string]string{
		"index.html":  fixtureShell,
		fixtureScript: "export const monte = () => {};\n",
		fixtureStyle:  ":root { color-scheme: dark; }\n",
	}

	for name, contents := range fixtures {
		path := filepath.Join(distDir, filepath.FromSlash(name))
		if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
			return fmt.Errorf("écriture de %s: %w", name, err)
		}
	}

	return nil
}

func clearStagedAssets() error {
	entries, err := os.ReadDir(distDir)
	if err != nil {
		return fmt.Errorf("lecture de %s: %w", distDir, err)
	}

	for _, entry := range entries {
		if entry.Name() == committedKeepFile {
			continue
		}

		if err := os.RemoveAll(filepath.Join(distDir, entry.Name())); err != nil {
			return fmt.Errorf("retrait de %s: %w", entry.Name(), err)
		}
	}

	return nil
}

// copyDistEntries recopie plutôt qu'il ne déplace : le répertoire de mise à l'écart est un temporaire
// du système, qui n'est pas toujours sur le même système de fichiers que le dépôt — un `os.Rename`
// échouerait là-bas et nulle part ici.
func copyDistEntries(src, dst string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		return fmt.Errorf("lecture de %s: %w", src, err)
	}

	if err := os.MkdirAll(dst, 0o755); err != nil {
		return fmt.Errorf("création de %s: %w", dst, err)
	}

	for _, entry := range entries {
		if entry.Name() == committedKeepFile {
			continue
		}

		from, to := filepath.Join(src, entry.Name()), filepath.Join(dst, entry.Name())

		if entry.IsDir() {
			if err := os.CopyFS(to, os.DirFS(from)); err != nil {
				return fmt.Errorf("copie de %s: %w", entry.Name(), err)
			}

			continue
		}

		contents, err := os.ReadFile(from)
		if err != nil {
			return fmt.Errorf("lecture de %s: %w", entry.Name(), err)
		}

		if err := os.WriteFile(to, contents, 0o644); err != nil {
			return fmt.Errorf("copie de %s: %w", entry.Name(), err)
		}
	}

	return nil
}

func TestScenarios(t *testing.T) {
	suite := godog.TestSuite{
		Name:                "dashboard",
		ScenarioInitializer: initializeScenario,
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
}

func initializeScenario(ctx *godog.ScenarioContext) {
	p := &process{}

	ctx.Given(`^une configuration complète dont on retire "([^"]*)"$`, p.configurationWithout)
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

	ctx.After(func(ctx context.Context, _ *godog.Scenario, err error) (context.Context, error) {
		p.kill()

		return ctx, err
	})
}

// Toute attente du harnais est bornée. Sans limite, un serveur qui ne répond pas devient un test qui
// ne finit pas, et le hook de fin — celui qui tue l'enfant — n'est alors jamais atteint. Le hook a
// lui aussi sa borne : au-delà, il rend la main sans avoir constaté la mort de l'enfant, ce qui vaut
// mieux qu'un scénario suspendu, mais reste un abandon.
var probe = &http.Client{Timeout: 2 * time.Second}

// completeConfiguration est le plus petit environnement avec lequel le binaire démarre. Le port 0
// laisse le système en choisir un libre.
func completeConfiguration() map[string]string {
	return map[string]string{
		"DASHBOARD_ADDR": "127.0.0.1:0",
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
type response struct {
	status int
	header http.Header
	body   string
}

func (p *process) configurationWithout(name string) error {
	p.env = completeConfiguration()
	if _, ok := p.env[name]; !ok {
		return fmt.Errorf("%q n'appartient pas à la configuration complète du scénario", name)
	}
	delete(p.env, name)

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

	resp, err := probe.Get(p.url("/api/health"))
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
	resp, err := probe.Get(p.url(path))
	if err != nil {
		return fmt.Errorf("la requête vers %s a échoué: %w", path, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("lecture de la réponse de %s: %w", path, err)
	}

	p.received = &response{status: resp.StatusCode, header: resp.Header, body: string(body)}

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
