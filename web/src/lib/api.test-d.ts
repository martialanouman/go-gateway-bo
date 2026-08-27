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
  secondFactors: { totp: boolean; recoveryCodesRemaining: number; passkeys: number }
  absoluteExpiresAt: string
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

/**
 * `POST /api/auth/mfa/totp/enroll` — step-023. Ce que l'écran d'enrôlement (step-028) dessinera.
 *
 * Les trois champs du 200 sont ce qui n'est **montré qu'une fois** : l'URI que le QR encodera, le
 * secret pour la saisie manuelle, et les dix codes de récupération. Aucune autre opération ne les
 * rend, et le type le dit — chercher `secret` ailleurs dans `paths` ne trouve rien.
 */

type EnrollOperation = paths['/auth/mfa/totp/enroll']['post']

// `otpauthUri` est une chaîne et non une image : le serveur ne dessine pas le QR, et c'est ce qui
// l'affranchit d'une bibliothèque de rendu.
expectTypeOf<EnrollOperation['responses'][200]['content']['application/json']>().toEqualTypeOf<{
  secret: string
  otpauthUri: string
  recoveryCodes: string[]
}>()

// Quatre statuts, et le 409 en fait partie : le client doit traiter « un second facteur est déjà en
// place » comme un cas normal — c'est celui d'un opérateur qui change de téléphone — et non comme une
// panne. Le découvrir à l'exécution ferait un toast d'erreur là où il faut une explication.
expectTypeOf<keyof EnrollOperation['responses']>().toEqualTypeOf<200 | 400 | 401 | 409>()

// Les deux champs sont **facultatifs**, et c'est ce que le type doit dire : un premier enrôlement n'a
// rien à prouver, un remplacement présente le facteur qu'il détruit. Le serveur exige qu'ils soient
// là tous les deux ou aucun ; le type ne sait pas l'exprimer, et c'est le 400 qui le tient.
expectTypeOf<EnrollOperation['requestBody']['content']['application/json']>().toEqualTypeOf<{
  method?: 'totp' | 'recovery_code'
  code?: string
}>()

/**
 * `POST /api/auth/mfa/verify` — step-023. Le second facteur, TOTP ou code de récupération.
 */

type VerifyOperation = paths['/auth/mfa/verify']['post']

// `method` est une union fermée et non une chaîne : un client qui inventerait une quatrième valeur
// rougit ici plutôt qu'au 400 du serveur.
//
// `code` et `assertion` sont **tous deux facultatifs**, et c'est ce que le type doit dire : une
// assertion de passkey n'a pas de code, un code TOTP n'a pas d'assertion. Le contrat ne sait pas
// exprimer deux champs qui s'excluent — c'est le serveur qui le tient, et son 400 qui le dit.
//
// `assertion` est `{ [key: string]: unknown }` et non `Record<string, never>` : la seconde forme est
// ce qu'`openapi-typescript` produit pour un `type: object` sans `additionalProperties`, et **aucune
// clé ne peut y être écrite**. Mesuré à l'écriture de step-024, avant qu'un écran n'en dépende.
expectTypeOf<VerifyOperation['requestBody']['content']['application/json']>().toEqualTypeOf<{
  challenge: string
  method: 'totp' | 'recovery_code' | 'webauthn'
  code?: string
  assertion?: { [key: string]: unknown }
}>()

// Aucun corps en retour sur le succès : ce que la session ouvre désormais se relit sur `/auth/me`,
// qui reste le seul endroit d'où le client apprend ses droits.
//
// Le 429 est le quatrième, et le client doit le distinguer du 401 : l'un dit « ce code ne convient
// pas », l'autre « arrêtez d'essayer pendant un quart d'heure ». Les confondre ferait boucler l'écran
// sur un formulaire qui ne peut plus rien accepter.
expectTypeOf<keyof VerifyOperation['responses']>().toEqualTypeOf<204 | 400 | 401 | 429>()

/**
 * `POST /api/auth/mfa/webauthn/*` — step-024. Les deux cérémonies de passkey.
 *
 * Ce que ces assertions tiennent que les autres ne tiennent pas : les options rendues sont **des DTO
 * déclarés champ par champ**, non le type de la bibliothèque serveur. Un bump qui ajouterait un champ
 * ne le ferait donc pas traverser jusqu'ici en silence — il rougirait sur ces lignes.
 */

