// Command zodgen engendre les schémas Zod que les formulaires du client opposent à leur saisie, à
// partir des corps de requête d'`api/openapi-bff.yaml`.
//
// **Pourquoi engendrer plutôt qu'écrire.** `openapi-typescript` rend la forme et **jette les
// contraintes** : `LoginRequest` sort en `{ email: string; password: string }`, quand le contrat
// déclare `email.maxLength: 320` et `password.maxLength: 4096`. Le serveur les redit déjà à la main —
// rien dans ce dépôt ne valide une requête à l'exécution contre le YAML — et une troisième rédaction
// dériverait de la première comme la deuxième a failli le faire. Ici, un `maxLength` abaissé dans le
// YAML change la sortie, donc le test.
//
// **Les corps de requête, et eux seuls.** Un schéma de réponse n'a rien à valider : le client le
// reçoit, il ne le compose pas. Les engendrer tous ferait du code sans consommateur que
// `check-generated` forcerait à maintenir à vie.
//
// Le chemin du contrat comme celui de la sortie sont des **arguments** : le Makefile les tient déjà
// dans `$(CONTRACT_BFF)` et `$(CONTRACT_ZOD)`, et les écrire ici les ferait exister à deux endroits
// qui se croient d'accord. Même arbitrage, et mêmes raisons, que `cmd/permissionsgen`.
package main

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/getkin/kin-openapi/openapi3"
)

const usage = "usage : zodgen <contrat OpenAPI> <module TypeScript à écrire>"

