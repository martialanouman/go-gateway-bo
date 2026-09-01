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

// Le registre des dettes et la façon dont il se lit. Le titre de section **est** la définition du
// registre : le déplacer déplace la porte avec lui, et le renommer la fait rougir plutôt que de la
// laisser regarder un document vide.
const (
	planningDocument = "tasks/todo.md"
	registerHeading  = "## Dettes ouvertes"
)

// unattributed est ce qu'écrit une dette qu'on choisit de ne pas porter. Le dépôt en a déjà rendu
// deux — la fenêtre d'oubli dupliquée et la garde inatteignable de `API.Login` —, avec leur raison
// mesurée. La porte les accepte, et **seulement sous cette forme** : « à désigner » est un porteur qui
// n'existe pas, et une case vide ne se distingue pas d'un oubli.
//
// La cellule doit **commencer** par ce marqueur, et non le contenir quelque part. La première
// rédaction testait `strings.Contains`, ce qui avait deux effets et un seul était voulu : une ligne
// dont la prose citerait ces deux mots sortait entièrement du contrôle, **porteur compris**. Deux
// lignes du registre nomment d'ailleurs une step dans leur raison — pour dire quelle fiche a refusé
// d'en désigner un —, et ces steps-là sont cochées : les juger comme des porteurs les ferait rougir
// à tort. C'est le saut qui doit être précis, pas la lecture.
const unattributed = "**sans porteur**"

// settledMark ouvre la cellule d'une dette **payée**. Le registre exige qu'une dette payée se barre
// sur place plutôt que de s'effacer — « une ligne effacée se rouvre en silence » —, et c'est ainsi que
// step-025 a barré les siennes.
//
// **Sans ce cas, la porte contredisait le registre**, et la contradiction se serait déclenchée à la
// première step livrée : le jour où `step-031` est cochée, les sept lignes qui la nomment deviendraient
// rouges, et la seule sortie compatible aurait été d'effacer le porteur — exactement ce que le registre
// interdit. Trouvé en revue avant que ça n'arrive.
const settledMark = "~~"

// stepReference reconnaît un renvoi de step tel que tout le dépôt l'écrit.
var stepReference = regexp.MustCompile(`step-[0-9]{3}`)

// tableRow reconnaît une ligne de table Markdown.
var tableRow = regexp.MustCompile(`^\|(?:[^|]*\|){2,}`)

// separatorCell reconnaît une cellule de ligne de séparation — et **seulement** cela.
//
// La première rédaction cherchait `---` n'importe où dans la ligne. Une dette dont le texte en
// contiendrait — une plage écrite `2---5`, un tiret triple dans un `code span` — était alors prise pour
// un séparateur : elle sortait du contrôle **et** emportait la ligne précédente avec elle, deux dettes
// en trois caractères, sans un mot. C'est le contournement le plus propre que la revue ait trouvé.
var separatorCell = regexp.MustCompile(`^:?-{3,}:?$`)

// registerRowCount est un **plancher**, pas une égalité : le registre porte **soixante-trois** lignes
// le jour où ce contrôle est écrit.
//
// Il est à soixante parce que la revue a montré que le premier chiffre ne tenait pas : quarante-cinq
// pour soixante-trois lignes laissait retirer **vingt-huit pour cent** du registre — les dix lignes de
// step-029, ou les huit de step-060, en entier — sans un rougissement. Le commentaire d'alors défendait
// « une refonte de forme, pas un vidage » ; il autorisait le vidage. Trois lignes de marge suffisent à
// une fusion de formulation.
//
// Le compte ne décroît pas dans le cours normal des choses : une dette payée se **barre**, elle reste.
const registerRowCount = 60

// maxUnattributed borne la démission. Cinq lignes sont sans porteur aujourd'hui, chacune avec sa raison
// mesurée ; sans cette borne, un registre dont **toutes** les lignes seraient marquées « sans porteur »
// passerait vert — la porte tenait les porteurs faux, pas l'abandon.
const maxUnattributed = 5

