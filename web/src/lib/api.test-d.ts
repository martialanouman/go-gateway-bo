import { expectTypeOf } from 'vitest'
import type { paths } from './api.gen'

/**
 * Ce que le client tiendra pour vrai de `GET /api/health`, écrit à la main et confronté aux types
 * qu'`openapi-typescript` dérive d'`api/openapi-bff.yaml`.
 *
 * **Aucun runner n'exécute ce fichier.** `expectTypeOf` ne produit rien à l'exécution : ses
 * assertions sont des contraintes de type, et c'est `tsc --noEmit` — la cible `typecheck-web`, le job
 * « Typecheck client » — qui les juge. Le nom en `.test-d.ts` le dit et le rend vrai : le `include`
 * de `vitest.config.ts` vaut `**\/*.test.{ts,tsx}` et ne l'attrape pas, là où le `include: ["src"]`
 * de `tsconfig.json` l'attrape. Mesuré dans les deux sens — `pnpm test` ne le liste pas, `pnpm
 * typecheck` rougit quand une assertion est fausse.
 *
 * Ce que ça prouve : qu'une évolution du contrat qui change la forme de cette opération est **lue**
 * par quelqu'un plutôt que traversée en silence. Ce que ça ne prouve pas : que le BFF sert bien cette
 * forme — c'est le scénario godog qui valide la réponse HTTP réelle contre le YAML (DN-9), et rien
 * ici ne touche au réseau.
 *
 * Les clés de `paths` sont **relatives à `servers.url`** : `/health`, jamais `/api/health`. Le
 * préfixe appartient à l'adresse de base que le client posera le jour où il en instanciera un.
 */

type HealthOperation = paths['/health']['get']
type HealthBody = HealthOperation['responses'][200]['content']['application/json']

// Le corps que le client recevra. `toEqualTypeOf` et non `toExtend` : un champ ajouté au schéma doit
// rougir ici, sans quoi la porte ne dit plus rien de ce que la réponse contient. L'égalité stricte
// couvre aussi l'enum et l'obligation — mesuré, chacune des trois mutations la fait tomber sur cette
// ligne : champ ajouté (`TS2741: Property 'uptime_seconds' is missing`), `enum: [ok]` retiré
// (`Actual: string`), `required: [status]` retiré (`Actual: undefined`). Une assertion séparée sur
// `status` a donc été écrite puis **retirée** : aucune mutation ne la faisait tomber seule.
expectTypeOf<HealthBody>().toEqualTypeOf<{ status: 'ok' }>()

// 200 est la **seule** réponse déclarée. Le jour où la sonde de disponibilité de step-186 ajoutera un
// 503, le client devra le traiter : cette ligne l'oblige à passer par ici plutôt qu'à le découvrir à
// l'exécution.
expectTypeOf<keyof HealthOperation['responses']>().toEqualTypeOf<200>()

// Une sonde de vivacité ne prend ni corps ni paramètre. Un contrat qui lui en donnerait un sans que
// personne ne le remarque ferait de cet appel une requête que le client n'écrit nulle part.
expectTypeOf<HealthOperation['requestBody']>().toEqualTypeOf<undefined>()
expectTypeOf<HealthOperation['parameters']['query']>().toEqualTypeOf<undefined>()
