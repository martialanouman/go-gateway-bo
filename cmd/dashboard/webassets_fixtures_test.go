package main

// Le binaire embarque `internal/webassets/dist/` au moment de la compilation, et ce répertoire ne
// contient qu'un `.gitkeep` sur un clone neuf — comme dans le job de CI « Tests Go », qui n'a ni pnpm
// ni pnpm. Ce fichier y met donc en scène une sortie de client minimale avant que le harnais ne
// compile, puis remet en place ce qu'il y a trouvé.
//
// Sans cette mise en scène, les scénarios se tairaient partout où le client n'a jamais été construit :
// ils seraient verts sans rien prouver de la chaîne qu'ils existent pour tenir — embed, `fs.Sub`,
// routeur, binaire lancé. Les assets sont une **entrée** du système sous test, comme le mock Prism
// l'est côté passerelle ; rien n'est simulé dans le produit. Le répertoire est ignoré par git, donc
// la mise en scène ne salit pas l'arbre — et ce qu'un `make build` y aurait déposé est rangé de côté,
// jamais détruit.

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	distDir = "../../internal/webassets/dist"
	// `.gitkeep` est le seul fichier commité du répertoire : `internal/webassets` s'y ancre, et un
	// `dist/` sans lui ne compile plus sur un clone neuf. La purge ne le touche jamais.
	committedKeepFile = ".gitkeep"
)

// stashDir porte un nom stable plutôt qu'un `os.MkdirTemp` : un run interrompu — panic d'un test,
// `-timeout` dépassé, Ctrl-C — saute les `defer` et laisse les vrais assets là. Un chemin fixe les
// rend retrouvables par un humain, et en fait le verrou que `claimStash` prend.
func stashDir() string {
	return filepath.Join(os.TempDir(), "go-gateway-bo-dashboard-assets")
}

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
func stageAssetFixtures() (func() error, error) {
	return stageAssetFixturesIn(distDir, stashDir())
}

// stageAssetFixturesIn porte les deux chemins en paramètres parce que c'est la seule façon d'exercer
// la mise en scène pour de bon : sur des répertoires à elle, un test peut lancer plusieurs suites en
// même temps et regarder ce que les vrais assets deviennent.
func stageAssetFixturesIn(dist, stash string) (func() error, error) {
	if err := claimStash(dist, stash); err != nil {
		return nil, err
	}

	restore := func() error {
		if err := clearStagedAssets(dist); err != nil {
			return err
		}

		if err := copyDistEntries(stash, dist); err != nil {
			return err
		}

		return os.RemoveAll(stash)
	}

	if err := copyDistEntries(dist, stash); err != nil {
		return nil, errors.Join(fmt.Errorf("mise à l'écart des assets existants: %w", err), os.RemoveAll(stash))
	}

	if err := clearStagedAssets(dist); err != nil {
		return nil, errors.Join(err, restore())
	}

	if err := writeAssetFixtures(dist); err != nil {
		return nil, errors.Join(err, restore())
	}

	return restore, nil
}

// claimStash prend la mise à l'écart pour ce process, et c'est son échec qui est la garde. La
// création est atomique — `os.Mkdir`, pas `os.MkdirAll` — donc deux suites lancées en même temps ne
// peuvent pas la prendre toutes les deux. Une garde qui constate l'absence puis rend la main, en
// laissant à une étape ultérieure le soin de créer le répertoire, les laisserait passer toutes les
// deux : la perdante détruirait alors le seul exemplaire des vrais assets.
//
// Les deux situations qui butent ici convergent, et c'est voulu : un run interrompu (panic,
// `-timeout` dépassé, Ctrl-C) saute les `defer` et laisse le répertoire derrière lui, une suite
// concurrente le tient pendant qu'elle travaille. Dans les deux cas, ce process n'a pas la garde des
// vrais assets et n'a rien à faire là.
//
// Corollaire qui vaut pour tout le fichier : rien ne supprime un chemin que ce process n'a pas créé
// lui-même. C'est pour ça que les branches d'erreur de `stageAssetFixturesIn` peuvent, elles,
// nettoyer la mise à l'écart — elles ne s'exécutent qu'après un `claimStash` réussi.
func claimStash(dist, stash string) error {
	switch err := os.Mkdir(stash, 0o755); {
	case err == nil:
		return nil
	case errors.Is(err, fs.ErrExist):
		return refuseClaimedStash(dist, stash)
	default:
		return fmt.Errorf("création de %s: %w", stash, err)
	}
}

