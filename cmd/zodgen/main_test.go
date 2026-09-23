package main

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// Le contrat réduit à ce que le générateur doit traverser : un corps de requête, une référence
// nommée, et les deux bornes qui n'atteignent pas le client aujourd'hui.
const miniContract = `
openapi: 3.1.0
info: { title: mini, version: '1' }
paths:
  /auth/login:
    post:
      operationId: login
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/LoginRequest' }
      responses:
        '200': { description: ok }
components:
  schemas:
    LoginRequest:
      type: object
      additionalProperties: false
      properties:
        email:
          type: string
          maxLength: 320
        password:
          type: string
          minLength: 1
          maxLength: 4096
      required: [email, password]
`

func renderContract(t *testing.T, contract string) string {
	t.Helper()

	doc, err := load([]byte(contract))
	require.NoError(t, err)

	rendered, err := render(doc)
	require.NoError(t, err)

	return string(rendered)
}

func TestLesBornesDuContratTraversentDansLaSortie(t *testing.T) {
	rendered := renderContract(t, miniContract)

	require.Contains(t, rendered, "email: z.string().max(320),")
	require.Contains(t, rendered, "password: z.string().min(1).max(4096),")
}

// Le test que la fiche réclame, et la seule forme qui prouve quelque chose : la contrainte est
// **resserrée dans le YAML**, et c'est la sortie qu'on relit. Lire le générateur dirait seulement
// qu'il contient le mot `maxLength`.
func TestUneContrainteResserreeDansLeYamlChangeLaSortie(t *testing.T) {
	desserre := renderContract(t, miniContract)
	resserre := renderContract(t, strings.Replace(miniContract, "maxLength: 4096", "maxLength: 40", 1))

	require.Contains(t, desserre, ".max(4096)")
	require.NotContains(t, resserre, ".max(4096)")
	require.Contains(t, resserre, "password: z.string().min(1).max(40),")
}

// Le champ facultatif du contrat reste facultatif dans le schéma : le rendre obligatoire ferait
// refuser par le client une requête que le serveur accepte — un refus qui n'existe nulle part.
func TestUnChampAbsentDeRequiredEstFacultatif(t *testing.T) {
	rendered := renderContract(t, strings.Replace(miniContract, "required: [email, password]", "required: [email]", 1))

	require.Contains(t, rendered, "password: z.string().min(1).max(4096).optional(),")
}

func TestUnEnumDevientUneUnionDeValeurs(t *testing.T) {
	rendered := renderContract(t, strings.Replace(
		miniContract,
		"          maxLength: 320",
		"          enum: [totp, recovery_code]",
		1,
	))

	require.Contains(t, rendered, "email: z.enum(['totp', 'recovery_code']),")
}

// Un objet libre — `assertion` et `attestation` du contrat réel — traverse sans que ses clés soient
// décrites : leur forme appartient à la spécification WebAuthn.
func TestUnObjetLibreTraverseSansEtreDecrit(t *testing.T) {
	rendered := renderContract(t, strings.Replace(
		miniContract,
		"          type: string\n          maxLength: 320",
		"          type: object\n          additionalProperties: true",
		1,
	))

	require.Contains(t, rendered, "email: z.record(z.string(), z.unknown()),")
}

// **Le générateur refuse plutôt que de deviner.** Un type qu'il ne sait pas rendre — un nombre borné,
// un objet imbriqué — sortirait sinon en `z.unknown()` : un schéma qui accepte tout, vert à
// l'exécution, et qui ne garde plus rien. C'est le mode d'échec d'un générateur partiel, et
// il est muet.
func TestUnTypeQueLeGenerateurNeSaitPasRendreEstRefuse(t *testing.T) {
	doc, err := load([]byte(strings.Replace(miniContract, "type: string\n          maxLength: 320", "type: integer\n          maximum: 10", 1)))
	require.NoError(t, err)

	_, err = render(doc)
	require.ErrorContains(t, err, "email")
	require.ErrorContains(t, err, "LoginRequest")
}

// La garde du littéral, et elle n'est pas théorique : sans elle, l'apostrophe referme la chaîne et
// le fichier engendré n'est plus analysable — engendré **en silence**, puisque `make generate` rend
// 0 et que c'est `typecheck-web`, une porte plus loin, qui le découvre.
func TestUneApostropheDansUnEnumEstRefusee(t *testing.T) {
	doc, err := load([]byte(strings.Replace(
		miniContract,
		"          maxLength: 320",
		"          enum: [\"l'un\", autre]",
		1,
	)))
	require.NoError(t, err)

	_, err = render(doc)
	require.ErrorContains(t, err, "l'un")
}

// `start` est la seule porte d'entrée que le Makefile emprunte, et une invocation sans ses deux
// chemins indexerait hors bornes.
func TestZodgenRefuseUneInvocationSansSesDeuxChemins(t *testing.T) {
	require.ErrorContains(t, start([]string{"api/openapi-bff.yaml"}), "deux arguments")
	require.ErrorContains(t, start(nil), "deux arguments")
}

// Ce que le générateur cherche est le corps de requête, pas l'inventaire de `components.schemas` :
// engendrer les réponses ferait du code sans consommateur que `check-generated` forcerait à
// maintenir à vie.
func TestUnSchemaQuAucunCorpsDeRequeteNeReferenceEstIgnore(t *testing.T) {
	rendered := renderContract(t, miniContract+`
    Me:
      type: object
      properties:
        email: { type: string }
      required: [email]
`)

	require.NotContains(t, rendered, "Me")
}

// L'ordre vient de deux `map` — les schémas, puis les propriétés de chacun — et Go randomise leur
// parcours à chaque exécution. Sans les tris, cette sortie changerait d'un `make generate` à l'autre
// **sans que rien ne change dans le contrat** : `check-generated` rougirait au hasard, en CI, sur
// une PR qui n'a pas touché le YAML. Vingt rendus plutôt que deux : un seul tri retiré laisse encore
// une chance sur vingt-quatre de tomber juste.
func TestLaSortieNeDependPasDuParcoursDesMaps(t *testing.T) {
	doc, err := loadFile("../../api/openapi-bff.yaml")
	require.NoError(t, err)

	premier, err := render(doc)
	require.NoError(t, err)

	for range 20 {
		suivant, err := render(doc)
		require.NoError(t, err)
		require.Equal(t, string(premier), string(suivant))
	}
}

// Le contrat réel, et non l'échantillon : c'est lui que `make generate` traverse, et lui seul qui
// dit si les quatre corps de requête passent tous les cas que le générateur sait rendre.
func TestLeContratDuDepotEstEngendrableEnEntier(t *testing.T) {
	doc, err := loadFile("../../api/openapi-bff.yaml")
	require.NoError(t, err)

	rendered, err := render(doc)
	require.NoError(t, err)

	for _, schema := range []string{
		"LoginRequest", "MfaVerification", "TotpEnrollmentRequest", "WebauthnRegistration",
	} {
		require.Contains(t, string(rendered), "export const "+schema+" = z.object({")
	}
}

func TestUnTableauPorteSesElementsEtSaBorne(t *testing.T) {
	contract := strings.Replace(miniContract, "      required: [email, password]",
		"        roleIds:\n          type: array\n          maxItems: 100\n          items: { type: string, maxLength: 64 }\n      required: [email, password]", 1)

	require.Contains(t, renderContract(t, contract), "roleIds: z.array(z.string().max(64)).max(100).optional(),")
}
