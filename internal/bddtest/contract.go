package bddtest

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/getkin/kin-openapi/openapi3"
)

// OperationLedger note les opérations du contrat qu'un scénario a **validées**, et refuse qu'une
// opération déclarée n'ait été validée par aucun.
//
// Ce qu'il ferme est un trou nommé par step-004 et laissé ouvert faute d'être falsifiable sur une
// seule route : le mode strict d'`oapi-codegen` retire le `ResponseWriter` de la signature du
// *handler*, mais pas de celle du *type de réponse*. Un type de réponse **sans champ** dont le
// `Visit…` écrit ce qu'il veut sur le fil compile, satisfait l'interface, et traverse les portes
// structurelles de `internal/bff` — mesuré le 02/08/2026. Ce qui l'attrape est le scénario qui
// confronte la réponse servie au YAML, et lui seul. La convention « DTO de sortie déclaré » n'est
// donc pas auto-portante, et l'oubli d'un scénario était silencieux.
//
// D'où le choix de ce qui compte comme visite : une opération est visitée quand un scénario a
// **validé** sa réponse contre le contrat, jamais quand il en a seulement demandé le chemin. Compter
// les chemins demandés rendrait la porte verte pour une route appelée sans être vérifiée —
// c'est-à-dire pour le défaut lui-même.
type OperationLedger struct {
	mu      sync.Mutex
	visited map[string]bool
}

// Visit enregistre l'opération que le contrat destine à la requête qu'un scénario vient de valider.
func (l *OperationLedger) Visit(operationID string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.visited == nil {
		l.visited = make(map[string]bool)
	}

	l.visited[operationID] = true
}

// RequireEveryOperationVisited est ce qu'une suite appelle après `suite.Run()`.
func (l *OperationLedger) RequireEveryOperationVisited(t testingTB, contractPath string) {
	t.Helper()

	l.requireEveryOperationVisited(t, contractPath, runFilter())
}

func (l *OperationLedger) requireEveryOperationVisited(t testingTB, contractPath, runFilter string) {
	t.Helper()

	if filtersScenarios(runFilter) {
		t.Logf("couverture du contrat non vérifiée : `-run %s` ne demande qu'une partie des scénarios, "+
			"donc presque aucune opération n'est visitée. Cette porte ne mord qu'une suite lancée en "+
			"entier", runFilter)

		return
	}

	declared, err := DeclaredOperations(contractPath)
	if err != nil {
		t.Fatal(err)
	}

	for _, unvisited := range l.unvisited(declared) {
		t.Error(unvisited)
	}
}

func (l *OperationLedger) unvisited(declared []string) []string {
	l.mu.Lock()
	defer l.mu.Unlock()

	var unvisited []string

	for _, operationID := range declared {
		if !l.visited[operationID] {
			unvisited = append(unvisited, fmt.Sprintf(
				"l'opération %q est déclarée au contrat et aucun scénario ne valide sa réponse contre "+
					"lui : rien n'empêche qu'elle serve autre chose que ce qu'elle annonce — lui écrire "+
					"un scénario", operationID))
		}
	}

	return unvisited
}

// DeclaredOperations nomme les opérations que le contrat déclare, lues dans le document lui-même
// plutôt que dans le code engendré : le code engendré dirait ce que la génération a compris, et
// c'est justement l'écart qu'on cherche.
//
// Deux refus plutôt qu'une exigence vide ou faussement satisfaite.
//
// Un contrat **sans opération** vient d'un YAML valide dépourvu de `paths` — un chemin qui ne pointe
// plus au bon endroit et un document illisible sont, eux, rendus par la branche d'erreur ci-dessus,
// mesuré sur `kin-openapi@v0.144.0`. La liste vide rendrait la porte verte sans avoir rien exigé.
//
// Une opération **sans `operationId`** est légale : le champ est facultatif, et `oapi-codegen` en
// synthétise un, donc rien en amont ne l'attrape. Empilées telles quelles, deux d'entre elles
// entreraient sous la même clé `""` dans le registre des visites, et valider l'une marquerait
// l'autre visitée — la porte serait verte sur une route sans scénario.
func DeclaredOperations(contractPath string) ([]string, error) {
	document, err := (&openapi3.Loader{Context: context.Background()}).LoadFromFile(contractPath)
	if err != nil {
		return nil, fmt.Errorf("lecture du contrat %s: %w", contractPath, err)
	}

	var declared, unnamed []string

	for path, item := range document.Paths.Map() {
		for method, operation := range item.Operations() {
			if operation.OperationID == "" {
				unnamed = append(unnamed, method+" "+path)

				continue
			}

			declared = append(declared, operation.OperationID)
		}
	}

	// Toutes, et triées : s'arrêter à la première ferait corriger une route, relancer, en découvrir
	// une autre — et l'ordre de `Paths.Map()` n'étant aucun, deux exécutions n'en nommeraient pas la
	// même. C'est la norme que la fin de cette fonction pose pour ce qu'elle rend.
	if len(unnamed) > 0 {
		sort.Strings(unnamed)

		return nil, fmt.Errorf("%s déclare %s sans operationId : la couverture du contrat nomme les "+
			"opérations, et celles qui n'ont pas de nom se confondraient — leur en donner un",
			contractPath, strings.Join(unnamed, ", "))
	}

	if len(declared) == 0 {
		return nil, fmt.Errorf("%s ne déclare aucune opération : le chemin ou le document a changé, et "+
			"la couverture du contrat n'exigerait plus rien", contractPath)
	}

	// L'ordre de `Paths.Map()` est celui d'une map Go, donc aucun : trié, ce que la porte reproche
	// reste comparable d'une exécution à l'autre.
	sort.Strings(declared)

	return declared, nil
}
