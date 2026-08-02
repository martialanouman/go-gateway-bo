package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
)

// Le chemin du fichier commité, relatif au répertoire du package — `go test` lance le binaire de
// test là. Il n'est pas en dur dans le générateur, qui le reçoit en argument (voir `main.go`).
const committedPath = "../../web/src/lib/permissions.gen.ts"

// Une entrée engendrée, sous les deux formes que Biome admet : la description tient sur la ligne de
// propriété, ou elle est reportée à la ligne suivante. Les deux sont reconnues ici parce que les
// deux existent dans le vrai catalogue, et qu'un test qui n'en lirait qu'une déclarerait l'autre
// absente.
var entryShape = regexp.MustCompile(
	`(?m)^  \{\n` +
		`    key: '([^']*)',\n` +
		`    category: '([^']*)',\n` +
		`    description:(?: '([^']*)'|\n      '([^']*)'),\n` +
		`  \},$`,
)

var unionMember = regexp.MustCompile(`(?m)^  \| '([^']*)'$`)

func renderCatalog(t *testing.T) string {
	t.Helper()

	rendered, err := render(permissions.All(), permissions.Categories())
	require.NoError(t, err)

	return string(rendered)
}

// unionMembers rend les membres de l'union nommée, dans leur ordre d'émission.
func unionMembers(t *testing.T, rendered, name string) []string {
	t.Helper()

	declaration := "export type " + name + " =\n"
	start := strings.Index(rendered, declaration)
	require.NotEqualf(t, -1, start, "l'union %s n'est pas déclarée", name)

	body := rendered[start+len(declaration):]
	if end := strings.Index(body, "\n\n"); end != -1 {
		body = body[:end]
	}

	var members []string
	for _, match := range unionMember.FindAllStringSubmatch(body, -1) {
		members = append(members, match[1])
	}

	require.NotEmptyf(t, members, "l'union %s n'a aucun membre", name)

	return members
}

// Le fichier engendré est le golden de la perte d'une clé (DN-7) : c'est lui, et rien côté Go, qui
// transforme une clé disparue en ligne supprimée nommée dans le diff. Ce cas relit donc les entrées
// depuis le TypeScript émis plutôt que de faire confiance au générateur — clé, catégorie et
// description, dans l'ordre du catalogue.
func TestTheEmittedArrayCarriesEveryCatalogEntryVerbatim(t *testing.T) {
	t.Parallel()

	rendered := renderCatalog(t)

	var reread []permissions.Entry
	for _, match := range entryShape.FindAllStringSubmatch(rendered, -1) {
		description := match[3] + match[4] // l'une des deux formes est vide
		reread = append(reread, permissions.Entry{
			Key:         permissions.Key(match[1]),
			Category:    permissions.Category(match[2]),
			Description: description,
		})
	}

	assert.Equal(t, permissions.All(), reread)
}

// Les deux unions sont ce qui donne un type aux clés et aux catégories chez le client. Une union
// incomplète refuse une valeur légitime ; une union plus large que le catalogue accepte une clé qui
// n'existe pas. Les deux sens comptent, d'où l'égalité et non l'inclusion.
func TestTheUnionsAdmitExactlyWhatTheCatalogCarries(t *testing.T) {
	t.Parallel()

	rendered := renderCatalog(t)

	var keys []string
	for _, entry := range permissions.All() {
		keys = append(keys, string(entry.Key))
	}

	var categories []string
	for _, category := range permissions.Categories() {
		categories = append(categories, string(category))
	}

	assert.Equal(t, keys, unionMembers(t, rendered, "PermissionKey"))
	assert.Equal(t, categories, unionMembers(t, rendered, "PermissionCategory"))
}