// Toute dette du registre nomme un porteur qui existe et qui reste à faire.
//
// Le registre existe parce que les dettes du projet vivaient dans 17 fiches archivées et des
// commentaires, et que le dépôt écrit lui-même, trois fois, pourquoi c'est un problème : *« une fiche
// archivée n'est ouverte par personne »*. Le mot « dette » n'apparaissait alors **pas une seule fois**
// dans `todo.md`, et une seule dans `plan.md` — pour en déclarer une soldée. La première rédaction de
// ce commentaire disait « ni dans `plan.md` » : la mesure qui l'établissait était un `grep` sensible à
// la casse, et l'occurrence s'écrit `**Dette soldée**`.
//
// Un registre se périme comme le reste. Deux façons, et cette porte tient les deux :
//
//   - un porteur qui **n'existe pas** — une step inventée, ou renumérotée ailleurs ;
//   - un porteur **déjà coché**, c'est-à-dire une dette renvoyée à une step qui est passée sans la
//     payer. C'est la moitié qui compte : elle est silencieuse, et le registre continue d'affirmer que
//     quelqu'un s'en occupe.
//
// Le dépôt a déjà corrigé un pointeur faux une fois, à la main (step-004, DN-10 : « corriger un renvoi
// n'est pas réécrire l'histoire »), sans rien pour l'empêcher de revenir.
//
// La porte lit le **document de pilotage** et lui seul. Elle ne parcourt pas les fiches de `done/` :
// celles-ci racontent une décision datée, et un renvoi qui y devient faux relève de la relecture, pas
// d'une porte — même tri que `internal/gateway/version_test.go`, qui l'écrit en toutes lettres.
func TestChaqueDetteNommeUnPorteurQuiExisteEtResteAFaire(t *testing.T) {
	t.Parallel()

	document := readPlanningDocument(t)
	rows := registerRows(t, document)

	require.GreaterOrEqualf(t, len(rows), registerRowCount,
		"%d ligne(s) au registre pour %d attendues au moins : la porte ne regarde plus les dettes",
		len(rows), registerRowCount)

	pending, done := plannedSteps(t, document)
	abandoned := 0

	for _, row := range rows {
		if strings.HasPrefix(row.carrier, unattributed) {
			abandoned++

			continue
		}

		named := stepReference.FindAllString(row.carrier, -1)
		assert.NotEmptyf(t, named,
			"« %s » ne nomme ni une step ni « %s » : une case qu'on ne sait pas remplir ne se "+
				"distingue pas d'un oubli", row.carrier, unattributed)

		for _, step := range named {
			assert.Truef(t, pending[step] || done[step],
				"le registre renvoie à %s, qui n'existe nulle part dans %s", step, planningDocument)

			// Une dette **barrée** est payée : son porteur doit être coché, et c'est ce qui le prouve.
			// Le sens de la vérification s'inverse donc avec l'état de la ligne, au lieu de rendre
			// impossible de barrer quoi que ce soit.
			if strings.HasPrefix(row.debt, settledMark) {
				assert.Truef(t, done[step],
					"la dette est barrée — donc payée — mais %s reste à faire : ou la ligne est "+
						"barrée trop tôt, ou son porteur n'est pas celui qui l'a payée", step)

				continue
			}

			assert.Falsef(t, done[step],
				"le registre renvoie à %s, qui est **déjà cochée** : la dette a survécu à la step "+
					"censée la payer, et le registre affirme encore que quelqu'un s'en occupe. Si elle "+
					"a bien été payée, la ligne se **barre** au lieu de s'effacer", step)
		}
	}

	assert.LessOrEqualf(t, abandoned, maxUnattributed,
		"%d ligne(s) sans porteur pour %d tolérées : chacune demande une raison mesurée, et une "+
			"démission de masse passerait sans cela pour un registre en règle", abandoned, maxUnattributed)
}

// registerRow est une ligne du registre : ce qu'elle nomme, et qui la porte.
type registerRow struct {
	debt    string
	carrier string
}

// readPlanningDocument rend le document de pilotage, ou fait rougir.
func readPlanningDocument(t *testing.T) string {
	t.Helper()

	content, err := os.ReadFile(filepath.Join(bddtest.RepositoryRoot(t), planningDocument))
	require.NoErrorf(t, err, "%s est illisible", planningDocument)

	return string(content)
}

// registerRows rend la première et la dernière colonne de chaque ligne du registre.
//
// La section se délimite par son titre et le titre suivant, jamais par un numéro de ligne : celui-ci
// se périme au premier paragraphe ajouté au-dessus.
func registerRows(t *testing.T, document string) []registerRow {
	t.Helper()

	start := strings.Index(document, registerHeading)
	require.GreaterOrEqualf(t, start, 0,
		"%q introuvable dans %s : le registre a disparu ou changé de nom", registerHeading,
		planningDocument)

	section := document[start+len(registerHeading):]
	if end := strings.Index(section, "\n## "); end >= 0 {
		section = section[:end]
	}

	var rows []registerRow

	for _, line := range strings.Split(section, "\n") {
		trimmed := strings.TrimSpace(line)
		if !tableRow.MatchString(trimmed) {
			continue
		}

		cells := strings.Split(strings.Trim(trimmed, "|"), "|")
		for index, cell := range cells {
			cells[index] = strings.TrimSpace(cell)
		}

		// La ligne de séparation désigne l'en-tête : c'est celle qui la précède. Retirer l'en-tête
		// **par cette règle** et non par sa position tient quel que soit le nombre de tables de la
		// section — la première rédaction n'en retirait qu'un, et la porte l'a dit en rapportant
		// « Porteur » comme un porteur qui n'existe pas.
		if isSeparator(cells) {
			if len(rows) > 0 {
				rows = rows[:len(rows)-1]
			}

			continue
		}

		rows = append(rows, registerRow{debt: cells[0], carrier: cells[len(cells)-1]})
	}

	return rows
}

// isSeparator dit si toutes les cellules d'une ligne ne portent que des tirets — la seule forme d'une
// ligne de séparation Markdown, et rien d'autre.
func isSeparator(cells []string) bool {
	for _, cell := range cells {
		if !separatorCell.MatchString(cell) {
			return false
		}
	}

	return true
}

// plannedSteps rend les steps de `todo.md`, séparées selon qu'elles restent à faire ou sont cochées.
//
// C'est la **même source** que le registre, et c'est voulu : ce que la porte vérifie n'est pas qu'une
// step existe dans l'absolu, mais que le document est cohérent avec lui-même. Un renvoi vers une step
// qui n'est listée nulle part est le défaut le plus probable, et il ne se voit d'aucune autre façon.
func plannedSteps(t *testing.T, document string) (pending, done map[string]bool) {
	t.Helper()

	pending, done = map[string]bool{}, map[string]bool{}

	for _, line := range strings.Split(document, "\n") {
		trimmed := strings.TrimSpace(line)

		step := stepReference.FindString(trimmed)
		if step == "" {
			continue
		}

		switch {
		case strings.HasPrefix(trimmed, "- [ ] "):
			pending[step] = true
		case strings.HasPrefix(trimmed, "- [x] "):
			done[step] = true
		}
	}

	require.NotEmpty(t, pending, "aucune step à faire dans %s : la porte est inerte, pas verte",
		planningDocument)
	require.NotEmpty(t, done, "aucune step cochée dans %s : la moitié « déjà payée » ne peut pas "+
		"rougir", planningDocument)

	return pending, done
}
