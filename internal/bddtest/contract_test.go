package bddtest

import (
	"os"
	"path/filepath"
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

	(&OperationLedger{}).requireEveryOperationVisited(t, contractFile(t, deuxOperations),
		"TestScenarios/la_sonde_de_vivacité")
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
