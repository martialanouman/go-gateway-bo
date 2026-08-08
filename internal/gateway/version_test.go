package gateway_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/bddtest"
)

const contractPackage = "@martialanouman/gateway-api-contracts"

// Un bump périme en silence tout texte qui affirme la version, et rien ne le voit. step-003 l'a payé :
// sa propre fiche raconte que le bump est arrivé au huitième commit « et n'a fait relire aucun texte
// qui parlait du contrat — cinq DN, quatre commentaires de code et six passages de documentation
// affirmaient du faux ». Le correctif d'alors fut de tout remesurer à la main. Rien n'avait été posé
// pour que ça ne recommence pas ; c'est cette porte.
//
// Elle ne couvre qu'une classe de textes sur trois, et le tri est délibéré :
//
//   - **l'état présent** — « le dépôt installe X » — que le bump rend faux sans le toucher. Les deux
//     tableaux de versions ci-dessous en sont la forme pure : leur raison d'être *est* d'affirmer ce
//     qui est installé. C'est ce que ce test garde.
//   - **la mesure datée** — « mesuré le 02/08/2026 sur le contrat 2.5.0 ». Elle reste vraie comme
//     mesure, mais on la lit comme un fait actuel et ses chiffres bougent : `errors.go` annonçait
//     « 3 de ses 133 opérations déclarent un 503 », elles sont 4 en 4.0.2. Ce test ne peut rien pour
//     elle — juger si une affirmation de fond est encore vraie, c'est de la lecture, pas une porte.
//   - **l'historique** — `tasks/steps/done/`, où une fiche livrée raconte une décision datée. La
//     réécrire falsifierait un compte rendu. Ces fichiers ne sont pas lus, et c'est le sens de la
//     classe, pas une commodité.
//
// Ce qui échappe donc encore, et qu'il faut relire : une clause au présent noyée dans une phrase, un
// numéro de ligne devenu faux, un chiffre mesuré sur une version antérieure.
func TestTheDocumentedContractVersionIsTheInstalledOne(t *testing.T) {
	t.Parallel()

	root := bddtest.RepositoryRoot(t)
	installed := installedContractVersion(t, root)

	for _, document := range []string{"tasks/plan.md", "tasks/todo.md"} {
		content, err := os.ReadFile(filepath.Join(root, document))
		require.NoErrorf(t, err, "lecture de %s", document)

		documented := versionsAnnouncedIn(string(content))

		require.NotEmptyf(t, documented, "%s n'annonce plus la version de %s dans aucun tableau. "+
			"Cette porte ne garde rien tant qu'elle ne trouve pas la ligne : la rebrancher sur la "+
			"forme qu'a prise le tableau, plutôt que la laisser verte et vide.",
			document, contractPackage)

		for _, version := range documented {
			assert.Equalf(t, installed, version,
				"%s annonce le contrat en %s, web/package.json installe %s. Un bump périme les textes "+
					"qui nomment la version sans les toucher, et aucune autre porte ne le voit.",
				document, version, installed)
		}
	}
}

// Les tableaux annoncent la version en gras, dans une cellule à eux : `| … | `<paquet>` | **X** |`.
// La regex part du nom du paquet plutôt que d'un numéro de ligne, qui dériverait à la première
// insertion.
var announcedVersion = regexp.MustCompile(
	`\|[^|\n]*` + regexp.QuoteMeta("`"+contractPackage+"`") + `[^|\n]*\|\s*\*\*([^*|]+)\*\*\s*\|`)

func versionsAnnouncedIn(content string) []string {
	matches := announcedVersion.FindAllStringSubmatch(content, -1)

	versions := make([]string, 0, len(matches))
	for _, match := range matches {
		versions = append(versions, match[1])
	}

	return versions
}

func installedContractVersion(t *testing.T, root string) string {
	t.Helper()

	content, err := os.ReadFile(filepath.Join(root, "web", "package.json"))
	require.NoError(t, err, "lecture de web/package.json")

	var manifest struct {
		Dependencies map[string]string `json:"dependencies"`
	}

	require.NoError(t, json.Unmarshal(content, &manifest), "web/package.json n'est pas du JSON")

	version, declared := manifest.Dependencies[contractPackage]
	require.Truef(t, declared, "web/package.json ne dépend plus de %s", contractPackage)

	// L'épinglage est exact, sans préfixe de plage — c'est ce que `minimumReleaseAgeStrict` exige pour
	// refuser une version fraîche au lieu de reculer en silence. Un `^` apparu ici rendrait la
	// comparaison ci-dessus fausse plutôt que rouge.
	require.Regexpf(t, `^\d+\.\d+\.\d+$`, version,
		"%s n'est plus épinglé en version exacte (%s)", contractPackage, version)

	return version
}
