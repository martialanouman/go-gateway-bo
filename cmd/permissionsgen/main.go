// Command permissionsgen engendre le module TypeScript que le client consomme à partir du catalogue
// de `internal/permissions`. La garde serveur est ce qui protège réellement (invariant c) ; le rendu
// conditionnel du client n'est qu'un confort — donc la source vit du côté qui décide, et le client
// en dérive.
//
// **Le chemin de sortie est un argument, pas une constante.** Trois raisons, la première étant la
// seule qui compte : le Makefile tient déjà chaque sortie engendrée dans une variable, et c'est
// cette même variable qui alimente `$(GENERATED)`, la liste que `check-generated` supprime puis
// régénère. Écrit ici, le chemin existerait à deux endroits qui se croient d'accord. Ensuite, un
// chemin relatif codé en dur lie silencieusement la commande à un répertoire courant qu'elle ne
// peut pas vérifier. Enfin, le test écrit dans un `t.TempDir()` sans toucher à l'arbre.
//
// La sortie n'est **pas** l'entrée standard, contrairement à ce que `cmd/migrate` fait de la sienne :
// un `go run … > fichier` tronque la cible avant que la commande démarre, donc un générateur qui
// échoue laisse derrière lui un fichier engendré vide — que `check-generated` verrait bien, mais
// après avoir détruit l'état précédent.
//
// L'environnement n'est pas une voie ici non plus : `internal/config` est le seul package du dépôt
// qui le lit (§1.8), et `forbidigo` tient la règle.
package main

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"unicode/utf8"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
)

const usage = "usage : permissionsgen <chemin du module TypeScript à écrire>"

