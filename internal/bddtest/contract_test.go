package bddtest

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// deuxOperations est un contrat minimal, pas une copie de celui du produit : la porte de
// `internal/gateway` juge une copie au nombre de signatures qu'un fichier partage avec les contrats
// de la passerelle, et deux opérations inventées n'en partagent aucune.
const deuxOperations = `openapi: 3.1.0
info: { title: contrat de test, version: 0.0.0 }
servers: [{ url: /api }]
paths:
  /premiere:
    get:
      operationId: premiere
      responses: { '200': { description: ok } }
  /seconde:
    post:
      operationId: seconde
      responses: { '201': { description: créé } }
`

func TestDeclaredOperationsReadsTheContractAndNotTheCode(t *testing.T) {
	t.Parallel()

	declared, err := DeclaredOperations(contractFile(t, deuxOperations))

	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"premiere", "seconde"}, declared)
}

// Un contrat sans opération rendrait une exigence vide, donc verte : la porte serait retirée par un
// chemin qui ne pointe plus au bon endroit, ou par un document que le loader n'a pas su lire.
func TestAContractWithoutOperationsIsRefusedRatherThanIgnored(t *testing.T) {
	t.Parallel()

	_, err := DeclaredOperations(contractFile(t, "openapi: 3.1.0\ninfo: { title: vide, version: 0.0.0 }\n"))

	require.Error(t, err)
	assert.Contains(t, err.Error(), "aucune opération")
}

// `operationId` est facultatif en OpenAPI, et `oapi-codegen` en synthétise un quand il manque : un
// contrat qui en omet reste engendrable, donc `check-generated` reste vert. Empilées telles quelles,
// deux opérations sans `operationId` entrent sous la même clé `""` et valider l'une marquerait
// l'autre visitée — la porte serait verte sur une route qu'aucun scénario ne touche, c'est-à-dire sur
// le trou qu'elle existe pour fermer.
const uneOperationSansIdentifiant = `openapi: 3.1.0
info: { title: contrat de test, version: 0.0.0 }
paths:
  /health:
    get:
      operationId: health
      responses: { '200': { description: ok } }
  /gateways:
    post:
      responses: { '201': { description: créé } }
`

// Plusieurs fautives plutôt qu'une : c'est le cas où un refus qui s'arrête à la première envoie
// corriger une route, relancer, et découvrir la suivante.
const plusieursOperationsSansIdentifiant = `openapi: 3.1.0
info: { title: contrat de test, version: 0.0.0 }
paths:
  /health:
    get:
      operationId: health
      responses: { '200': { description: ok } }
  /gateways:
    post:
      responses: { '201': { description: créé } }
  /clients:
    delete:
      responses: { '204': { description: supprimé } }
  /routes:
    put:
      responses: { '200': { description: remplacé } }
  /connectors:
    patch:
      responses: { '200': { description: modifié } }
`

func TestAnOperationWithoutAnOperationIDIsRefusedRatherThanCollapsed(t *testing.T) {
	t.Parallel()

	_, err := DeclaredOperations(contractFile(t, uneOperationSansIdentifiant))

	require.Error(t, err)
	assert.Containsf(t, err.Error(), "POST /gateways",
		"le refus ne désigne pas l'opération : personne ne saura laquelle nommer — %v", err)
}

func TestEveryOperationWithoutAnOperationIDIsNamed(t *testing.T) {
	t.Parallel()

	_, err := DeclaredOperations(contractFile(t, plusieursOperationsSansIdentifiant))

	require.Error(t, err)
	assert.Containsf(t, err.Error(),
		"DELETE /clients, PATCH /connectors, POST /gateways, PUT /routes",
		"le refus n'en nomme qu'une partie — %v", err)
}

// Le tri se garde par la répétition, et non par une lecture comparée à l'ordre attendu. Mesuré : un
// parcours de map Go n'est pas une permutation quelconque mais une **rotation** — 2000 parcours d'une
// map à cinq clés ne rendent que cinq ordres distincts. Une lecture unique sort donc triée par hasard
// une fois sur cinq, et la mutation « tri retiré » ne tombait que trois exécutions sur cinq.
func TestTheRefusalNamesThemInTheSameOrderTwice(t *testing.T) {
	t.Parallel()

	contract := contractFile(t, plusieursOperationsSansIdentifiant)

	_, first := DeclaredOperations(contract)
	require.Error(t, first)

	for range 20 {
		_, again := DeclaredOperations(contract)
		require.EqualErrorf(t, again, first.Error(),
			"deux lectures du même contrat ne reprochent pas la même chose : ce que la porte imprime "+
				"change d'une exécution à l'autre, et deux sorties du même défaut ne se comparent plus")
	}
}

