package bddtest

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"testing"

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
func (l *OperationLedger) RequireEveryOperationVisited(t *testing.T, contractPath string) {
	t.Helper()

	l.requireEveryOperationVisited(t, contractPath, runFilter())
}

func (l *OperationLedger) requireEveryOperationVisited(t *testing.T, contractPath, runFilter string) {
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
// Un contrat sans opération est une **erreur** et non une exigence vide : un chemin qui ne pointe
// plus au bon endroit, ou un document que le loader n'a pas su lire, rendrait la liste vide et la
// porte serait verte sans avoir rien exigé.
func DeclaredOperations(contractPath string) ([]string, error) {
	document, err := (&openapi3.Loader{Context: context.Background()}).LoadFromFile(contractPath)
	if err != nil {
		return nil, fmt.Errorf("lecture du contrat %s: %w", contractPath, err)
	}

	var declared []string

	for _, item := range document.Paths.Map() {
		for _, operation := range item.Operations() {
			declared = append(declared, operation.OperationID)
		}
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
