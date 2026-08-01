package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
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
	dir, err := os.MkdirTemp("", "dashboard-bin")
	if err != nil {
		fmt.Fprintln(os.Stderr, "répertoire temporaire:", err)
		os.Exit(1)
	}

	dashboardBinary = filepath.Join(dir, "dashboard")
	build := exec.Command("go", "build", "-o", dashboardBinary, ".")
	build.Stderr = os.Stderr
	if err := build.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "compilation du binaire:", err)
		os.RemoveAll(dir)
		os.Exit(1)
	}

	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
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
	ctx.Then(`^le serveur refuse de démarrer$`, p.refusesToStart)
	ctx.Then(`^le message d'erreur nomme "([^"]*)"$`, p.messageNames)
	ctx.Then(`^le serveur s'arrête sans erreur$`, p.exitsCleanly)

	ctx.After(func(ctx context.Context, _ *godog.Scenario, err error) (context.Context, error) {
		p.kill()

		return ctx, err
	})
}

// Toute attente du harnais est bornée. Sans limite, un serveur qui ne répond pas devient un test qui
// ne finit pas, et le hook de fin — celui qui tue l'enfant — n'est alors jamais atteint.
var probe = &http.Client{Timeout: 2 * time.Second}

// completeConfiguration est le plus petit environnement avec lequel le binaire démarre. Le port 0
// laisse le système en choisir un libre.
func completeConfiguration() map[string]string {
	return map[string]string{
		"DASHBOARD_ADDR": "127.0.0.1:0",
	}
}

type process struct {
	env    map[string]string
	cmd    *exec.Cmd
	output *syncBuffer
	exited chan error
	addr   string
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

	resp, err := probe.Get(p.healthURL())
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

func (p *process) healthURL() string {
	return "http://" + p.addr + "/api/health"
}

func (p *process) refusesToStart() error {
	select {
	case err := <-p.exited:
		var exit *exec.ExitError
		if !errors.As(err, &exit) {
			return fmt.Errorf("le process s'est arrêté sans erreur, il aurait dû refuser: %w", err)
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