func TestTheDeclaredOperationsAreSortedSoTheGateReadsTheSameTwice(t *testing.T) {
	t.Parallel()

	var contract strings.Builder

	contract.WriteString("openapi: 3.1.0\ninfo: { title: ordre, version: 0.0.0 }\npaths:\n")

	for _, operationID := range []string{"zeta", "delta", "alpha", "omega", "beta", "gamma"} {
		fmt.Fprintf(&contract, "  /%s:\n    get:\n      operationId: %s\n"+
			"      responses: { '200': { description: ok } }\n", operationID, operationID)
	}

	file := contractFile(t, contract.String())

	// Relu, et pas une seule fois : le nom de ce test promet deux lectures, et il n'en faisait qu'une.
	// Six opérations rendent six ordres possibles — le tri retiré, une lecture unique tombait juste une
	// fois sur six et laissait la suite verte d'autant.
	for range 20 {
		declared, err := DeclaredOperations(file)

		require.NoError(t, err)
		assert.Equal(t, []string{"alpha", "beta", "delta", "gamma", "omega", "zeta"}, declared,
			"l'ordre est celui d'une map Go : ce que la porte reproche changerait d'une exécution à "+
				"l'autre, et deux sorties du même défaut ne se compareraient plus")
	}
}

func TestTheOperationLedgerNamesWhatNoScenarioVisited(t *testing.T) {
	t.Parallel()

	visited := &OperationLedger{}
	visited.Visit("premiere")

	unvisited := visited.unvisited([]string{"premiere", "seconde"})

	require.Len(t, unvisited, 1,
		"une opération que le contrat déclare et qu'aucun scénario ne valide est livrée sans filet")
	assert.Contains(t, unvisited[0], "seconde")
}

func TestTheOperationLedgerIsSilentWhenEveryOperationWasVisited(t *testing.T) {
	t.Parallel()

	visited := &OperationLedger{}
	visited.Visit("premiere")
	visited.Visit("seconde")

	assert.Empty(t, visited.unvisited([]string{"premiere", "seconde"}))
}

// Même exemption que le registre de scénarios, et pour la même raison : sous un filtre qui ne demande
// qu'une partie des scénarios, presque aucune opération n'est visitée, et la porte accuserait celui
// qui débogue un scénario seul d'avoir livré des routes sans filet.
func TestARunFilterStandsTheContractGateDown(t *testing.T) {
	t.Parallel()

	stoodDown := &recordedT{}

	(&OperationLedger{}).requireEveryOperationVisited(stoodDown, contractFile(t, deuxOperations),
		"TestScenarios/la_sonde_de_vivacité")

	assert.Empty(t, stoodDown.errors,
		"la porte accuse celui qui débogue un scénario seul d'avoir livré des routes sans filet")
	assert.NotEmpty(t, stoodDown.logs,
		"la porte se retire sans le dire : rien ne signale qu'elle ne mord plus, et on la croira active")
}

// Même fil, même trou : `unvisited` nomme les opérations sans scénario, et c'est la boucle de
// `requireEveryOperationVisited` qui les rapporte. Le remplacer par `_ = l.unvisited(declared)`
// laissait la couverture du contrat entièrement muette sans qu'un seul test le dise.
func TestTheContractGateReportsItsUnvisitedOperationsToTheTest(t *testing.T) {
	t.Parallel()

	reported := &recordedT{}

	(&OperationLedger{}).requireEveryOperationVisited(reported, contractFile(t, deuxOperations), "")

	require.Empty(t, reported.fatals,
		"le contrat n'a pas été lu : le silence qui suit ne dirait rien de la porte")
	assert.Len(t, reported.errors, 2,
		"les deux opérations du contrat n'ont aucun scénario et la porte se tait : elle lit le "+
			"contrat pour personne")
}

func contractFile(t *testing.T, body string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "contrat.yaml")
	require.NoError(t, os.WriteFile(path, []byte(body), 0o600))

	return path
}

// La porte doit nommer ce qui manque, pas seulement échouer : le message est ce qu'un développeur
// lira six mois plus tard, au moment où il aura oublié qu'il fallait écrire un scénario.
func TestTheContractGateNamesTheOperationAndTheRemedy(t *testing.T) {
	t.Parallel()

	unvisited := (&OperationLedger{}).unvisited([]string{"seconde"})

	require.Len(t, unvisited, 1)
	assert.Containsf(t, unvisited[0], "scénario",
		"le message ne dit pas ce qu'il faut faire : %q", unvisited[0])
}
