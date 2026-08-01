package gateway_test

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Le contrat de l'API Admin est consommé depuis `@martialanouman/gateway-api-contracts`, où la
// génération le lit sous `web/node_modules/`. Une copie déposée dans le dépôt devient une seconde
// source de vérité : elle ne bouge plus quand le contrat est republié, et la génération produit dès
// lors un client conforme à une version fantôme, sans que rien ne rougisse.
//
// Ce qui est refusé est le contrat **de la passerelle**, reconnu à ce qu'il déclare et non à son
// nom : une copie renommée déclare toujours les mêmes opérations. La distinction avec ce qui est
// légitime tient au même endroit — `api/openapi-bff.yaml`, le contrat du BFF que nous écrivons,
// décrit les routes du BFF, et l'overlay OpenAPI déposé sous `api/` ne contient que des actions de
// patch. Ni l'un ni l'autre ne déclare les opérations du plan de contrôle de la passerelle.
type contract struct {
	npmFile    string
	signatures []signature
}

// declaration est une ligne de mapping YAML : une clé seule, ou une clé et sa valeur.
type declaration struct{ key, value string }

// signature est un fragment du contrat qui ne compte que si **toutes** ses déclarations sont
// présentes. L'operationId seul ne prouverait rien : le BFF relaie le même plan de contrôle et
// nommera ses opérations dans la même langue — `list-customers` figurera dans son contrat, sous ses
// chemins à lui. Le couple chemin + operationId, lui, n'appartient qu'à la passerelle.
//
// La moitié chemin de la signature, elle, n'est pas falsifiable : aucun document légitime ne déclare
// un chemin `/admin/…`, donc aucun test ne rougit si on la retire — vérifié en la retirant. Elle
// reste parce qu'elle ne coûte rien et que le jour où elle servira — un contrat du BFF qui reprendrait
// les chemins de la passerelle — personne ne pensera à la rajouter.
type signature []declaration

func operation(path, operationID string) signature {
	return signature{{key: path}, {key: "operationId", value: operationID}}
}

// Signatures relevées dans le paquet npm (`web/node_modules/@martialanouman/gateway-api-contracts`,
// contrat 1.2.0).
var gatewayContracts = []contract{
	{
		npmFile: "openapi-admin.yaml",
		signatures: []signature{
			operation("/admin/customers", "list-customers"),
			operation("/admin/customers/{id}/suspend", "suspend-customer"),
			operation("/admin/smpp-accounts", "list-smpp-accounts"),
			operation("/admin/smpp-accounts/{id}/credentials/{credId}/rotate", "rotate-credential"),
			operation("/admin/connectors/{id}/rebind", "rebind-connector"),
			operation("/admin/routes/reorder", "reorder-routes"),
			operation("/admin/exact-routes/lookup", "lookup-exact-route"),
			{{key: "title", value: "SMS Gateway — Admin API"}},
		},
	},
	{
		npmFile: "openapi-public.yaml",
		signatures: []signature{
			operation("/messages", "submit-messages"),
			operation("/messages/{id}", "get-message"),
			operation("/account", "get-account"),
			{{key: "title", value: "SMS Gateway — Public API"}},
			{{key: "url", value: "https://api.gateway.example.com/v1"}},
		},
	},
}

// copiedIn rend le nombre de signatures trouvées, et dit si le fichier reproduit le contrat. Le
// seuil est la moitié parce que les deux populations sont séparées par un fossé : une copie porte
// toutes les signatures, un document écrit ici n'en porte aucune. Il laisse le contrat évoluer —
// quelques opérations renommées en amont ne suffisent pas à faire passer une copie pour un document
// neuf.
func (c contract) copiedIn(declarations map[declaration]bool) (int, bool) {
	matched := 0

	for _, sig := range c.signatures {
		if sig.declaredIn(declarations) {
			matched++
		}
	}

	return matched, matched > 0 && 2*matched >= len(c.signatures)
}

func (s signature) declaredIn(declarations map[declaration]bool) bool {
	for _, d := range s {
		if !declarations[d] {
			return false
		}
	}

	return true
}

// declarationsIn relève ce qu'un fichier déclare, ligne par ligne. C'est la ligne entière qui sépare
// une déclaration d'une mention, et elle le fait sans qu'aucun cas particulier ait à être écrit :
// une citation garde la syntaxe qui l'entoure — `#`, `//`, un guillemet, une virgule — et cette
// syntaxe entre dans la clé, qui cesse alors d'égaler celle du contrat. Une recherche de la chaîne
// dans le texte, elle, confondrait les deux.
func declarationsIn(content string) map[declaration]bool {
	declarations := make(map[declaration]bool)

	for raw := range strings.SplitSeq(content, "\n") {
		// Un élément de liste déclare comme le reste : c'est sous cette forme qu'un contrat annonce
		// l'URL de ses serveurs.
		line := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(raw), "- "))

		if key, value, declares := cutKey(line); declares {
			declarations[declaration{key: key, value: value}] = true
		}
	}

	return declarations
}