// refuseClaimedStash regarde les deux répertoires avant d'en parler, et n'affirme que ce qu'il y a
// lu. Le compte de la mise à l'écart ne décide pas de l'état du répertoire embarqué : sur un clone
// neuf — et dans le job de CI « Tests Go » — la mise à l'écart ne reçoit que `.gitkeep`, donc elle
// paraît vide alors que les fixtures, elles, sont restées dans `dist`. C'est l'état le plus courant
// qu'un run interrompu laisse, et le message l'a affirmé « intact » deux versions durant.
//
// Rien d'autre ne signale l'état où le refus laisse le poste — le répertoire embarqué est ignoré par
// git, donc l'arbre reste propre — et ce message est la seule documentation du chemin : ni le README,
// ni le CLAUDE.md, ni le Makefile n'en disent un mot.
func refuseClaimedStash(dist, stash string) error {
	stashed, err := entriesBesidesKeepFile(stash)
	if err != nil {
		return fmt.Errorf("%s existe déjà et sa lecture échoue: %w", stash, err)
	}

	leftInDist, err := entriesBesidesKeepFile(dist)
	if err != nil {
		return fmt.Errorf("%s existe déjà et la lecture de %s échoue: %w", stash, dist, err)
	}

	return fmt.Errorf(
		"%s existe déjà : soit une autre suite le tient en ce moment, soit un run a été interrompu.\n"+
			"%s\n%s\n"+
			"Attendez la fin de l'autre suite ; s'il n'y en a pas, suivez les deux lignes ci-dessus, "+
			"puis supprimez %s",
		stash, describeStash(stashed, dist), describeDist(leftInDist, dist), stash)
}

// describeStash dit s'il y a quelque chose à remettre dans le répertoire embarqué, et combien.
func describeStash(stashed []string, dist string) string {
	if len(stashed) == 0 {
		return fmt.Sprintf("La mise à l'écart ne garde aucun asset : rien à remettre dans %s.", dist)
	}

	return fmt.Sprintf(
		"La mise à l'écart garde %d entrée(s) (%s) : c'est ce que %s contenait, à y remettre.",
		len(stashed), strings.Join(stashed, ", "), dist)
}

// describeDist dit ce que le répertoire embarqué contient vraiment. Tout ce qui y traîne hors
// `.gitkeep` pendant qu'une mise à l'écart est prise vient d'un harnais : les vrais assets, eux, sont
// dans la mise à l'écart. Les laisser là est le défaut coûteux — la coquille du harnais porte le même
// `<title>` que la vraie, donc un binaire qui l'embarque ne se dénonce pas au premier coup d'œil.
func describeDist(leftInDist []string, dist string) string {
	if len(leftInDist) == 0 {
		return fmt.Sprintf("%s ne contient que %s : il est intact.", dist, committedKeepFile)
	}

	return fmt.Sprintf(
		"%s contient les fixtures du run interrompu (%s), que le prochain `make build-go` embarquerait : "+
			"retirez-les, puis rendez-lui le vrai client avec `make build`, seule cible qui l'y recopie "+
			"(`make build-web` n'écrit que dans web/dist).",
		dist, strings.Join(leftInDist, ", "))
}

func entriesBesidesKeepFile(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	names := make([]string, 0, len(entries))

	for _, entry := range entries {
		if entry.Name() != committedKeepFile {
			names = append(names, entry.Name())
		}
	}

	return names, nil
}

