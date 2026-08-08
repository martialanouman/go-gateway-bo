package gateway_test

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/bddtest"
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
	npmFile string
	// identity nomme le **document**, là où les signatures nomment ses opérations : son titre, l'URL
	// de son serveur. Elle n'entre pas dans le décompte, elle le conditionne — voir copiedIn.
	identity   []signature
	signatures []signature
}

// declaration est une ligne de mapping YAML : une clé seule, ou une clé et sa valeur.
type declaration struct{ key, value string }

// signature est un fragment du contrat qui ne compte que si **toutes** ses déclarations sont
// présentes. L'operationId seul ne prouverait rien : le BFF relaie le même plan de contrôle et
// nommera ses opérations dans la même langue — `list-customers` figurera dans son contrat, sous ses
// chemins à lui. Le couple chemin + operationId, lui, n'appartient qu'à la passerelle.
//
// La moitié chemin de la signature ne discrimine que du côté Admin : aucun document légitime ne
// déclare un chemin `/admin/…`, et aucun test ne rougit si on la retire — re-vérifié le 02/08/2026
// en la retirant, suite du package entièrement verte. Elle reste parce qu'elle ne coûte rien et que
// le jour où elle servira — un contrat du BFF qui reprendrait les chemins de la passerelle —
// personne ne pensera à la rajouter.
//
// Du côté public elle ne discrimine **rien** : `/messages` et `/account` sont les chemins de
// n'importe quel document dont les clés sont relatives à un `servers.url`. C'est `identity` qui y
// porte le verdict.
type signature []declaration

func operation(path, operationID string) signature {
	return signature{{key: path}, {key: "operationId", value: operationID}}
}

// Signatures relevées dans le paquet npm (`web/node_modules/@martialanouman/gateway-api-contracts`,
// contrat **2.5.0**), le 02/08/2026, en extrayant les couples chemin + operationId des deux YAML.
// **Re-vérifiées sur le contrat 4.0.2 le 08/08/2026** (step-009, deux majeures) : les 28 signatures
// Admin et les 7 du contrat public sont intactes — les deux majeures n'ont ajouté, retiré ni renommé
// aucune opération. Elles n'ont plus à l'être à la main, voir
// TestTheSampleStillMatchesTheContractItWasTakenFrom.
//
// L'échantillon est large parce que c'est **lui** qui sépare les deux populations, et non le seuil.
// Mesuré : à sept opérations, une fiche de step qui en citait quatre dans un bloc clôturé était
// refusée par la porte (4 sur 8, soit la moitié). À vingt-sept, il faut en citer quatorze, avec leur
// chemin exact, pour être accusé de copier — ce qu'aucun document de conception ne fait, et ce
// qu'une copie fait par construction. Elles couvrent les dix domaines du plan de contrôle : un
// contrat amputé d'un domaine reste très au-dessus du seuil.
//
// Ce raisonnement tient pour le contrat Admin et **pas** pour le contrat public, parce qu'il repose
// sur la moitié chemin de la signature : aucun document que nous écrivons ne déclare un chemin
// `/admin/…`. Le contrat public, lui, n'a que cinq opérations, et leurs chemins sont ceux que prend
// n'importe quel document OpenAPI dont les clés sont relatives à son `servers.url` — `/health`,
// `/messages`, `/messages/{id}`, `/account`. Mesuré le 02/08/2026 : un `api/openapi-bff.yaml`
// plausible, servi sous `servers: [{url: /api}]`, rendait 5 signatures sur 7 et le verdict « copie ».
// La porte accusait donc le contrat du BFF de copier celui de la passerelle.
//
// D'où `identity` sur le contrat public : ses opérations ne le désignent pas, son titre et l'URL de
// son serveur si. Une copie les porte par construction — on copie un fichier, pas une liste
// d'opérations — et aucun document que nous écrivons ne les porte.
var gatewayContracts = []contract{
	{
		npmFile: "openapi-admin.yaml",
		signatures: []signature{
			operation("/admin/customers", "list-customers"),
			operation("/admin/customers/{id}/suspend", "suspend-customer"),
			operation("/admin/customer-groups/{id}/customers", "list-group-customers"),
			operation("/admin/customers/{id}/sender-ids/{senderId}", "update-sender-id"),
			operation("/admin/smpp-accounts", "list-smpp-accounts"),
			operation("/admin/smpp-accounts/{id}/credentials/{credId}/rotate", "rotate-credential"),
			operation("/admin/smpp-accounts/{id}/session-limits", "set-account-session-limits"),
			operation("/admin/smpp-accounts/{id}/sender-id-policy", "set-account-sender-id-policy"),
			operation("/admin/smpp-accounts/{id}/webhooks/{webhookId}", "update-webhook"),
			operation("/admin/connectors/{id}/rebind", "rebind-connector"),
			operation("/admin/connectors/{id}/reconnect-policy", "set-connector-reconnect-policy"),
			operation("/admin/connectors/{id}/bind-pool", "set-connector-bind-pool"),
			operation("/admin/routes/reorder", "reorder-routes"),
			operation("/admin/exact-routes/lookup", "lookup-exact-route"),
			operation("/admin/routing-scripts/{id}/publish", "publish-routing-script"),
			operation("/admin/routing-scripts/{id}/versions", "list-routing-script-versions"),
			operation("/admin/sessions/{id}", "disconnect-session"),
			operation("/admin/suppressions/check", "check-suppression"),
			operation("/admin/opt-out-keywords/{id}", "update-opt-out-keyword"),
			operation("/admin/inbound-numbers/{id}/keywords/{keywordId}", "update-inbound-keyword"),
			operation("/admin/sender-rewrite-rules/{id}/test", "test-sender-rewrite-rule"),
			operation("/admin/customers/{id}/billing/scope", "change-balance-scope"),
			operation("/admin/billing-providers/{id}/test-connection", "test-billing-provider"),
			operation("/admin/messages/{id}/content", "get-message-content"),
			operation("/admin/gdpr/erase/{jobId}", "get-gdpr-erase-job"),
			operation("/admin/messages/export/{jobId}", "get-message-export"),
			operation("/admin/stream/billing-alerts", "stream-billing-alerts"),
			{{key: "title", value: "SMS Gateway — Admin API"}},
		},
	},
	{
		npmFile: "openapi-public.yaml",
		identity: []signature{
			{{key: "title", value: "SMS Gateway — Public API"}},
			{{key: "url", value: "https://api.gateway.example.com/v1"}},
		},
		signatures: []signature{
			operation("/messages", "submit-messages"),
			operation("/messages", "list-messages"),
			operation("/messages/{id}", "get-message"),
			operation("/account", "get-account"),
			operation("/health", "health"),
		},
	},
}