func cutKey(line string) (key, value string, declares bool) {
	key, rest, found := strings.Cut(line, ":")
	// En YAML, le `:` qui porte une clé est suivi d'un espace ou termine la ligne. Sans cette
	// exigence, `https://exemple.test/x` cité dans une prose déclarerait une clé `https`.
	if !found || (rest != "" && !strings.HasPrefix(rest, " ")) {
		return "", "", false
	}

	value = strings.TrimSpace(rest)
	// Un commentaire de fin de ligne n'est pas une valeur : la ligne ne déclare alors que sa clé.
	// C'est ce qu'une copie relue à la main porte sur ses chemins.
	if strings.HasPrefix(value, "#") {
		value = ""
	}

	return key, value, true
}

func TestNoGatewayContractIsCopiedIntoTheRepository(t *testing.T) {
	t.Parallel()

	root := repositoryRoot(t)

	for _, path := range trackedFiles(t, root) {
		content, err := os.ReadFile(filepath.Join(root, path))
		if errors.Is(err, os.ErrNotExist) {
			// Suppression déjà indexée, lien symbolique cassé : l'index nomme un fichier que l'arbre
			// de travail n'a plus.
			continue
		}

		require.NoErrorf(t, err, "lecture de %s", path)

		declarations := declarationsIn(string(content))

		for _, gatewayContract := range gatewayContracts {
			matched, copied := gatewayContract.copiedIn(declarations)

			assert.Falsef(t, copied,
				"%s reproduit %s : %d signatures du contrat de la passerelle sur %d. Ce dépôt "+
					"consomme le contrat depuis @martialanouman/gateway-api-contracts et ne le copie "+
					"jamais — une copie ne suit plus les republications, et la génération produit alors "+
					"un client conforme à une version que plus personne ne sert. Supprimer ce fichier et "+
					"lire le YAML sous web/node_modules/ ; ce qui manque au contrat se corrige par une PR "+
					"dans go-gateway/api/.",
				path, gatewayContract.npmFile, matched, len(gatewayContract.signatures))
		}
	}
}

// Les fichiers suivis par git sont la bonne population : une copie posée dans un arbre de travail
// n'engage personne, une copie indexée engage tout le monde.
func trackedFiles(t *testing.T, root string) []string {
	t.Helper()

	list := exec.Command("git", "-C", root, "ls-files", "-z")
	list.Stderr = os.Stderr

	out, err := list.Output()
	require.NoError(t, err, "énumération des fichiers suivis par git")

	var files []string

	// `-z` plutôt que des lignes : git échappe et guillemette les noms exotiques dès qu'il écrit du
	// texte, et un nom échappé ne s'ouvre plus.
	for entry := range strings.SplitSeq(string(out), "\x00") {
		if entry != "" {
			files = append(files, entry)
		}
	}

	require.Contains(t, files, "go.mod",
		"l'énumération ne trouve pas le dépôt : une liste vide ou étrangère rendrait cette porte "+
			"verte sans avoir rien lu")

	return files
}

// git rend la racine depuis n'importe quel répertoire de l'arbre, là où remonter des `..` depuis le
// répertoire du test coderait la profondeur de ce package.
func repositoryRoot(t *testing.T) string {
	t.Helper()

	show := exec.Command("git", "rev-parse", "--show-toplevel")
	show.Stderr = os.Stderr

	root, err := show.Output()
	require.NoError(t, err, "racine du dépôt introuvable")

	return strings.TrimSpace(string(root))
}