// Deux exécutions, même octet. Ce que ce cas garde n'est pas une propriété abstraite : un
// regroupement par catégorie écrit avec une `map` rendrait l'ordre des familles aléatoire, et le
// fichier engendré rougirait `check-generated` une fois sur deux sans qu'aucune ligne du dépôt
// n'ait bougé. Aujourd'hui `render` n'itère aucune `map` — vérifié, le générateur n'en déclare
// aucune — donc le déterminisme y est acquis par construction ; ce cas garde la construction, pas
// une propriété observée.
//
// C'est précisément pourquoi la sortie est aussi exigée **non vide**. L'égalité seule est tout aussi
// vraie sur `("", nil)` que sur les dix kilo-octets réels : mesuré le 02/08/2026, un `render`
// court-circuité à `return nil, nil` repassait ce cas tel quel. Le stub qui a servi pendant
// l'écriture le repasserait encore.
func TestTwoRunsProduceTheSameBytes(t *testing.T) {
	t.Parallel()

	first, err := render(permissions.All(), permissions.Categories())
	require.NoError(t, err)
	require.NotEmpty(t, first, "le générateur n'a rien rendu : l'égalité qui suit ne compare rien")

	second, err := render(permissions.All(), permissions.Categories())
	require.NoError(t, err)

	assert.Equal(t, string(first), string(second))
}

// Les quatre runes que `forbiddenInLiteral` refuse, chacune pour une raison **différente**, et
// chacune mesurée le 02/08/2026 (Biome 2.5.5, Node 24) plutôt que supposée :
//
//   - Le **guillemet droit** : échappé, Biome réécrit le littéral entier en guillemets doubles —
//     `'Voir l\'écran'` devient `"Voir l'écran"`. `check-generated` et `lint-web` exigeraient alors
//     l'inverse l'une de l'autre, en boucle. La copie du dépôt écrit l'apostrophe typographique `’`,
//     que la même mesure laisse intacte ; le générateur refuse plutôt que d'arbitrer.
//   - L'**antislash** : le fichier reste valide et Biome n'a rien à en dire, mais la valeur change en
//     silence. `'Le chemin C:\nouveau'` vaut côté JS une chaîne de 19 caractères contenant un vrai
//     saut de ligne, là où le catalogue Go en porte 20. Le TypeScript engendré cesserait de dire ce
//     que le catalogue dit, et rien ici ne le verrait : les autres cas comparent du texte à du texte,
//     où l'antislash est resté un antislash.
//   - Le **saut de ligne** et le **retour chariot** : le fichier ne s'analyse plus du tout. Mesuré,
//     `biome check` rend `unterminated string literal — The closing quote must be on the same line`.
//
// Les quatre sont exercées parce que trois ne l'étaient pas : mesuré, réduire la constante au seul
// guillemet droit laissait `cmd/permissionsgen` entièrement vert. Les descriptions d'épreuve ne
// portent que la rune examinée — une apostrophe glissée dans le cas du saut de ligne le ferait
// passer pour la mauvaise raison.
func TestEveryRuneASingleQuotedLiteralCannotCarryIsRefused(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name        string
		description string
	}{
		{"le guillemet droit", "Consulter l'écran"},
		{"l'antislash", `Consulter le chemin C:\nouveau`},
		{"le saut de ligne", "Consulter\ndeux lignes"},
		{"le retour chariot", "Consulter\rdeux lignes"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			entries := []permissions.Entry{
				{Key: "routes:read", Category: "routing", Description: testCase.description},
			}

			_, err := render(entries, []permissions.Category{"routing"})

			require.Errorf(t, err, "une description portant %s a été engendrée telle quelle",
				testCase.name)
			assert.Contains(t, err.Error(), "routes:read", "le refus ne nomme pas la clé fautive")
		})
	}
}

