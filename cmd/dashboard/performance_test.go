package main

import (
	"cmp"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// Ce que ce test garde, et que **rien ne gardait à aucune valeur du délai** : qu'une route de lecture
// ne devienne pas dix fois plus lente. step-023 l'écrit en le portant de 2 s à 15 s — « une régression
// qui rendrait une route dix fois plus lente ne rougirait plus ici. Rien ne la garderait par ailleurs,
// et c'était déjà vrai à deux secondes ». Le délai du client est une borne anti-suspension ; le voici,
// le filet qui manquait.
//
// **Un budget relatif, pas un seuil en millisecondes.** Un seuil absolu sur un runner partagé rougit
// au hasard, et une suite qui rougit au hasard cesse d'être lue — ce qui est pire que l'absence de
// filet. L'étalon est donc mesuré dans le même run, sur le même serveur : `/api/health`, sonde de
// vivacité qui « ne touche ni la base ni la passerelle » (`internal/bff/api.go`). Il mesure le socle
// — la boucle HTTP, le routage, la machine — et le rapport ne garde que ce que la lecture de session
// ajoute par-dessus : la ligne en base, les rôles, l'union de leurs permissions.
//
// **Le premier étalon écrit ici était `/api/auth/me` sans cookie, et il ne gardait rien** : le refus
// traverse le *même* handler, donc un délai posé dans la route gonflait les deux branches ensemble.
// La mutation restait verte à 1,2 quand elle aurait dû rougir — un étalon pris à l'intérieur de ce
// qu'il mesure annule exactement ce qu'il devait voir.
//
// Ce qu'il attrape : un `N+1` sur les permissions, un index perdu, un appel synchrone ajouté au
// chemin. Ce qu'il n'attrape pas : un serveur uniformément ralenti, où les deux branches enflent
// ensemble. C'est le prix du rapport, et il est assumé — le mode d'échec visé est une régression de
// route, pas une machine lente.
func TestUneLectureDeSessionResteDansSonBudget(t *testing.T) {
	world := &loginWorld{process: &process{}}

	require.NoError(t, world.installationWithOneOperator(t.Context()))
	require.NoError(t, world.process.startAndServe())

	t.Cleanup(world.process.kill)

	require.NoError(t, world.signInWithTheRightPassword())
	require.NotEmpty(t, world.process.cookies,
		"sans cookie, la branche mesurée refuserait au lieu de résoudre une session")

	resolved, probe := measureSessionRoute(t, world.process)

	require.NotZero(t, probe, "l'étalon est nul : le rapport ci-dessous ne voudrait rien dire")

	ratio := float64(resolved) / float64(probe)

	t.Logf("session résolue %v, sonde %v, rapport %.1f (budget %.0f)",
		resolved, probe, ratio, sessionBudget)

	require.LessOrEqualf(t, ratio, sessionBudget,
		"lire une session coûte %.1f fois la sonde de vivacité, pour un budget de %.0f — "+
			"la route a gagné du travail sur son chemin", ratio, sessionBudget)
}

// sessionBudget est ce que la lecture d'une session peut coûter, en multiples de la sonde.
//
// **Mesuré, pas choisi, et la dispersion fait partie de la mesure.** Cinq passages sur ce poste :
// 15,5 · 16,2 · 17,3 · 17,5 · 19,4, pour une session résolue de 2,6 à 4,3 ms et une sonde de 170 à
// 264 µs. Les deux enflent ensemble quand la machine charge — c'est précisément ce que le rapport
// annule, et ce qui le tient dans un intervalle d'un quart là où le premier étalon variait du simple
// au double.
//
// Soixante laisse trois fois le pire relevé, et ce que ce chiffre attrape a été **mesuré par
// mutation** plutôt que déduit : un délai posé dans le handler donne 39,7 à +5 ms (vert), 66,3 à
// +10 ms (rouge), 86,9 à +30 ms (rouge). Sur une route qui coûte trois millisecondes, le filet mord
// donc à partir d'un facteur trois — bien avant le facteur dix que step-023 nomme, et sans rougir
// sur la charge d'un runner partagé. Plus serré, il accuserait la machine ; plus large, il ne
// garderait rien.
const sessionBudget = 60.0

// measureSessionRoute rend les durées médianes de la lecture de session et de la sonde de vivacité.
//
// **Médiane et non moyenne** : sur un runner partagé, un seul pic d'ordonnancement déplace une
// moyenne de plusieurs fois sa valeur, quand la médiane l'ignore.
//
// **Alternées et non l'une après l'autre** : une machine qui ralentit pendant la mesure décalerait
// les deux séries l'une par rapport à l'autre, et le rapport accuserait le produit d'une dérive qui
// ne lui appartient pas.
func measureSessionRoute(t *testing.T, p *process) (resolved, probe time.Duration) {
	t.Helper()

	// Un échauffement : le premier appel paie l'ouverture des connexions du pool, et il fausserait
	// autant la médiane que la route qu'on mesure.
	require.NoError(t, p.fetch(sessionPath))

	resolvedSamples := make([]time.Duration, 0, performanceSamples)
	probeSamples := make([]time.Duration, 0, performanceSamples)

	for range performanceSamples {
		resolvedSamples = append(resolvedSamples, timeRequest(t, func() error {
			if err := p.fetch(sessionPath); err != nil {
				return err
			}

			require.Equal(t, http.StatusOK, p.received.status,
				"la session n'est plus résolue : la branche mesurée n'est pas celle qu'on croit")

			return nil
		}))

		probeSamples = append(probeSamples, timeRequest(t, func() error {
			response, err := browser.Get(p.url(probePath))
			if err != nil {
				return err
			}

			defer func() { _ = response.Body.Close() }()

			require.Equal(t, http.StatusOK, response.StatusCode,
				"la sonde ne répond plus : l'étalon mesure autre chose que le socle")

			return nil
		}))
	}

	return median(resolvedSamples), median(probeSamples)
}

const (
	sessionPath        = "/api/auth/me"
	probePath          = "/api/health"
	performanceSamples = 21
)

func timeRequest(t *testing.T, call func() error) time.Duration {
	t.Helper()

	started := time.Now()
	err := call()
	elapsed := time.Since(started)

	require.NoError(t, err)

	return elapsed
}

func median(samples []time.Duration) time.Duration {
	slices.SortFunc(samples, cmp.Compare)

	return samples[len(samples)/2]
}