// Ces cas prouvent le discriminant, pas la fidélité des signatures au contrat publié : celle-là ne
// se vérifie qu'en déposant une copie réelle du paquet npm dans le dépôt et en regardant la porte
// tomber. C'est à refaire à la main quand le contrat change de version majeure.
//
// Les documents sont rendus à partir du même tableau plutôt qu'écrits en clair : un YAML de contrat
// recopié dans un littéral de ce fichier ferait tomber la porte ci-dessus sur ce fichier-ci, et
// l'exempter creuserait exactement le trou que la porte existe pour fermer.
func TestACopyIsRecognizedByWhatItDeclares(t *testing.T) {
	t.Parallel()

	admin := gatewayContracts[0]

	t.Run("reconnaît une copie, quel que soit son nom", func(t *testing.T) {
		t.Parallel()

		matched, copied := admin.copiedIn(declarationsIn(yamlDeclaring(admin.signatures...)))

		assert.Truef(t, copied, "%d signatures sur %d n'ont pas suffi à reconnaître le contrat",
			matched, len(admin.signatures))
	})

	t.Run("reconnaît une copie dont le contrat a bougé en amont", func(t *testing.T) {
		t.Parallel()

		// Trois opérations renommées à la publication suivante : la copie reste une copie.
		_, copied := admin.copiedIn(declarationsIn(yamlDeclaring(admin.signatures[3:]...)))

		assert.True(t, copied)
	})

	t.Run("reconnaît une copie annotée à la main", func(t *testing.T) {
		t.Parallel()

		matched, copied := admin.copiedIn(declarationsIn(annotated(yamlDeclaring(admin.signatures...))))

		assert.Truef(t, copied, "%d signatures sur %d : un commentaire de fin de ligne suffit à faire "+
			"passer une copie pour un document neuf", matched, len(admin.signatures))
	})

	t.Run("laisse passer le contrat du BFF, qui nomme les mêmes opérations", func(t *testing.T) {
		t.Parallel()

		// Le BFF relaie le plan de contrôle : son contrat reprendra le vocabulaire du domaine, et
		// jusqu'aux operationId, sous ses propres chemins. C'est le document dont il ne faut pas
		// interdire l'écriture.
		bff := yamlDeclaring(
			signature{{key: "title", value: "Tableau de bord — BFF"}},
			operation("/api/customers", "list-customers"),
			operation("/api/customers/{id}/suspend", "suspend-customer"),
			operation("/api/smpp-accounts", "list-smpp-accounts"),
			operation("/api/smpp-accounts/{id}/credentials/{credId}/rotate", "rotate-credential"),
			operation("/api/connectors/{id}/rebind", "rebind-connector"),
			operation("/api/routes/reorder", "reorder-routes"),
			operation("/api/exact-routes/lookup", "lookup-exact-route"),
			operation("/api/messages/{id}", "get-message"),
		)

		for _, gatewayContract := range gatewayContracts {
			matched, copied := gatewayContract.copiedIn(declarationsIn(bff))

			assert.Falsef(t, copied, "le contrat du BFF est refusé (%d/%d contre %s) : la porte "+
				"interdit d'écrire le contrat qu'elle est censée protéger",
				matched, len(gatewayContract.signatures), gatewayContract.npmFile)
		}
	})

	t.Run("laisse passer un document qui cite le contrat", func(t *testing.T) {
		t.Parallel()

		_, copied := admin.copiedIn(declarationsIn(commentedOut(yamlDeclaring(admin.signatures...))))

		assert.False(t, copied, "un document qui cite le contrat en commentaire — une fiche de step, "+
			"un overlay annoté — est accusé de le copier")
	})
}

// Les deux mécanismes de `cutKey` que le verdict d'une copie ne fait pas tomber à lui seul.
func TestALineDeclaresWhatItCarries(t *testing.T) {
	t.Parallel()

	t.Run("relève une clé portée par un élément de liste", func(t *testing.T) {
		t.Parallel()

		declarations := declarationsIn("servers:\n  - url: https://api.gateway.example.com/v1")

		assert.Contains(t, declarations,
			declaration{key: "url", value: "https://api.gateway.example.com/v1"},
			"l'URL d'un serveur est un élément de liste : la rater, c'est perdre une signature")
	})

	t.Run("ne prend pas une URL citée en prose pour une clé", func(t *testing.T) {
		t.Parallel()

		assert.Empty(t, declarationsIn("Le contrat vit sur https://exemple.test/contrat"))
	})
}

func yamlDeclaring(signatures ...signature) string {
	var document strings.Builder

	document.WriteString("openapi: 3.1.0\n")

	for _, sig := range signatures {
		for _, d := range sig {
			document.WriteString("  " + d.key + ":")

			if d.value != "" {
				document.WriteString(" " + d.value)
			}

			document.WriteString("\n")
		}
	}

	return document.String()
}

// annotated met le document dans l'état où une relecture humaine le laisse : un commentaire en bout
// des lignes qui ne portent qu'une clé.
func annotated(document string) string {
	var relu strings.Builder

	for line := range strings.SplitSeq(document, "\n") {
		if strings.HasSuffix(line, ":") {
			line += "   # relu le 12/03"
		}

		relu.WriteString(line + "\n")
	}

	return relu.String()
}

func commentedOut(document string) string {
	var quoted strings.Builder

	for line := range strings.SplitSeq(document, "\n") {
		quoted.WriteString("# " + line + "\n")
	}

	return quoted.String()
}
