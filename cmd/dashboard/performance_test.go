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
// filet. L'étalon est donc mesuré dans le même run, sur le même serveur et par le **même chemin** :
// `/api/health`, sonde de vivacité qui « ne touche ni la base ni la passerelle »
// (`internal/bff/api.go`). Ce qu'on juge est le **surcoût** — `(session − sonde) / sonde` —, c'est-à-
// dire ce que la route fait en plus du socle : lire la ligne de session, résoudre les rôles, réunir
// leurs permissions.
//
// **Deux rédactions de ce test n'ont rien gardé, et chacune ne s'est vue que par la mutation :**
//
//   - l'étalon a d'abord été `/api/auth/me` **sans cookie** ; le refus traverse le *même* handler,
//     donc un délai posé dans la route gonflait les deux branches ensemble et la mutation restait
//     verte à 1,2. Un étalon pris à l'intérieur de ce qu'il mesure annule ce qu'il devait voir ;
//   - la sonde a ensuite été appelée par un `browser.Get` qui fermait son corps **sans le lire**.
//     `net/http` ne rend alors pas la connexion au pool : la sonde repayait une poignée de main à
//     chaque tour quand la session réutilisait la sienne, et le rapport des temps **totaux** semblait
//     tenir à 15–19 pour un budget de 60. Les deux branches passant par le même chemin, il est tombé
//     à 1,2–1,6, et la mutation a cessé d'être monotone — +3 ms rouge, +5 ms vert. C'est ce qui a fait
//     passer la mesure du temps total au surcoût.
//
// Ce qu'il attrape : un `N+1` sur les permissions, un index perdu, un appel synchrone ajouté au
// chemin. Ce qu'il n'attrape pas : un serveur uniformément ralenti, où les deux branches enflent
// ensemble. C'est le prix du rapport, et il est assumé — le mode d'échec visé est une régression de
// route, pas une machine lente.
func TestUneLectureDeSessionResteDansSonBudget(t *testing.T) {
	world := &loginWorld{process: &process{}}

	require.NoError(t, world.installationWithOneOperator(t.Context()))

	// Armé **avant** le démarrage, comme le hook de fin des scénarios : `startAndServe` lance le
	// process puis attend son adresse, et un échec de cette attente partirait en `FailNow` sur un
	// binaire déjà vivant, qui garderait son port et son pool jusqu'à la fin du paquet. `kill`
	// supporte un process jamais lancé.
	t.Cleanup(world.process.kill)

	require.NoError(t, world.process.startAndServe())

	require.NoError(t, world.signInWithTheRightPassword())
	require.NotEmpty(t, world.process.cookies,
		"sans cookie, la branche mesurée refuserait au lieu de résoudre une session")

	resolved, probe := measureSessionRoute(t, world.process)

	require.NotZero(t, probe, "l'étalon est nul : le rapport ci-dessous ne voudrait rien dire")

	// Le **surcoût** de la route, rapporté au socle — et non son temps total. Les deux branches
	// passant désormais par le même chemin de harnais, le total est dominé par ce que ce chemin coûte
	// (lecture du corps, cookies, allocation) : mesuré, la session tient dans 1,2 à 1,6 fois la sonde,
	// et un délai de cinq millisecondes posé dans le handler n'y déplaçait pas le rapport de façon
	// monotone. Retrancher la sonde isole ce que la route fait **en plus**, et diviser par elle annule
	// la vitesse de la machine.
	overhead := float64(resolved-probe) / float64(probe)

	t.Logf("session résolue %v, sonde %v, surcoût %.2f fois le socle (budget %.2f)",
		resolved, probe, overhead, sessionBudget)

	require.LessOrEqualf(t, overhead, sessionBudget,
		"lire une session coûte %.2f fois le socle en plus de lui, pour un budget de %.2f — "+
			"la route a gagné du travail sur son chemin", overhead, sessionBudget)
}

// sessionBudget est ce que la lecture d'une session peut coûter **en plus du socle**, en multiples de
// celui-ci.
//
// **Mesuré, pas choisi, et la dispersion fait partie de la mesure.** Cinq passages sur ce poste le
// 11/09/2026 : 0,25 · 0,26 · 0,33 · 0,38 · 0,46, pour une session de 1,6 à 3,3 ms et une sonde de 1,2
// à 2,0 ms. Les deux enflent ensemble quand la machine charge, et diviser par la sonde l'annule.
//
// Un et demi laisse trois fois le pire relevé, et ce qu'il attrape a été **mesuré par mutation**
// plutôt que déduit : un délai posé dans le handler donne 0,88 à +1 ms (vert), 1,57 à +2 ms (rouge),
// 2,62 à +5 ms, 4,83 à +10 ms. Le travail propre de la route valant quelque quatre dixièmes de
// milliseconde, le filet mord donc quand elle quadruple — bien avant le facteur dix que step-023
// nomme. Plus serré, il accuserait la machine ; plus large, il ne garderait rien.
const sessionBudget = 1.5

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
		// Les deux branches passent par le **même** chemin, et ce n'est pas une commodité : une revue a
		// montré qu'un `browser.Get` qui ferme son corps sans le lire ne rend pas sa connexion au
		// pool, si bien que la sonde repayait une poignée de main à chaque tour quand la lecture de
		// session réutilisait la sienne. L'étalon gonflait donc, et le budget devenait plus facile à
		// tenir que le commentaire ne le prétendait.
		resolvedSamples = append(resolvedSamples, timeRequest(t, func() error {
			return p.fetch(sessionPath)
		}))

		require.Equal(t, http.StatusOK, p.received.status,
			"la session n'est plus résolue : la branche mesurée n'est pas celle qu'on croit")

		probeSamples = append(probeSamples, timeRequest(t, func() error {
			return p.fetch(probePath)
		}))

		require.Equal(t, http.StatusOK, p.received.status,
			"la sonde ne répond plus : l'étalon mesure autre chose que le socle")
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
