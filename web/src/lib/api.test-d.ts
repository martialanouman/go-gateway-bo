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

/**
 * `POST /api/auth/login` — step-021. Ce que l'écran de connexion (step-027) tiendra pour vrai.
 *
 * La raison d'écrire ces quatre assertions plutôt qu'une : le client doit traiter **quatre**
 * réponses, et trois sont des refus qui ne se ressemblent pas — l'un se réessaie tout de suite,
 * l'autre après un délai, le troisième jamais. Un client qui n'en connaîtrait que deux découvrirait
 * la troisième en production, sur l'écran de connexion, c'est-à-dire au pire endroit.
 */

type LoginOperation = paths['/auth/login']['post']

// Le corps envoyé. `toEqualTypeOf` : un champ ajouté au schéma doit rougir ici plutôt que d'être
// ignoré en silence par un formulaire qui ne le remplirait pas.
expectTypeOf<LoginOperation['requestBody']['content']['application/json']>().toEqualTypeOf<{
  email: string
  password: string
}>()

// Le challenge, rendu une seule fois. `expiresAt` est une chaîne : le contrat dit `date-time`, et
// `openapi-typescript` ne fabrique pas de `Date` — c'est au client de la lire.
expectTypeOf<LoginOperation['responses'][200]['content']['application/json']>().toEqualTypeOf<{
  challenge: string
  expiresAt: string
}>()

// Les trois refus partagent la même forme. C'est ce qui interdit au client de distinguer « adresse
// inconnue » de « mot de passe faux » : il n'y a rien dans le type qui le lui permette.
expectTypeOf<LoginOperation['responses'][401]['content']['application/json']>().toEqualTypeOf<{
  code: string
  message: string
}>()

// Les quatre statuts, et le 400 en fait partie : login est la première opération à porter un corps,
// donc la première dont le décodage peut échouer avant d'atteindre le handler.
expectTypeOf<keyof LoginOperation['responses']>().toEqualTypeOf<200 | 400 | 401 | 429>()

/**
 * `GET /api/auth/me` — step-022. Le **seul** endroit d'où le client apprend ses droits.
 *
 * Deux assertions portent tout le poids : la première dit que les permissions sont une liste plate
 * de chaînes, la seconde qu'aucun rôle n'accompagne le corps. C'est cette absence qui empêche
 * step-040 de réintroduire un contrôle de rôle côté client — un champ `roles` ici, et le `if` qui
 * s'en sert s'écrit tout seul le mois suivant.
 */

type MeOperation = paths['/auth/me']['get']

// `permissions` est `string[]` et non une union des 44 clés : le catalogue vit dans
// `permissions.gen.ts`, engendré depuis `internal/permissions`. C'est au client de croiser les deux,
// et le type `PermissionKey` est là pour ça.
expectTypeOf<MeOperation['responses'][200]['content']['application/json']>().toEqualTypeOf<{
  operator: { id: string; email: string; displayName: string }
  permissions: string[]
  elevated: boolean
  expiresAt: string
}>()

// Deux statuts seulement. Le client n'a que deux cas à traiter : il est connecté, ou il ne l'est
// plus — et la seconde branche mène à l'écran de connexion, sans qu'il ait à savoir pourquoi.
expectTypeOf<keyof MeOperation['responses']>().toEqualTypeOf<200 | 401>()

/**
 * `POST /api/auth/logout` — step-022. Un seul statut, et c'est ce que le client doit savoir : il n'y
 * a pas de branche « la déconnexion a échoué » à écrire, pas même quand la session n'existait plus.
 */

type LogoutOperation = paths['/auth/logout']['post']

expectTypeOf<keyof LogoutOperation['responses']>().toEqualTypeOf<204>()

// Aucun corps à envoyer : rien à composer, donc rien à oublier de composer.
expectTypeOf<LogoutOperation['requestBody']>().toEqualTypeOf<undefined>()