// restoreOrFail rend le code de sortie de la suite une fois la restauration tentée. Une restauration
// ratée laisse les fixtures dans le répertoire embarqué : le dire sur `out` ne suffit pas, `go test`
// jette la sortie d'un paquet vert et le défaut ne se verrait qu'au `make build` suivant.
func restoreOrFail(code int, restore func() error, out io.Writer) int {
	if err := restore(); err != nil {
		fmt.Fprintln(out, "restauration de "+distDir+":", err)

		return 1
	}

	return code
}

func writeAssetFixtures(dist string) error {
	if err := os.MkdirAll(filepath.Join(dist, "assets"), 0o755); err != nil {
		return fmt.Errorf("création de assets/: %w", err)
	}

	fixtures := map[string]string{
		"index.html":  fixtureShell,
		fixtureScript: "export const monte = () => {};\n",
		fixtureStyle:  ":root { color-scheme: dark; }\n",
	}

	for name, contents := range fixtures {
		path := filepath.Join(dist, filepath.FromSlash(name))
		if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
			return fmt.Errorf("écriture de %s: %w", name, err)
		}
	}

	return nil
}

// clearStagedAssets est le seul endroit qui épargne `.gitkeep`, et c'est ce qui le fait survivre à la
// mise en scène. `copyDistEntries` ne l'épargne pas : il le range et le remet comme le reste, sans
// conséquence — le fichier est vide et présent des deux côtés. L'y épargner aussi était une garde
// que rien n'observait.
func clearStagedAssets(dist string) error {
	entries, err := os.ReadDir(dist)
	if err != nil {
		return fmt.Errorf("lecture de %s: %w", dist, err)
	}

	for _, entry := range entries {
		if entry.Name() == committedKeepFile {
			continue
		}

		if err := os.RemoveAll(filepath.Join(dist, entry.Name())); err != nil {
			return fmt.Errorf("retrait de %s: %w", entry.Name(), err)
		}
	}

	return nil
}

// copyDistEntries recopie plutôt qu'il ne déplace : le répertoire de mise à l'écart est un temporaire
// du système, qui n'est pas toujours sur le même système de fichiers que le dépôt — un `os.Rename`
// échouerait là-bas et nulle part ici. Il ne crée pas `dst` : les deux sens de la copie visent un
// répertoire qui existe déjà — celui que `claimStash` vient de prendre, ou le répertoire embarqué,
// qui est commité. Un `os.MkdirAll` ici rendrait la prise contournable.
func copyDistEntries(src, dst string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		return fmt.Errorf("lecture de %s: %w", src, err)
	}

	for _, entry := range entries {
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

// Les deux aides ci-dessous tiennent le même couple de fichiers : ce qu'un `make build` aurait déposé
// dans le répertoire embarqué, et ce qu'on doit y retrouver une fois la mise en scène défaite.
const (
	realShell  = "<!doctype html><title>la vraie coquille</title>"
	realScript = "export const vraiClient = () => {};\n"
	realName   = "index-Zz9Yy8Xx.js"
)

func distWithRealAssets(t *testing.T) string {
	t.Helper()

	dist := filepath.Join(t.TempDir(), "dist")

	require.NoError(t, os.MkdirAll(filepath.Join(dist, "assets"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dist, committedKeepFile), nil, 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(dist, "index.html"), []byte(realShell), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(dist, "assets", realName), []byte(realScript), 0o644))

	return dist
}

func assertRealAssetsAreBack(t *testing.T, dist string) {
	t.Helper()

	shell, err := os.ReadFile(filepath.Join(dist, "index.html"))
	require.NoError(t, err, "la coquille n'est pas revenue : la sortie de Vite est perdue")
	assert.Equal(t, realShell, string(shell), "la coquille de test a remplacé la vraie")

	script, err := os.ReadFile(filepath.Join(dist, "assets", realName))
	require.NoError(t, err, "le script haché n'est pas revenu : la sortie de Vite est perdue")
	assert.Equal(t, realScript, string(script))
}

// La mise en scène tourne avant `m.Run` : ce test observe l'état qu'elle a laissé derrière elle.
func TestStagingSparesTheCommittedKeepFile(t *testing.T) {
	t.Parallel()

	_, err := os.Stat(filepath.Join(distDir, committedKeepFile))

	require.NoError(t, err,
		"la mise en scène a emporté %s : sans lui, `//go:embed all:dist` ne compile plus sur un clone "+
			"neuf, et le fichier étant suivi par git sa disparition salit l'arbre", committedKeepFile)
}

func TestStagingRefusesToRunOverAnInterruptedRun(t *testing.T) {
	t.Parallel()

	stash := filepath.Join(t.TempDir(), "assets")

	require.NoError(t, claimStash(distDir, stash),
		"aucune mise à l'écart ne traîne : le harnais doit démarrer")

	err := claimStash(distDir, stash)

	require.Error(t, err,
		"les restes d'un run interrompu passent inaperçus : le `make build` suivant embarquerait les fixtures")
	assert.Contains(t, err.Error(), stash, "le message doit nommer où retrouver les vrais assets")
}

// Le message de refus est la seule documentation de ce chemin : ni le README, ni le CLAUDE.md, ni le
// Makefile n'en parlent. Ce qu'il dit de faire doit donc être ce qui marche.
func TestTheRefusalNamesTheTargetThatRefillsTheEmbeddedDirectory(t *testing.T) {
	t.Parallel()

	stash := filepath.Join(t.TempDir(), "assets")
	require.NoError(t, claimStash(distDir, stash))
	require.NoError(t, os.WriteFile(filepath.Join(stash, "index.html"), []byte(realShell), 0o644))

	err := claimStash(distDir, stash)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "`make build`",
		"`make build-web` ne fait que `pnpm -C web build` : il écrit dans web/dist et ne touche jamais "+
			"%s. Qui suit cette parenthèse laisse les fixtures en place", distDir)
}