// Mesuré le 02/08/2026, `web/node_modules/.bin/biome format` sur `web/biome.json` (largeur 100) :
// une ligne de propriété de 100 colonnes reste en place, une de 101 est reportée sur la ligne
// suivante avec six espaces d'indentation. Et la colonne se compte en **points de code**, pas en
// octets — une ligne de 100 points de code pour 180 octets (80 « é ») reste en place, tout comme
// avec « — » et « ’ ».
//
// Les deux formes existent dans le vrai catalogue — comptées le 02/08/2026 sur le fichier commité,
// 29 descriptions en ligne et 15 reportées, pour 44 entrées. Émettre l'une là où Biome émettrait
// l'autre rendrait `lint-web` et `check-generated` contradictoires : `permissions.gen.ts` est inclus
// dans le périmètre de Biome, donc `lint-web` le formate vraiment.
func TestADescriptionIsWrappedExactlyWhereBiomeWouldWrapIt(t *testing.T) {
	t.Parallel()

	// `    description: '…',` fait 20 colonnes de plus que la description elle-même.
	const inlineWidth = 80

	fits := permissions.Entry{
		Key:         "routes:read",
		Category:    "routing",
		Description: strings.Repeat("é", inlineWidth),
	}
	overflows := permissions.Entry{
		Key:         "routes:write",
		Category:    "routing",
		Description: strings.Repeat("é", inlineWidth+1),
	}

	rendered, err := render([]permissions.Entry{fits, overflows}, []permissions.Category{"routing"})
	require.NoError(t, err)

	assert.Contains(t, string(rendered), "    description: '"+fits.Description+"',\n",
		"une description de 100 colonnes a été reportée à la ligne, là où Biome la laisse en place — "+
			"la largeur se compterait-elle en octets ?")
	assert.Contains(t, string(rendered), "    description:\n      '"+overflows.Description+"',\n",
		"une description de 101 colonnes n'a pas été reportée comme Biome la reporterait")
}

// Le chemin de sortie est un argument, et non une constante du générateur : c'est le Makefile qui
// tient chaque sortie engendrée, dans la variable qui alimente aussi `$(GENERATED)`. Ces deux cas
// sont ce qui rend cette décision vraie plutôt qu'annoncée — le second parce qu'un `args[0]` sans
// garde ne rendrait pas une sortie de secours mais un `index out of range`.
func TestTheOutputPathIsTheArgument(t *testing.T) {
	t.Parallel()

	target := filepath.Join(t.TempDir(), "permissions.gen.ts")

	require.NoError(t, start([]string{target}))

	written, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.Equal(t, renderCatalog(t), string(written))
}

// Les deux chemins sont pris dans un `t.TempDir()` et non relatifs au package. Mesuré le
// 02/08/2026 en relâchant la garde à `len(args) < 1` : avec les chemins relatifs d'origine, ce cas
// écrivait `cmd/permissionsgen/premier.ts` dans l'arbre source. Un cas dont toute la raison d'être
// est que rien ne s'écrive ne doit pas pouvoir écrire là où ça compte — et le répertoire est relu à
// la fin, pour que « rien ne s'écrit » soit observé plutôt que déduit du refus.
func TestTheCommandRefusesToGuessItsOutputPath(t *testing.T) {
	t.Parallel()

	directory := t.TempDir()

	require.Error(t, start(nil), "sans argument, la commande a écrit quelque part")
	require.Error(t, start([]string{
		filepath.Join(directory, "premier.ts"),
		filepath.Join(directory, "second.ts"),
	}), "avec deux arguments, la commande n'a pas dit lequel elle ignorait")

	written, err := os.ReadDir(directory)
	require.NoError(t, err)
	assert.Empty(t, written, "la commande a refusé puis écrit quand même")
}

// `check-generated` tient ce front côté Makefile, mais seulement si la step qui ajoute une sortie
// pense à l'inscrire dans `$(GENERATED)` — le Makefile le dit lui-même : « le jour où une step en
// ajoute un, l'oublier ici le laisserait diverger sans que rien ne rougisse ». Ce cas ferme cet
// oubli-là, et il tourne dans `test-go`, qui n'a pas besoin des deux toolchains.
func TestTheCommittedFileIsWhatTheGeneratorProduces(t *testing.T) {
	t.Parallel()

	committed, err := os.ReadFile(committedPath)
	require.NoError(t, err)

	assert.Equal(t, renderCatalog(t), string(committed),
		"%s diffère du catalogue — le régénérer et le commiter", committedPath)
}
