package bddtest_test

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/bddtest"
)

const (
	// debtsDirectory porte **une dette par fichier**. Le registre vivait auparavant dans un tableau
	// de `planningDocument`, et cette forme avait un défaut qu'aucune garde ne rattrapait : une ligne
	// retirée d'un tableau de plusieurs centaines de lignes ne se voit pas en revue. Un plancher sur
	// le nombre de lignes tentait de le tenir, mais il était prélevé sur la donnée même qu'il gardait
	// — il dérivait à chaque ajout, et valait 60 pour 80 lignes le jour où on l'a remesuré.
	//
	// Un fichier supprimé, lui, apparaît nommément dans un diff. La structure supprime le mode
	// d'échec au lieu d'essayer de le garder, et c'est pourquoi aucun plancher ne le remplace ici.
	debtsDirectory = "debts"
	// planningDocument n'est plus lu que pour une chose : savoir quelles steps sont cochées.
	planningDocument = "tasks/todo.md"
	// conventionDocument décrit la forme d'une dette. Ce n'en est pas une.
	conventionDocument = "README.md"
)

// unattributed est ce qu'écrit une dette qu'on choisit de ne pas porter. La porte l'accepte, et
// **seulement sous cette forme** : « à désigner » est un porteur qui n'existe pas, et une mention
// vide ne se distingue pas d'un oubli.
//
// L'en-tête doit **commencer** par ce marqueur, et non le contenir quelque part : avec un
// `strings.Contains`, une dette dont la prose citerait ces deux mots sortirait entièrement du
// contrôle, porteur compris.
const unattributed = "**sans porteur**"

// carrierLine lit l'en-tête d'une dette, cherché par son libellé et jamais par un numéro de ligne :
// celui-ci se périmerait au premier paragraphe ajouté au-dessus.
var carrierLine = regexp.MustCompile(`(?m)^> \*\*Porteur :\*\* (.+?)(?: ·|$)`)

// stepReference reconnaît un renvoi de step tel que tout le dépôt l'écrit.
var stepReference = regexp.MustCompile(`step-[0-9]{3}`)

// checkedStep reconnaît une step cochée dans la liste de `planningDocument`.
var checkedStep = regexp.MustCompile(`- \[x\] (step-[0-9]{3})`)

// maxUnattributed borne la démission : sans elle, un registre dont **toutes** les dettes seraient
// marquées « sans porteur » passerait vert — la porte tient les porteurs faux, pas l'abandon.
//
// Six, et six dettes le sont aujourd'hui : **la borne est pleine**. C'est délibéré et c'est ce
// qu'elle existe pour provoquer — la prochaine non-attribution se discute au lieu de s'ajouter. La
// relever sans écrire ici la mesure qui le justifie serait consommer un quota, pas trancher.
const maxUnattributed = 6

// debt est ce qu'un fichier de `debts/` déclare de vérifiable.
type debt struct {
	file    string
	carrier string
}

// readDebts rend une dette par fichier. Elle fait rougir sur un dossier vide ou illisible : une
// porte qui ne lit rien est verte sans rien garder, et c'est le seul état qu'on ne saurait pas
// distinguer d'un registre en règle.
func readDebts(t *testing.T) []debt {
	t.Helper()

	root := filepath.Join(bddtest.RepositoryRoot(t), debtsDirectory)

	entries, err := os.ReadDir(root)
	require.NoErrorf(t, err, "%s est illisible : le registre des dettes a disparu ou changé de place",
		debtsDirectory)

	var debts []debt

	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".md") || name == conventionDocument {
			continue
		}

		content, err := os.ReadFile(filepath.Join(root, name))
		require.NoErrorf(t, err, "%s est illisible", name)

		match := carrierLine.FindSubmatch(content)
		require.NotNilf(t, match,
			"%s ne déclare aucun porteur : la ligne « > **Porteur :** … » manque, et une dette dont "+
				"personne ne dit qui la paiera est une dette que personne ne paiera", name)

		debts = append(debts, debt{file: name, carrier: strings.TrimSpace(string(match[1]))})
	}

	require.NotEmptyf(t, debts, "aucune dette lue dans %s : le contrôle est inerte, pas vert",
		debtsDirectory)

	return debts
}

// readPlanningDocument rend le document de pilotage, ou fait rougir. Partagé avec
// `sequence_test.go`, qui y lit l'ordre des steps.
func readPlanningDocument(t *testing.T) string {
	t.Helper()

	content, err := os.ReadFile(filepath.Join(bddtest.RepositoryRoot(t), planningDocument))
	require.NoErrorf(t, err, "%s est illisible", planningDocument)

	return string(content)
}

// Une dette nomme qui la paiera, ou dit pourquoi personne ne le fera.
func TestChaqueDetteNommeSonPorteurOuLaRaisonDeNePasEnAvoir(t *testing.T) {
	t.Parallel()

	abandoned := 0

	for _, held := range readDebts(t) {
		if strings.HasPrefix(held.carrier, unattributed) {
			assert.Greaterf(t, len(held.carrier), len(unattributed)+3,
				"%s n'est portée par personne **et** ne dit pas pourquoi : une non-attribution sans "+
					"motif se relit comme un oubli", held.file)

			abandoned++

			continue
		}

		assert.Regexpf(t, stepReference, held.carrier,
			"%s désigne un porteur qui n'est pas une step : %q", held.file, held.carrier)
	}

	assert.LessOrEqualf(t, abandoned, maxUnattributed,
		"%d dette(s) sans porteur pour %d tolérées : chacune demande une raison mesurée, et une "+
			"démission de masse passerait sans cela pour un registre en règle", abandoned, maxUnattributed)
}

// Une dette dont la step est **déjà cochée** a survécu à ce qui devait la payer, pendant que le
// registre affirme encore que quelqu'un s'en occupe. Ou bien elle a été payée et son fichier devait
// disparaître, ou bien son porteur n'est pas celui qu'on croyait.
func TestAucuneDetteNeSurvitALaStepQuiDevaitLaPayer(t *testing.T) {
	t.Parallel()

	done := map[string]bool{}
	for _, match := range checkedStep.FindAllStringSubmatch(readPlanningDocument(t), -1) {
		done[match[1]] = true
	}

	require.NotEmptyf(t, done, "aucune step cochée dans %s : le contrôle est inerte, pas vert",
		planningDocument)

	for _, held := range readDebts(t) {
		// L'absence de porteur se teste **avant** d'y chercher une step, et ce n'est pas un détail
		// d'ordre : la raison d'une non-attribution en cite souvent une — « step-021 n'en nomme
		// aucun » —, et la lire comme un porteur ferait rougir la porte sur une dette parfaitement en
		// règle. Mesuré sur le registre du jour : deux des six y tombaient.
		if strings.HasPrefix(held.carrier, unattributed) {
			continue
		}

		step := stepReference.FindString(held.carrier)

		assert.Falsef(t, done[step],
			"%s renvoie à %s, qui est **déjà cochée** : la dette a survécu à la step censée la payer. "+
				"Si elle a bien été payée, le fichier se **supprime**", held.file, step)
	}
}
