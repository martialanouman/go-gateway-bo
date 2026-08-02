package gateway

import (
	"io"
	"math/rand/v2"
	"net/http"
	"time"
)

// Le délai est bref parce qu'un opérateur attend devant l'écran, et le jitter existe parce que
// plusieurs instances du tableau de bord rejouent sinon à la même milliseconde.
const (
	replayDelay  = 100 * time.Millisecond
	replayJitter = 100 * time.Millisecond
)

// replayReadsOnce rejoue une lecture perdue en chemin, une fois. Le tableau de bord est un
// observateur (invariant e) : un observateur qui martèle une passerelle dégradée devient un
// amplificateur d'incident, et transforme une panne de visualisation en panne du plan de données.
type replayReadsOnce struct{ base http.RoundTripper }

func (t replayReadsOnce) RoundTrip(req *http.Request) (*http.Response, error) {
	response, err := t.base.RoundTrip(req)
	if !worthReplaying(req.Method, response, err) {
		return response, err
	}

	discard(response)

	// Une seconde tentative, jamais une troisième : la boucle est écrite à plat pour qu'aucun
	// réglage ne puisse un jour en faire une boucle.
	waitBeforeReplay(req)

	return t.base.RoundTrip(req)
}

// worthReplaying tient les quatre refus de DN-6 en un endroit. Le seul état de la requête qu'il
// consulte est sa méthode, et le corps n'entre pas dans la décision : un corps déjà consommé serait
// rejoué vide, mais aucune lecture n'en porte. Compté sur le client engendré le 01/08/2026 : ses 47
// constructeurs de GET passent tous `nil` en corps, et le contrat ne déclare **aucune** opération
// HEAD — les corps ne servent que POST, PATCH et DELETE, que ce filtre écarte de toute façon.
//
// Le cas HEAD n'est donc atteignable par aucun appel du client engendré : il est écrit parce que la
// règle porte sur les lectures et non sur une liste d'opérations, et aucun test ne rougirait s'il
// disparaissait — vérifié.
func worthReplaying(method string, response *http.Response, err error) bool {
	// Jamais un POST, un PATCH ni un DELETE, même idempotents au sens de la RFC : une mutation est
	// déclenchée par un opérateur présent à l'écran, et un rejeu automatique lui masque le conflit
	// — y compris le cas réseau ambigu, où la mutation a peut-être déjà été appliquée.
	//
	// Cette garde passe **avant** celle de l'erreur réseau, et l'ordre est le fond : intervertir les
	// deux rejoue les mutations dont la connexion est tombée, c'est-à-dire suspend deux fois un
	// client. C'est ce que tient TestAdminClientNeverReplaysAMutationWhoseConnectionDropped.
	if method != http.MethodGet && method != http.MethodHead {
		return false
	}

	// La connexion est tombée avant toute réponse : c'est l'accident de chemin par excellence, celui
	// d'une instance retirée du load balancer pendant un déploiement roulant.
	if err != nil {
		return true
	}

	// 429 est la passerelle qui demande explicitement de reculer, et 503 dit de réessayer « quand
	// elle se rétablit » — ce que constate l'opérateur par l'état d'erreur et son bouton Réessayer,
	// pas une boucle automatique. Ni l'un ni l'autre n'est ici : seuls le sont les deux statuts
	// qu'émet un intermédiaire quand il n'a pas pu joindre la passerelle.
	return response.StatusCode == http.StatusBadGateway ||
		response.StatusCode == http.StatusGatewayTimeout
}

// discard rend la connexion au pool plutôt que de la laisser tomber : c'est la réponse dont on ne
// veut plus, pas la connexion.
//
// Rien ne rougit si cette fonction disparaît — vérifié en la supprimant le 01/08/2026 : la suite
// reste verte et `bodyclose` ne voit pas la réponse d'un RoundTripper. Ce qu'elle empêche ne
// s'observe pas dans un test mais sous charge, où une connexion abandonnée par rejeu est une
// connexion de moins vers la passerelle à chaque 502. La tester demanderait de compter les
// connexions ouvertes du côté serveur, ce qui mesurerait le pool de net/http plus que ce code.
func discard(response *http.Response) {
	if response == nil {
		return
	}

	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()
}

// waitBeforeReplay rend la main immédiatement si l'appelant a renoncé : la tentative suivante
// échouera alors sur le contexte, sans requête sur le réseau.
func waitBeforeReplay(req *http.Request) {
	//nolint:gosec // G404 : ce jitter désynchronise deux instances, il ne protège rien.
	timer := time.NewTimer(replayDelay + rand.N(replayJitter))
	defer timer.Stop()

	select {
	case <-req.Context().Done():
	case <-timer.C:
	}
}