func main() {
	// os.Exit reste seul dans main : appelé depuis start, il court-circuiterait son `defer`.
	if err := start(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func start(args []string) error {
	if len(args) != 2 {
		return errors.New("zodgen prend exactement deux arguments.\n" + usage)
	}

	doc, err := loadFile(args[0])
	if err != nil {
		return err
	}

	rendered, err := render(doc)
	if err != nil {
		return err
	}

	// 0644 comme les autres sorties engendrées du dépôt : un fichier source commité, que la CI relit
	// et que le build consomme — pas un secret.
	//nolint:gosec // G306 : voir juste au-dessus.
	if err := os.WriteFile(args[1], rendered, 0o644); err != nil {
		return fmt.Errorf("écrire %s : %w", args[1], err)
	}

	return nil
}

func loadFile(path string) (*openapi3.T, error) {
	doc, err := openapi3.NewLoader().LoadFromFile(path)
	if err != nil {
		return nil, fmt.Errorf("lire le contrat %s : %w", path, err)
	}

	return doc, nil
}

func load(data []byte) (*openapi3.T, error) {
	doc, err := openapi3.NewLoader().LoadFromData(data)
	if err != nil {
		return nil, fmt.Errorf("lire le contrat : %w", err)
	}

	return doc, nil
}

const header = `/**
 * Ce fichier est engendré à partir des corps de requête d'api/openapi-bff.yaml, qui fait foi. Le
 * modifier à la main n'a aucun effet durable : la génération suivante l'écrase.
 *
 * Ce qu'il porte sont les **bornes du contrat**, celles qu'openapi-typescript jette en ne gardant
 * que la forme. Ce qui ne décrit aucun contrat — un format d'adresse, deux champs qui concordent —
 * s'écrit à la main, à côté du formulaire qui l'exige.
 *
 * Le régénérer :   make generate
 * Ou directement : go run ./cmd/zodgen api/openapi-bff.yaml web/src/lib/contract.gen.ts
 */

import { z } from 'zod'
`

// render rend le module. Les schémas sortent par ordre alphabétique et non dans l'ordre du contrat :
// déplacer une opération dans le YAML réécrirait sinon tout le fichier engendré, et le diff de la PR
// cesserait de nommer ce qui a changé.
//
// **Aucun repli de ligne n'est implémenté, et rien ne le garde.** La sortie est **incluse** dans le
// périmètre de Biome — contrairement à `api.gen.ts` — et Biome reporte à la ligne toute propriété
// qui dépasse 100 colonnes. La plus longue d'aujourd'hui en fait 55. Un enum du contrat assez large
// pour franchir le seuil rendrait donc `lint-web` et `check-generated` contradictoires, chacune
// exigeant l'inverse de l'autre. Vérifié plutôt que supposé : `biome check` accepte la sortie
// courante telle quelle. Le remède, le jour venu, est d'exclure ce fichier dans `web/biome.json`
// comme `api.gen.ts` l'est — pas d'implémenter le repli, que `cmd/permissionsgen` a payé cher.
func render(doc *openapi3.T) ([]byte, error) {
	var out strings.Builder

	out.WriteString(header)

	for _, name := range requestBodySchemas(doc) {
		schema := doc.Components.Schemas[name]
		if schema == nil {
			return nil, fmt.Errorf("le corps de requête %s ne renvoie à aucun schéma de components", name)
		}

		if err := writeSchema(&out, name, schema.Value); err != nil {
			return nil, err
		}
	}

	return []byte(out.String()), nil
}

// requestBodySchemas rend les noms des schémas qu'au moins un corps de requête JSON référence, une
// fois chacun et triés.
//
// La sélection est **mécanique** — parcourir les opérations — et non une liste de noms tenue à la
// main : une liste demanderait d'y penser à chaque route posée, et l'oubli livrerait un formulaire
// dont les bornes ne sont nulle part, sans que rien ne rougisse.
func requestBodySchemas(doc *openapi3.T) []string {
	seen := map[string]bool{}

	for _, item := range doc.Paths.Map() {
		for _, operation := range item.Operations() {
			if operation.RequestBody == nil || operation.RequestBody.Value == nil {
				continue
			}

			media := operation.RequestBody.Value.Content.Get("application/json")
			if media == nil || media.Schema == nil {
				continue
			}

			// Le corps déclaré **en ligne** est ignoré plutôt que rendu sous un nom inventé : le
			// contrat de ce dépôt les nomme tous, et fabriquer un nom ferait un module dont les
			// exports changeraient au premier renommage d'opération.
			if name, named := strings.CutPrefix(media.Schema.Ref, "#/components/schemas/"); named {
				seen[name] = true
			}
		}
	}

	names := make([]string, 0, len(seen))
	for name := range seen {
		names = append(names, name)
	}

	sort.Strings(names)

	return names
}

func writeSchema(out *strings.Builder, name string, schema *openapi3.Schema) error {
	fmt.Fprintf(out, "\nexport const %s = z.object({\n", name)

	required := map[string]bool{}
	for _, field := range schema.Required {
		required[field] = true
	}

	fields := make([]string, 0, len(schema.Properties))
	for field := range schema.Properties {
		fields = append(fields, field)
	}

	sort.Strings(fields)

	for _, field := range fields {
		expression, err := zodFor(schema.Properties[field].Value)
		if err != nil {
			return fmt.Errorf("%s.%s : %w", name, field, err)
		}

		if !required[field] {
			expression += ".optional()"
		}

		fmt.Fprintf(out, "  %s: %s,\n", field, expression)
	}

	out.WriteString("})\n")

	return nil
}

// zodFor rend l'expression Zod d'une propriété, ou **refuse**.
//
// Le refus est la moitié qui compte. Un type que ce générateur ne sait pas rendre — un tableau, un
// nombre borné, un objet imbriqué — sortirait autrement en `z.unknown()` : un schéma qui accepte
// tout, vert à l'exécution, et qui ne garde plus rien. C'est le mode d'échec d'un générateur
// partiel, et il est muet. La step qui ajoutera au contrat un type absent d'ici l'apprendra de
// `make generate`, pas d'un formulaire qui laisse passer.
func zodFor(schema *openapi3.Schema) (string, error) {
	if schema == nil {
		return "", errors.New("propriété sans schéma")
	}

	if len(schema.Enum) > 0 {
		return enumExpression(schema.Enum)
	}

	switch {
	case schema.Type.Is("string"):
		return stringExpression(schema), nil

	// L'objet **libre** du contrat — `assertion`, `attestation` — traverse sans que ses clés soient
	// décrites : leur forme appartient à la spécification WebAuthn, et c'est la bibliothèque qui
	// l'analyse. Un objet aux propriétés déclarées, lui, tombe dans le refus ci-dessous : le rendre
	// demanderait la récursion, qu'aucun corps de requête n'exige aujourd'hui.
	case schema.Type.Is("object") && schema.AdditionalProperties.Has != nil && *schema.AdditionalProperties.Has:
		return "z.record(z.string(), z.unknown())", nil
	}

	return "", fmt.Errorf(
		"type %v que zodgen ne sait pas rendre — l'ajouter à zodFor plutôt que le laisser passer",
		schema.Type,
	)
}

func stringExpression(schema *openapi3.Schema) string {
	expression := "z.string()"

	if schema.MinLength != 0 {
		expression += fmt.Sprintf(".min(%d)", schema.MinLength)
	}

	if schema.MaxLength != nil {
		expression += fmt.Sprintf(".max(%d)", *schema.MaxLength)
	}

	return expression
}

func enumExpression(values []any) (string, error) {
	members := make([]string, 0, len(values))

	for _, value := range values {
		member, ok := value.(string)
		if !ok {
			return "", fmt.Errorf("valeur d'enum %v qui n'est pas une chaîne", value)
		}

		// Le contrat n'en porte aucune, et une apostrophe casserait le littéral en silence : elle
		// refermerait la chaîne et laisserait un fichier soit inanalysable, soit porteur d'une autre
		// valeur. Le même arbitrage que `forbiddenInLiteral` de `cmd/permissionsgen`.
		if strings.ContainsAny(member, "'\\\n\r") {
			return "", fmt.Errorf("valeur d'enum %q qu'un littéral TypeScript ne porte pas telle quelle", member)
		}

		members = append(members, "'"+member+"'")
	}

	return "z.enum([" + strings.Join(members, ", ") + "])", nil
}