// intactDist reproduit le répertoire embarqué d'un clone neuf — et celui du job de CI « Tests Go » :
// `.gitkeep` et rien d'autre.
func intactDist(t *testing.T) string {
	t.Helper()

	dist := filepath.Join(t.TempDir(), "dist")

	require.NoError(t, os.MkdirAll(dist, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dist, committedKeepFile), nil, 0o644))

	return dist
}

// L'état le plus courant qui soit, et celui dont le message ne disait rien : sur un clone neuf, la
// mise à l'écart ne reçoit que `.gitkeep` — elle est donc vide au sens du compte — pendant que les
// fixtures, elles, restent dans le répertoire embarqué. Décider sur le seul compte de la mise à
// l'écart fait alors dire « intact » d'un répertoire plein, et conseiller la seule suppression de la
// mise à l'écart y laisse les fixtures : le `make build-go` suivant les embarque, et le binaire sert
// une coquille qui porte le même `<title>` que la vraie.
func TestTheRefusalNamesTheFixturesLeftInTheEmbeddedDirectory(t *testing.T) {
	t.Parallel()

	dist := intactDist(t)
	stash := filepath.Join(t.TempDir(), "assets")

	_, err := stageAssetFixturesIn(dist, stash)
	require.NoError(t, err)
	// Pas de restauration : c'est précisément ce que laissent un Ctrl-C, un panic ou un `-timeout`.

	err = claimStash(dist, stash)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "index.html",
		"le message doit nommer ce qu'il trouve dans %s : sans ça, rien ne dit que les fixtures y sont "+
			"restées et que le prochain `make build-go` les embarquerait", dist)
	assert.Contains(t, err.Error(), "`make build`",
		"les fixtures sont dans %s : la seule cible qui y remet le vrai client est `make build`. Sans "+
			"elle, on supprime la mise à l'écart et on croit le poste réparé", dist)
	assert.NotContains(t, err.Error(), "intact",
		"%s est plein des fixtures du run interrompu : le dire intact est faux", dist)
}

