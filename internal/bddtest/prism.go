package bddtest

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

const (
	PrismBinary   = "web/node_modules/.bin/prism"
	AdminContract = "web/node_modules/@martialanouman/gateway-api-contracts/openapi-admin.yaml"
)

// envMockBaseURL signale un mock déjà lancé — c'est ce que `make mock` affiche. Le harnais s'y
// raccorde au lieu d'en démarrer un second : une boucle locale ne repaie alors pas le démarrage à
// chaque lancement de la suite.
const envMockBaseURL = "PRISM_MOCK_BASE_URL"

// prismStartup est large parce qu'elle vise un démarrage parti en vrille, pas une machine lente :
// mesuré à ~1,0 s ici, et le runner de CI paie en plus le premier chargement de Node.
const prismStartup = 30 * time.Second

// AdminMock rend l'URL du mock que les scénarios interrogent : celui qu'on nous signale, ou le nôtre.
func AdminMock(t *testing.T) string {
	t.Helper()

	//nolint:forbidigo // Ce n'est pas une configuration du produit mais le signalement d'un mock déjà
	// lancé par `make mock`, qui n'existe que pour le harnais. L'exemption est nommée ici plutôt que
	// posée sur le fichier, qui laisserait un test lire la vraie configuration depuis l'environnement.
	if signaled := os.Getenv(envMockBaseURL); signaled != "" {
		t.Logf("mock déjà lancé, réutilisé : %s (%s)", signaled, envMockBaseURL)

		return signaled
	}

	return StartPrism(t).BaseURL
}

// PrismMock est un mock lancé par le harnais : son URL, et les routes qu'il a annoncées au démarrage.
type PrismMock struct {
	BaseURL string
	Routes  []AnnouncedRoute
}

// AnnouncedRoute est une opération que Prism dit servir. Il en imprime une ligne par opération du
// document au démarrage, l'URL portant déjà les exemples de ses paramètres de chemin.
type AnnouncedRoute struct {
	Method string
	URL    string
}

func (r AnnouncedRoute) String() string {
	return r.Method + " " + r.URL
}

// StartPrism lance un mock sur un port libre et rend la main quand il écoute.
//
// Le port est **choisi par le système** (`--port 0`, l'adresse effective se lit dans le journal de
// démarrage) et non fixé : le port 4010 de `make mock` est souvent déjà pris sur le poste, et Prism
// n'échoue pas discrètement dans ce cas — il imprime son mode d'emploi entier suivi d'un
// `listen EADDRINUSE`, ce qui donne un rouge que personne ne relie à un port occupé.
func StartPrism(t *testing.T) *PrismMock {
	t.Helper()

	root := RepositoryRoot(t)
	binary := filepath.Join(root, PrismBinary)
	contract := filepath.Join(root, AdminContract)

	for _, required := range []string{binary, contract} {
		_, err := os.Stat(required)
		require.NoErrorf(t, err, "%s est absent — le mock et le contrat viennent de GitHub Packages : "+
			"pnpm -C web install", required)
	}

	output := &SyncBuffer{}
	//nolint:gosec // G204 : le binaire et le contrat sont deux chemins fixes du dépôt.
	prism := exec.Command(binary, "mock", "--port", "0", "--host", "127.0.0.1", contract)
	// Un environnement construit de zéro : un `FORCE_COLOR` hérité du shell faisait colorer ses
	// annonces à Prism, et les regex qui les lisent ne trouvaient plus aucune route.
	//nolint:forbidigo // PATH n'est pas une configuration du produit : il sert à trouver `node`.
	prism.Env = []string{"PATH=" + os.Getenv("PATH")}
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

func awaitPrism(output *SyncBuffer, within time.Duration) (*PrismMock, error) {
	deadline := time.Now().Add(within)

	for time.Now().Before(deadline) {
		printed := output.String()

		if listening := prismListening.FindStringSubmatch(printed); listening != nil {
			return &PrismMock{BaseURL: listening[1], Routes: announcedRoutes(printed)}, nil
		}

		time.Sleep(20 * time.Millisecond)
	}

	return nil, fmt.Errorf("le mock Prism n'a pas annoncé son écoute en %s :\n%s", within, output.String())
}

func announcedRoutes(printed string) []AnnouncedRoute {
	var routes []AnnouncedRoute

	for _, announcement := range prismRouteAnnouncement.FindAllStringSubmatch(printed, -1) {
		routes = append(routes, AnnouncedRoute{Method: announcement[1], URL: announcement[2]})
	}

	return routes
}