// copiedIn rend le nombre de signatures trouvées, et dit si le fichier reproduit le contrat. Le
// seuil est la moitié de l'échantillon : il absorbe l'évolution du contrat — quelques opérations
// renommées en amont ne suffisent pas à faire passer une copie pour un document neuf — et c'est la
// taille de l'échantillon qui règle le reste, voir gatewayContracts.
func (c contract) copiedIn(declarations map[declaration]bool) (int, bool) {
	matched := 0

	for _, sig := range c.signatures {
		if sig.declaredIn(declarations) {
			matched++
		}
	}

	return matched, matched > 0 && 2*matched >= len(c.signatures) && c.identifiedIn(declarations)
}

// identifiedIn dit si le document se présente **comme** le contrat. Sans identité déclarée, tout
// document l'est : c'est le cas du contrat Admin, que ses chemins `/admin/…` désignent à eux seuls.
// Une seule marque suffit — un contrat republié peut changer l'URL de son serveur sans changer de
// titre, et l'inverse.
func (c contract) identifiedIn(declarations map[declaration]bool) bool {
	if len(c.identity) == 0 {
		return true
	}

	return slices.ContainsFunc(c.identity, func(s signature) bool { return s.declaredIn(declarations) })
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

	root := bddtest.RepositoryRoot(t)

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

// L'échantillon ci-dessus est une **copie du contrat**, à ceci près qu'elle n'en prend que
// trente-cinq lignes. Comme toute copie, elle ne suit pas les republications — et une signature qui
// a dérivé ne compte plus, ce qui rapproche le décompte du seuil sans que rien ne le dise. À
// l'extrême, un échantillon entièrement périmé rend la porte verte sur une vraie copie.
//
// Rien ne le voyait : les cas de TestACopyIsRecognizedByWhatItDeclares fabriquent leur YAML **depuis**
// l'échantillon (`yamlDeclaring(admin.signatures...)`), donc ils restent vrais quelle que soit sa
// dérive. Mesuré le 08/08/2026 pendant le bump vers 4.0.2, en remplaçant `reorder-routes` par un
// operationId inexistant : suite du package entièrement verte.
//
// Ce test est la moitié manquante. Il confronte l'échantillon au YAML que le paquet npm installe —
// la seule source qui bouge — et transforme en porte ce qui était une re-mesure à la main, « à
// refaire quand le contrat change de version majeure ». Il lit `web/node_modules/`, ce que ce package
// fait déjà pour lancer Prism.
//
// **Il vérifie les couples, pas les lignes.** `declaredIn` teste l'appartenance de chaque déclaration
// à un ensemble plat, donc rien n'y exige que le chemin et l'operationId appartiennent à la *même*
// opération : mesuré, `operation("/admin/customers", "suspend-customer")` — une paire qui n'existe
// dans aucun contrat — passait. C'est sans conséquence pour le verdict de copie, où les deux moitiés
// arrivent ensemble par construction ; c'en a une ici, où l'on juge la fidélité. Le couple se lit donc
// sur le document analysé, pas sur ses lignes.
//
// **Et il vérifie la taille.** Confronter les signatures présentes ne dit rien de celles qu'on
// retire, or c'est la taille de l'échantillon qui règle le seuil (voir gatewayContracts) : en
// retirer une abaisse la barre sans bruit. Mesuré : la suite restait verte.
func TestTheSampleStillMatchesTheContractItWasTakenFrom(t *testing.T) {
	t.Parallel()

	root := bddtest.RepositoryRoot(t)

	// Le décompte est écrit ici plutôt que dérivé : dérivé, il suivrait le rétrécissement qu'il doit
	// interdire. Le changer est une décision, et elle passe par cette ligne.
	require.Len(t, gatewayContracts[0].signatures, 28, "l'échantillon Admin a changé de taille")
	require.Len(t, gatewayContracts[1].signatures, 5, "l'échantillon public a changé de taille")
	require.Len(t, gatewayContracts[1].identity, 2, "le contrat public a perdu une marque d'identité")

	for _, gatewayContract := range gatewayContracts {
		path := filepath.Join(root, "web", "node_modules",
			"@martialanouman", "gateway-api-contracts", gatewayContract.npmFile)

		content, err := os.ReadFile(path)
		require.NoErrorf(t, err, "lecture de %s — il vient de pnpm : pnpm -C web install",
			gatewayContract.npmFile)

		declared := declarationsIn(string(content))
		operations := operationsDeclaredIn(t, path)

		// L'identité est vérifiée avec les signatures : c'est elle qui porte le verdict sur le contrat
		// public, donc une identité périmée y désarme la porte entièrement.
		for _, sig := range slices.Concat(gatewayContract.identity, gatewayContract.signatures) {
			matches := sig.declaredIn(declared)
			if operationPath, operationID, isOperation := sig.operation(); isOperation {
				matches = operations[operationPath+" "+operationID]
			}

			assert.Truef(t, matches,
				"%s ne déclare plus %v : l'échantillon a dérivé du contrat qu'il prélève. Chaque "+
					"signature perdue rapproche le décompte du seuil sans que rien ne le dise, et un "+
					"échantillon périmé rend la porte verte sur une vraie copie. Relever la signature "+
					"actuelle dans le YAML plutôt que de la retirer — la retirer rétrécit l'échantillon, "+
					"ce que gatewayContracts explique.",
				gatewayContract.npmFile, sig)
		}
	}
}

// operation rend le couple d'une signature bâtie par `operation()`, et dit si c'en est une. Les
// marques d'identité — un titre, une URL de serveur — n'en sont pas : elles se lisent à plat.
func (s signature) operation() (path, operationID string, ok bool) {
	for _, d := range s {
		switch {
		case d.key == "operationId":
			operationID = d.value
		case strings.HasPrefix(d.key, "/"):
			path = d.key
		}
	}

	return path, operationID, path != "" && operationID != ""
}

// operationsDeclaredIn rend les couples « chemin operationId » que le document déclare réellement,
// lus par l'analyseur OpenAPI plutôt que ligne à ligne. C'est la seule lecture structurelle de ce
// fichier, et elle est ici parce que la question posée est structurelle : deux lignes présentes ne
// font pas une opération.
func operationsDeclaredIn(t *testing.T, contractPath string) map[string]bool {
	t.Helper()

	document, err := (&openapi3.Loader{Context: t.Context()}).LoadFromFile(contractPath)
	require.NoErrorf(t, err, "analyse de %s", contractPath)

	declared := make(map[string]bool)

	for path, item := range document.Paths.Map() {
		for _, op := range item.Operations() {
			declared[path+" "+op.OperationID] = true
		}
	}

	return declared
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

// Ces cas prouvent le discriminant, pas la fidélité des signatures au contrat publié : celle-là ne se
// vérifie que contre les vrais YAML du paquet npm. Faite à la main le 02/08/2026 sur le contrat
// 2.5.0 — `openapi-admin.yaml` rendait 28 signatures sur 28, `openapi-public.yaml` 5 sur 5 et son
// identité, les deux verdicts à « copie ».
//
// Elle n'est plus à refaire à la main : TestTheSampleStillMatchesTheContractItWasTakenFrom l'exige à
// chaque suite, et signature par signature — donc plus strictement que le verdict, qui se contente de
// la moitié. Le rendre automatique était la seule façon de le rendre vrai : « à refaire quand le
// contrat change de version majeure » est un rituel, et un rituel ne rougit pas quand on l'oublie.
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

	// Le contrat du BFF n'a aucune raison de préfixer ses chemins : `servers.url` porte le préfixe, et
	// les clés de chemin sont **relatives** à lui. C'est la forme normale d'un document OpenAPI, et
	// c'est celle que prendra `api/openapi-bff.yaml` — un `/health` que step-004 prévoit, un
	// explorateur de messages, une page « mon compte ». Les cinq opérations du contrat public portent
	// exactement ces chemins-là.
	//
	// Mesuré le 02/08/2026, sur l'échantillon d'alors — sept signatures, titre et URL comptés avec les
	// opérations : 5 sur 7, verdict « copie », et 4 sur 7 en retirant `/account`, verdict « copie »
	// encore. La porte accusait donc le contrat du BFF de copier celui de la passerelle, et la sortie
	// qu'on prend sous pression est l'exemption par chemin.
	t.Run("laisse passer un contrat du BFF à chemins relatifs", func(t *testing.T) {
		t.Parallel()

		bff := yamlDeclaring(
			signature{{key: "title", value: "Tableau de bord — BFF"}},
			signature{{key: "url", value: "/api"}},
			operation("/health", "health"),
			operation("/messages", "list-messages"),
			operation("/messages", "submit-messages"),
			operation("/messages/{id}", "get-message"),
			operation("/account", "get-account"),
		)

		for _, gatewayContract := range gatewayContracts {
			matched, copied := gatewayContract.copiedIn(declarationsIn(bff))

			assert.Falsef(t, copied, "le contrat du BFF est refusé (%d/%d contre %s) : ses chemins sont "+
				"relatifs à son propre servers.url, et ses opérations s'écrivent comme celles de l'API "+
				"publique — /health, /messages, /account. Aucun document que nous écrivons ne porte "+
				"l'identité du contrat de la passerelle, et c'est elle qui doit faire le verdict",
				matched, len(gatewayContract.signatures), gatewayContract.npmFile)
		}
	})

	// L'autre moitié : le contrat public reste reconnu, chemins génériques compris. Une copie porte
	// l'identité du document copié — son titre, l'URL de son serveur — parce qu'on copie un fichier,
	// pas une liste d'opérations. **Une seule marque suffit**, et chacune est exercée seule : un
	// contrat republié peut changer l'URL de son serveur sans changer de titre, et l'inverse. Les
	// exiger toutes rendrait la porte verte sur une copie du lendemain.
	t.Run("reconnaît une copie du contrat public", func(t *testing.T) {
		t.Parallel()

		public := gatewayContracts[1]

		for _, marker := range public.identity {
			t.Run(marker[0].key, func(t *testing.T) {
				t.Parallel()

				document := yamlDeclaring(slices.Concat([]signature{marker}, public.signatures)...)

				matched, copied := public.copiedIn(declarationsIn(document))

				assert.Truef(t, copied, "%d signatures sur %d et la marque %q n'ont pas suffi à "+
					"reconnaître le contrat public", matched, len(public.signatures), marker[0].key)
			})
		}
	})

	t.Run("laisse passer un document qui cite le contrat", func(t *testing.T) {
		t.Parallel()

		_, copied := admin.copiedIn(declarationsIn(commentedOut(yamlDeclaring(admin.signatures...))))

		assert.False(t, copied, "un document qui cite le contrat en commentaire — une fiche de step, "+
			"un overlay annoté — est accusé de le copier")
	})

	t.Run("laisse passer une fiche de step qui cite les opérations qu'elle relaie", func(t *testing.T) {
		t.Parallel()

		// La forme que prend réellement une fiche : de la prose, et un bloc clôturé en Markdown. La
		// clôture **préserve** la syntaxe YAML — c'est tout son objet — donc les clés y sont relevées
		// telles quelles, et aucune marque de citation ne les distingue. Ce qui distingue une fiche
		// d'une copie n'est donc pas la forme des lignes mais leur nombre : elle en cite quelques-unes,
		// la copie les porte toutes.
		sheet := "# step-004 — relayer les clients\n\n" +
			"Cette step relaie six opérations du plan de contrôle :\n\n" +
			"```yaml\n" +
			yamlDeclaring(admin.signatures[:6]...) +
			"```\n\n" +
			"Hors périmètre : le reste du contrat.\n"

		matched, copied := admin.copiedIn(declarationsIn(sheet))

		assert.Falsef(t, copied, "une fiche de step qui cite %d opérations dans un bloc clôturé est "+
			"accusée de copier le contrat ; la sortie qu'on prendra sous pression est une exemption "+
			"par chemin, c'est-à-dire le trou que cette porte existe pour fermer", matched)
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
