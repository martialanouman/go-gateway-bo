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

// Les fiches vivent à deux endroits : celles qui restent à faire, et celles que la boucle a déplacées
// dans `done/` au dernier commit de leur PR. La porte lit les deux — une step livrée dont une
// dépendance est listée après elle raconte un ordre qui n'a pas eu lieu.
var ficheDirectories = []string{"tasks/steps", "tasks/steps/done"}

// dependencyClause découpe l'en-tête d'une fiche entre « Dépend de » et « Bloque ». Les deux champs
// se suivent dans la même citation, parfois sur deux lignes — d'où `(?s)`, et la coupe par le champ
// suivant plutôt que par une fin de ligne qui ne tiendrait pas sur `step-027.md`.
var dependencyClause = regexp.MustCompile(`(?s)\*\*Dépend de :\*\*(.*?)\*\*Bloque`)

// listedStep reconnaît une ligne de la liste de `todo.md`, cochée ou non.
var listedStep = regexp.MustCompile(`^- \[[ x]\] (step-[0-9]{3})`)

// Planchers mesurés le 01/09/2026 : **22 fiches** et **41 couples** (step, dépendance) — pour 78 steps
// au découpage, dont 56 n'ont pas de fiche. Ce sont des planchers et non des égalités, le découpage
// grossissant ; mais sans eux, une porte qui ne lirait plus aucune fiche serait verte, et c'est le
// seul état qu'elle ne doit jamais atteindre.
const (
	minimumFiches       = 20
	minimumDependencies = 35
)

// Aucune step n'est listée avant une step dont elle déclare dépendre.
//
// `todo.md` dit « l'ordre de cette liste fait foi » et `CLAUDE.md` ajoute que la ligne « Dépend de »
// d'une fiche prime quand elle le contredit. Les deux règles se lisent bien ; **rien ne les
// confrontait**.
//
// Le 01/09/2026 elles se contredisaient. Une note de bas de section déplaçait `027`, `028` et `029`
// après `041`, `042` et `040`, que la liste plaçait pourtant après elles : lire la liste dans l'ordre
// — ce que le document demande en toutes lettres — rendait **cinq positions fausses sur huit**, à
// partir de la deuxième step à faire.
//
// La ligne « Dépend de » de `step-027.md` rattrapait ce cas-là. Elle ne rattrapait pas `041`, `042` et
// `040` : elles n'ont pas de fiche, et pour les **56 steps sur 78** qui n'en ont pas, l'ordre de la
// liste est la seule source.
func TestAucuneStepNEstListeeAvantUneDontElleDepend(t *testing.T) {
	t.Parallel()

	rank := listedRanks(t, readPlanningDocument(t))
	checked := 0

	for _, fiche := range fiches(t) {
		step := stepReference.FindString(filepath.Base(fiche))
		require.NotEmptyf(t, step, "%s ne nomme pas de step", fiche)

		position, listed := rank[step]
		if !assert.Truef(t, listed, "%s a une fiche mais n'est listée nulle part dans %s", step,
			planningDocument) {
			continue
		}

		for _, dependency := range declaredDependencies(t, fiche) {
			required, known := rank[dependency]
			if !assert.Truef(t, known, "%s déclare dépendre de %s, qui n'est listée nulle part dans %s",
				step, dependency, planningDocument) {
				continue
			}

			checked++

			assert.Lessf(t, required, position,
				"%s est listée **avant** %s, dont elle déclare dépendre : lire la liste dans l'ordre "+
					"— ce que %s demande — rend une séquence inexécutable", step, dependency,
				planningDocument)
		}
	}

	assert.GreaterOrEqualf(t, checked, minimumDependencies,
		"%d couple(s) confronté(s) pour %d attendus au moins : les en-têtes ont changé de forme et la "+
			"porte est devenue inerte, pas verte", checked, minimumDependencies)
}

// listedRanks rend la position de chaque step dans la liste — la seule chose que « l'ordre fait foi »
// puisse vouloir dire.
func listedRanks(t *testing.T, document string) map[string]int {
	t.Helper()

	ranks := map[string]int{}

	for _, line := range strings.Split(document, "\n") {
		match := listedStep.FindStringSubmatch(strings.TrimSpace(line))
		if match == nil {
			continue
		}

		require.NotContainsf(t, ranks, match[1], "%s est listée deux fois dans %s : sa position ne veut "+
			"plus rien dire", match[1], planningDocument)

		ranks[match[1]] = len(ranks)
	}

	return ranks
}

// fiches rend les fichiers de step des deux répertoires.
func fiches(t *testing.T) []string {
	t.Helper()

	var found []string

	for _, directory := range ficheDirectories {
		entries, err := filepath.Glob(filepath.Join(bddtest.RepositoryRoot(t), directory, "step-*.md"))
		require.NoErrorf(t, err, "%s est illisible", directory)

		found = append(found, entries...)
	}

	require.GreaterOrEqualf(t, len(found), minimumFiches,
		"%d fiche(s) lue(s) pour %d attendues au moins : la porte ne regarde plus le découpage",
		len(found), minimumFiches)

	return found
}

// declaredDependencies rend les steps que la fiche déclare attendre.
func declaredDependencies(t *testing.T, fiche string) []string {
	t.Helper()

	content, err := os.ReadFile(fiche)
	require.NoErrorf(t, err, "%s est illisible", fiche)

	clause := dependencyClause.FindSubmatch(content)
	require.NotNilf(t, clause, "%s n'a pas d'en-tête « Dépend de … Bloque » : une fiche muette sur ses "+
		"dépendances sort du contrôle sans le dire", fiche)

	return stepReference.FindAllString(string(clause[1]), -1)
}