func main() {
	// os.Exit reste seul dans main : appelé depuis start, il court-circuiterait son `defer`.
	if err := start(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func start(args []string) error {
	if len(args) != 1 {
		return errors.New("permissionsgen prend exactement un argument : le chemin du fichier à " +
			"écrire.\n" + usage)
	}

	rendered, err := render(permissions.All(), permissions.Categories())
	if err != nil {
		return err
	}

	// La sortie est un fichier source commité, que la CI relit et que le build consomme — pas un
	// secret. Les quatre autres fichiers engendrés du dépôt sont commités en 100644 (vérifié,
	// `git ls-files -s`) ; écrire 0600 laisserait celui-ci seul illisible pour tout autre compte du
	// poste, sans rien protéger.
	//nolint:gosec // G306 : voir juste au-dessus.
	if err := os.WriteFile(args[0], rendered, 0o644); err != nil {
		return fmt.Errorf("écrire %s : %w", args[0], err)
	}

	return nil
}

// La largeur de `web/biome.json`, et les deux indentations que Biome pose autour d'une propriété
// d'objet à cette largeur. Mesuré le 02/08/2026 avec Biome 2.5.5 : une ligne de propriété de 100
// colonnes reste en place, une de 101 est reportée sur la ligne suivante avec six espaces.
//
// **Ce que ces trois constantes doivent à `lint-web`.** `web/src/lib/permissions.gen.ts` est
// **inclus** dans le périmètre de Biome, là où `api.gen.ts` et `routeTree.gen.ts` en sont exclus —
// c'est ce qui fait de `lint-web` la porte qui relie `lineWidth` ici à `formatter.lineWidth` là-bas.
// L'inclusion tient à une mesure : reformaté par Biome, ce que ce générateur émet est
// **byte-identique** au fichier commité (zéro ligne d'écart sur 310, mesuré le 02/08/2026), quand
// `api.gen.ts` en diffère de 112 lignes de `diff` — 56 retirées et 56 ajoutées, sur un fichier qui
// en compte 67. La mesure ne se refait pas par la commande évidente : Biome **honore l'exclusion en
// silence** jusque sur `--stdin-file-path`, si bien qu'un `--stdin-file-path=src/lib/api.gen.ts`
// rend l'entrée inchangée et laisse croire à zéro écart. Il faut lui donner un chemin sonde
// non exclu — `--stdin-file-path=src/lib/sonde.ts` — pour qu'il formate pour de bon.
// Émettre l'une de ces deux formes là où Biome émettrait
// l'autre rendrait `lint-web` et `check-generated` contradictoires, chacune exigeant l'inverse de
// l'autre.
const (
	lineWidth       = 100
	propertyIndent  = "    "
	continuedIndent = "      "
)

// Les runes qu'un littéral TypeScript entre guillemets simples ne porte pas telles quelles. Elles
// sont quatre, et chacune casse quelque chose de **différent** :
// le guillemet droit fait réécrire le littéral entier en guillemets doubles par Biome ; l'antislash
// laisse un fichier valide dont la valeur a changé en silence ; le saut de ligne et le retour
// chariot rendent le fichier inanalysable. Les quatre mesures qui l'établissent, et les quatre cas
// qui les exercent, sont dans `TestEveryRuneASingleQuotedLiteralCannotCarryIsRefused`.
const forbiddenInLiteral = "'\\\n\r"

const header = `/**
 * Ce fichier est engendré à partir du catalogue de internal/permissions, qui fait foi. Le modifier
 * à la main n'a aucun effet durable : la génération suivante l'écrase.
 *
 * Le régénérer :   make generate
 * Ou directement : go run ./cmd/permissionsgen web/src/lib/permissions.gen.ts
 */

`

// Ce que ce module expose et ce qu'il n'expose pas : les données et leurs types, aucun helper
// (DN-6). Ni index par clé, ni regroupement par catégorie, ni liste des clés seules — les deux
// consommateurs prévus n'en appellent aucun, et du code engendré sans appelant est pire que du code
// mort ordinaire : `check-generated` forcerait à le maintenir à vie pendant que rien ne le prouve.
const entryType = `export interface Permission {
  readonly key: PermissionKey
  readonly category: PermissionCategory
  readonly description: string
}

`

// render rend le module. Les catégories sont **reçues** plutôt que redérivées des entrées :
// `permissions.Categories()` est la dérivation officielle du catalogue, et `catalog_test.go` la
// nomme déjà comme la source de l'union `PermissionCategory`. En recalculer une seconde ici
// ouvrirait l'écart que ce test croit fermé.
func render(entries []permissions.Entry, categories []permissions.Category) ([]byte, error) {
	var out strings.Builder

	out.WriteString(header)

	keys := make([]string, 0, len(entries))
	for _, entry := range entries {
		keys = append(keys, string(entry.Key))
	}

	names := make([]string, 0, len(categories))
	for _, category := range categories {
		names = append(names, string(category))
	}

	writeUnion(&out, "PermissionKey", keys)
	writeUnion(&out, "PermissionCategory", names)
	out.WriteString(entryType)

	out.WriteString("export const PERMISSIONS: readonly Permission[] = [\n")

	for _, entry := range entries {
		if err := writeEntry(&out, entry); err != nil {
			return nil, err
		}
	}

	out.WriteString("]\n")

	return []byte(out.String()), nil
}

// Un membre par ligne, toujours — c'est ce qui fait d'une clé perdue une ligne supprimée nommée
// dans le diff de la PR (DN-7), et c'est aussi ce que Biome émet aux tailles réelles du catalogue.
//
// **Aux tailles réelles seulement.** Biome replie sur une seule ligne toute union qui tient dans les
// 100 colonnes. Mesuré le 02/08/2026 sur les vrais noms de catégories : cinq membres sont repliés,
// six ne le sont plus — c'est la largeur qui décide, pas un nombre de membres. Le catalogue porte
// onze catégories et quarante-quatre clés, donc les deux unions sont loin au-delà du seuil. Le
// générateur n'implémente pas le repli : ce serait une branche que rien n'atteint et que personne
// ne relit.
func writeUnion(out *strings.Builder, name string, members []string) {
	fmt.Fprintf(out, "export type %s =\n", name)

	for _, member := range members {
		fmt.Fprintf(out, "  | '%s'\n", member)
	}

	out.WriteString("\n")
}

func writeEntry(out *strings.Builder, entry permissions.Entry) error {
	fields := []struct {
		name  string
		value string
	}{
		{"clé", string(entry.Key)},
		{"catégorie", string(entry.Category)},
		{"description", entry.Description},
	}

	for _, field := range fields {
		if index := strings.IndexAny(field.value, forbiddenInLiteral); index >= 0 {
			offending, _ := utf8.DecodeRuneInString(field.value[index:])

			// Le message ne nomme pas une cause unique : les quatre runes cassent des choses
			// différentes, et en conseiller une seule envoie chercher le mauvais coupable. Mesuré :
			// le guillemet droit, échappé, fait réécrire le littéral en guillemets doubles par
			// Biome ; `\n` et `\r` rendent le fichier inanalysable (« unterminated string
			// literal ») ; et l'antislash **change la valeur en silence** — `'C:\nouveau'` vaut 19
			// caractères côté JS dont un vrai saut de ligne, là où le catalogue Go en porte 20.
			return fmt.Errorf("la clé %q porte dans sa %s le caractère %q, qu'un littéral TypeScript "+
				"entre guillemets simples ne peut pas porter tel quel. Selon le caractère, la sortie "+
				"cesse d'être stable, devient inanalysable, ou porte une valeur différente de celle "+
				"du catalogue. Pour une apostrophe, écrire la typographique ’",
				entry.Key, field.name, offending)
		}
	}

	out.WriteString("  {\n")
	fmt.Fprintf(out, "%skey: '%s',\n", propertyIndent, entry.Key)
	fmt.Fprintf(out, "%scategory: '%s',\n", propertyIndent, entry.Category)
	writeDescription(out, entry.Description)
	out.WriteString("  },\n")

	return nil
}

// La largeur se compte en **points de code**, pas en octets : mesuré, une ligne de 100 points de
// code pour 180 octets — 80 « é » — reste en place chez Biome, et « — » comme « ’ » comptent pour
// un. Un `len()` la reporterait à la ligne, et le fichier commité cesserait d'être ce que Biome
// accepte.
func writeDescription(out *strings.Builder, description string) {
	inline := fmt.Sprintf("%sdescription: '%s',", propertyIndent, description)

	if utf8.RuneCountInString(inline) <= lineWidth {
		out.WriteString(inline + "\n")

		return
	}

	fmt.Fprintf(out, "%sdescription:\n", propertyIndent)
	fmt.Fprintf(out, "%s'%s',\n", continuedIndent, description)
}