// Le message affirmait « le stash garde les vrais assets » sans jamais l'avoir regardé. Deux fois sur
// trois c'est faux : un run interrompu entre la création de la mise à l'écart et la purge la laisse
// vide, et sur un poste où `make build` n'a jamais tourné il n'y a aucun vrai asset à sauver.
func TestTheRefusalDescribesTheStashItActuallyFound(t *testing.T) {
	t.Parallel()

	t.Run("elle garde des assets : le message les compte", func(t *testing.T) {
		t.Parallel()

		dist := intactDist(t)
		stash := filepath.Join(t.TempDir(), "assets")
		require.NoError(t, claimStash(dist, stash))
		require.NoError(t, os.WriteFile(filepath.Join(stash, "index.html"), []byte(realShell), 0o644))
		require.NoError(t, os.Mkdir(filepath.Join(stash, "assets"), 0o755))

		err := claimStash(dist, stash)

		require.Error(t, err)
		assert.Contains(t, err.Error(), "2 entrée(s)",
			"le message doit dire ce qu'il a trouvé : c'est ce qui distingue « il y a quelque chose à "+
				"remettre » de « il n'y a rien à sauver »")
	})

	t.Run("elle est vide : le message ne promet aucun asset", func(t *testing.T) {
		t.Parallel()

		dist := intactDist(t)
		stash := filepath.Join(t.TempDir(), "assets")
		require.NoError(t, claimStash(dist, stash))

		err := claimStash(dist, stash)

		require.Error(t, err)
		assert.Contains(t, err.Error(), "aucun asset",
			"une mise à l'écart vide ne garde rien : promettre les vrais assets envoie chercher ce qui "+
				"n'existe pas")
		assert.NotContains(t, err.Error(), "`make build`",
			"%s a été lu et ne contient que %s : conseiller de le reconstruire envoie effacer un "+
				"répertoire déjà en état", dist, committedKeepFile)
	})
}

// Deux suites peuvent viser la même mise à l'écart en même temps : un IDE qui lance le paquet pendant
// un `make check`, ou deux clones du dépôt, qui partagent `$TMPDIR`. Une seule doit passer. Celles qui
// refusent ne touchent à rien : la mise à l'écart de l'autre est le **seul** exemplaire des vrais
// assets — le répertoire embarqué est ignoré par git, donc aucun `git checkout` ne les ramènerait.
func TestConcurrentStagingLeavesTheRealAssetsRecoverable(t *testing.T) {
	t.Parallel()

	dist := distWithRealAssets(t)
	stash := filepath.Join(t.TempDir(), "assets")

	const contenders = 8

	var (
		released sync.WaitGroup
		finished sync.WaitGroup
		mu       sync.Mutex
		restores []func() error
	)

	released.Add(1)
	finished.Add(contenders)

	for range contenders {
		go func() {
			defer finished.Done()

			released.Wait()

			restore, err := stageAssetFixturesIn(dist, stash)

			mu.Lock()
			defer mu.Unlock()

			if err == nil {
				restores = append(restores, restore)
			}
		}()
	}

	released.Done()
	finished.Wait()

	require.Len(t, restores, 1,
		"%d suites ont pris la même mise à l'écart : celles qui perdent la course en supprimeront le "+
			"contenu, et les vrais assets de la gagnante seront perdus", len(restores))
	require.NoError(t, restores[0]())

	assertRealAssetsAreBack(t, dist)
}

func TestFailedRestorationFailsTheSuite(t *testing.T) {
	t.Parallel()

	code := restoreOrFail(0, func() error { return errors.New("le répertoire est verrouillé") }, io.Discard)

	assert.NotZero(t, code,
		"une restauration ratée laisse les fixtures dans l'arbre de travail sans que le code de sortie le dise")
}

func TestSuccessfulRestorationKeepsTheVerdictOfTheSuite(t *testing.T) {
	t.Parallel()

	assert.Equal(t, 3, restoreOrFail(3, func() error { return nil }, io.Discard),
		"la restauration ne décide pas du verdict des tests : réussie, elle le laisse passer intact")
}