type BeginRegistrationOperation = paths['/auth/mfa/webauthn/register/begin']['post']

// L'enveloppe `publicKey` est ce que `navigator.credentials.create()` attend : le client passe l'objet
// tel quel, sans le reconstruire.
expectTypeOf<
  BeginRegistrationOperation['responses'][200]['content']['application/json']['publicKey']
>().toEqualTypeOf<{
  rp: { id: string; name: string }
  user: { id: string; name: string; displayName: string }
  challenge: string
  pubKeyCredParams: { type: 'public-key'; alg: number }[]
  timeout?: number
  excludeCredentials?: { type: 'public-key'; id: string; transports?: string[] }[]
  authenticatorSelection?: { residentKey?: string; userVerification?: string }
}>()

// Le 409 en fait partie, et le client doit le traiter comme un cas normal : c'est un opérateur qui
// ajoute un appareil sans avoir franchi le facteur en place. Un toast d'erreur là où il faut une
// explication serait le pire des rendus.
expectTypeOf<keyof BeginRegistrationOperation['responses']>().toEqualTypeOf<200 | 401 | 409>()

// Aucun corps à envoyer : le serveur sait qui demande par le cookie, et ce que l'opérateur détient
// par sa propre lecture. Rien à composer, donc rien à oublier de composer.
expectTypeOf<BeginRegistrationOperation['requestBody']>().toEqualTypeOf<undefined>()

type FinishRegistrationOperation = paths['/auth/mfa/webauthn/register/finish']['post']

// L'attestation traverse **telle quelle**. `{ [key: string]: unknown }` et non `Record<string,
// never>` : la seconde forme n'accepterait aucune clé.
expectTypeOf<
  FinishRegistrationOperation['requestBody']['content']['application/json']
>().toEqualTypeOf<{ attestation: { [key: string]: unknown } }>()

// Seul l'identifiant en retour, et c'est ce dont le client a besoin : de quoi la retirer plus tard.
// Rien de la clé — pas même publique, qu'aucun écran n'affiche.
expectTypeOf<
  FinishRegistrationOperation['responses'][200]['content']['application/json']
>().toEqualTypeOf<{ id: string }>()

expectTypeOf<keyof FinishRegistrationOperation['responses']>().toEqualTypeOf<200 | 400 | 401>()

type BeginAssertionOperation = paths['/auth/mfa/webauthn/assert/begin']['post']

expectTypeOf<
  BeginAssertionOperation['responses'][200]['content']['application/json']['publicKey']
>().toEqualTypeOf<{
  challenge: string
  timeout?: number
  rpId?: string
  allowCredentials?: { type: 'public-key'; id: string; transports?: string[] }[]
  userVerification?: string
}>()

// Le 400 dit « aucune passkey enregistrée », et c'est une impasse et non une panne : l'écran doit
// conduire à l'enrôlement. Le distinguer du 401 est ce qui lui permet de le faire.
expectTypeOf<keyof BeginAssertionOperation['responses']>().toEqualTypeOf<200 | 400 | 401>()

type DeletePasskeyOperation = paths['/auth/mfa/webauthn/passkeys/{passkeyId}']['delete']

// Le seul paramètre de chemin du contrat à ce jour. C'est l'identifiant rendu à l'enregistrement,
// jamais celui que l'authentificateur s'est choisi — celui-là est binaire et n'a rien à faire dans
// une URL.
expectTypeOf<DeletePasskeyOperation['parameters']['path']>().toEqualTypeOf<{ passkeyId: string }>()

// Le 409 est ce qui permet au client de ne pas proposer un retrait qui échouera : croisé avec
// `secondFactors`, il sait d'avance que la dernière passkey d'un compte sans TOTP est verrouillée, et
// peut désactiver le contrôle **en l'expliquant** plutôt que de laisser l'opérateur le découvrir.
expectTypeOf<keyof DeletePasskeyOperation['responses']>().toEqualTypeOf<204 | 401 | 409>()
