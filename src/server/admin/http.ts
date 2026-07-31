/**
 * La frontière HTTP de l'annuaire : lire une requête, rendre une réponse.
 *
 * Séparée des coquilles `http/` pour la même raison que du côté de l'authentification — ce sont les
 * seules décisions du transport, et une décision non testée finit par être adoucie sans que
 * personne ne le voie. Les coquilles, elles, ne décident rien et restent hors de la mesure de
 * couverture (`vitest.config.ts`).
 *
 * ## Les parseurs refusent, ils ne réparent pas
 *
 * Une clé de permission inconnue n'est **pas** écartée du lot : elle fait refuser la requête
 * entière. L'écarter enregistrerait un rôle amputé d'un droit que l'administrateur croit avoir
 * accordé — le pire des deux échecs, parce qu'il est silencieux. Même raison pour la forme des
 * identifiants : un `roleId` qui n'est pas un UUID atteindrait PostgreSQL, qui rendrait un `22P02`
 * au milieu de la transaction, et l'écran peindrait une panne là où il y a une faute de frappe.
 */

import { PERMISSION_KEYS, type PermissionKey } from '~/lib/permissions'
import { AUTHZ_CODES, type Refusal } from '../authz/permission'
import type { DirectoryRuleError } from './directory-write'

/** Un identifiant tel que PostgreSQL l'accepte en `uuid`. Vérifié ici, jamais délégué à la base. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Le nom d'un rôle : minuscules, chiffres, tirets bas.
 *
 * C'est ce nom qui apparaît dans `before_json` / `after_json` et dans la colonne « rôles » de
 * l'écran des opérateurs — donc ce qu'un exploitant grep après un incident. « Support N2 » et
 * « support n2 » désigneraient la même chose sans se retrouver l'un l'autre.
 */
const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_]{1,39}$/

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/

const MAX_EMAIL_LENGTH = 320
const MAX_NAME_LENGTH = 120
const MAX_DESCRIPTION_LENGTH = 200
/** Neuf rôles par défaut et de la marge : au-delà, c'est un corps forgé, pas une saisie d'écran. */
const MAX_ROLES = 32

const CATALOG: ReadonlySet<string> = new Set(PERMISSION_KEYS)

export type Parsed<T> =
  | ({ readonly ok: true } & T)
  | { readonly ok: false; readonly message: string }

function refuse(message: string): { readonly ok: false; readonly message: string } {
  return { ok: false, message }
}

function fields(body: unknown): Record<string, unknown> | undefined {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : undefined
}

function readText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined
}

function readUuid(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : undefined
}

const UNREADABLE = 'Requête refusée : le corps de la demande est illisible.'

const INVALID_ROLE_IDS =
  'Requête refusée : un des rôles désignés n’a pas la forme attendue. Rechargez l’écran, la liste a peut-être changé.'

function readRoleIds(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ROLES) return undefined

  const ids = value.map(readUuid)
  if (ids.some((id) => id === undefined)) return undefined

  return [...new Set(ids as string[])]
}

/**
 * Les clés du catalogue, dédoublonnées et triées — ou `undefined` dès qu'une seule est inconnue.
 *
 * Le tri sert l'audit : `after_json` doit se comparer d'une ligne à l'autre. Le dédoublonnage sert
 * l'insertion, dont la clé primaire est le couple (rôle, permission).
 */
function readPermissions(value: unknown): readonly PermissionKey[] | undefined {
  if (!Array.isArray(value)) return undefined

  const keys = value.filter((key): key is string => typeof key === 'string')
  if (keys.length !== value.length) return undefined
  if (keys.some((key) => !CATALOG.has(key))) return undefined

  return [...new Set(keys)].sort() as PermissionKey[]
}

export function parseNewOperator(
  body: unknown,
): Parsed<{ email: string; displayName: string; roleIds: readonly string[] }> {
  const raw = fields(body)
  if (!raw) return refuse(UNREADABLE)

  const email = readText(raw.email, MAX_EMAIL_LENGTH)
  if (!email || !EMAIL_PATTERN.test(email)) {
    return refuse('Création refusée : l’adresse email saisie n’a pas la forme d’une adresse.')
  }

  const displayName = readText(raw.displayName, MAX_NAME_LENGTH)
  if (!displayName) {
    return refuse(
      'Création refusée : le nom affiché est vide. C’est lui qui identifie la personne dans le journal d’audit.',
    )
  }

  const roleIds = readRoleIds(raw.roleIds)
  if (!roleIds) return refuse(INVALID_ROLE_IDS)

  return { ok: true, email, displayName, roleIds }
}

export type OperatorStatusInput = 'active' | 'disabled'

export function parseOperatorUpdate(body: unknown): Parsed<{
  operatorId: string
  status: OperatorStatusInput | undefined
  roleIds: readonly string[] | undefined
}> {
  const raw = fields(body)
  const operatorId = raw && readUuid(raw.operatorId)
  if (!raw || !operatorId) return refuse(UNREADABLE)

  const status =
    raw.status === undefined
      ? undefined
      : raw.status === 'active' || raw.status === 'disabled'
        ? raw.status
        : null

  if (status === null) {
    return refuse('Requête refusée : un opérateur est actif ou désactivé, et rien d’autre.')
  }

  const roleIds = raw.roleIds === undefined ? undefined : readRoleIds(raw.roleIds)
  if (raw.roleIds !== undefined && !roleIds) return refuse(INVALID_ROLE_IDS)

  if (status === undefined && roleIds === undefined) {
    // Sans ce refus, la requête écrirait une ligne d'audit pour une action qui n'a rien changé, et
    // le journal se remplirait de lignes qu'on ne peut plus distinguer des vraies.
    return refuse('Requête refusée : cette demande ne changerait ni le statut ni les rôles.')
  }

  return { ok: true, operatorId, status, roleIds }
}

export function parseOperatorTarget(body: unknown): Parsed<{ operatorId: string }> {
  const raw = fields(body)
  const operatorId = raw && readUuid(raw.operatorId)

  return operatorId ? { ok: true, operatorId } : refuse(UNREADABLE)
}

export function parseRoleDefinition(
  body: unknown,
): Parsed<{ name: string; description: string; permissions: readonly PermissionKey[] }> {
  const raw = fields(body)
  if (!raw) return refuse(UNREADABLE)

  const name = readText(raw.name, MAX_NAME_LENGTH)
  if (!name || !ROLE_NAME_PATTERN.test(name)) {
    return refuse(
      'Nom refusé : un rôle se nomme en minuscules, chiffres et tirets bas — par exemple ' +
        '« support_n2 ». C’est ce nom qui apparaît au journal d’audit, où il se grep.',
    )
  }

  const description = readText(raw.description, MAX_DESCRIPTION_LENGTH)
  if (!description) {
    return refuse(
      'Description refusée : elle est vide. Un rôle sans description oblige à ouvrir son paquet pour savoir à qui le donner.',
    )
  }

  const permissions = readPermissions(raw.permissions)
  if (!permissions) {
    return refuse(
      'Enregistrement refusé : une des permissions demandées n’existe pas au catalogue. ' +
        'Le catalogue est figé avec les livraisons — rechargez l’écran.',
    )
  }

  return { ok: true, name, description, permissions }
}

export function parseRoleUpdate(body: unknown): Parsed<{
  roleId: string
  name: string
  description: string
  permissions: readonly PermissionKey[]
}> {
  const raw = fields(body)
  const roleId = raw && readUuid(raw.roleId)
  if (!roleId) return refuse(UNREADABLE)

  const definition = parseRoleDefinition(body)
  return definition.ok ? { ...definition, roleId } : definition
}

export function parseRoleTarget(body: unknown): Parsed<{ roleId: string }> {
  const raw = fields(body)
  const roleId = raw && readUuid(raw.roleId)

  return roleId ? { ok: true, roleId } : refuse(UNREADABLE)
}

/**
 * L'aperçu d'impact se demande en `GET`, avec les clés candidates en paramètre.
 *
 * Un `POST` aurait été plus naturel pour un corps de cette taille, mais il serait passé pour une
 * mutation : le test d'énumération de l'invariant (c) exigerait alors une ligne d'audit pour une
 * demande qui ne change rien, et l'exemption se serait ajoutée à une liste réservée à
 * l'authentification. Une lecture est un `GET`.
 */
export function parseImpactQuery(query: {
  readonly role?: string
  readonly permissions?: string
}): Parsed<{ roleId: string; permissions: readonly PermissionKey[] }> {
  const roleId = readUuid(query.role)
  if (!roleId) return refuse(UNREADABLE)

  const raw = query.permissions ?? ''
  const permissions = readPermissions(raw.length === 0 ? [] : raw.split(','))
  if (!permissions) {
    return refuse('Aperçu refusé : une des permissions demandées n’existe pas au catalogue.')
  }

  return { ok: true, roleId, permissions }
}

/**
 * Au-delà, `checkAuditValue` refuse la valeur — et un audit refusé **annule la mutation**
 * (`mutate.ts`). La borne réelle est 512 ; celle-ci garde de la marge pour le jour où un nom de
 * permission s'allonge.
 */
const MAX_AUDIT_LIST_LENGTH = 400

/**
 * Une liste de noms, en valeur d'audit.
 *
 * Le cas qui impose cette fonction n'a rien de théorique : vider le paquet de `super_admin` produit
 * une liste de quarante-quatre clés, soit près de neuf cents caractères. Recollée telle quelle, elle
 * ferait refuser l'écriture d'audit, donc **échouer une action parfaitement légitime** — et le
 * message parlerait d'un champ de contrôle trop long, ce que personne ne relierait au geste fait.
 *
 * Quand la liste ne tient pas, le compte remplace l'énumération et **le dit**. Tronquer aurait rendu
 * une ligne d'audit qui se lit comme complète alors qu'elle ne l'est pas : c'est le seul mode
 * d'échec inacceptable pour une table qui sert de preuve.
 */
export function auditList(names: readonly string[]): string {
  const joined = names.join(',')

  return joined.length <= MAX_AUDIT_LIST_LENGTH
    ? joined
    : `${names.length} entrées, trop longues pour cette ligne`
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // L'annuaire nomme des personnes et leurs droits : une réponse gardée par un intermédiaire
      // serait servie à un autre administrateur, avec ce qu'elle contient.
      'cache-control': 'no-store',
    },
  })
}

export function okResponse(body: unknown): Response {
  return json(body, 200)
}

/**
 * Un refus d'autorisation, dans le code HTTP qui correspond à la conduite à tenir.
 *
 * `401` renvoie au login ; `403` dit qu'il n'y a rien à retenter avec ce compte. Les confondre
 * ferait boucler l'écran : renvoyé au login, l'opérateur reviendrait avec la même session et
 * obtiendrait le même refus.
 */
export function refusalResponse(refusal: Refusal): Response {
  const status = refusal.code === AUTHZ_CODES.sessionAbsent ? 401 : 403

  return json({ error: refusal.message, code: refusal.code }, status)
}

/**
 * Un refus de **règle du produit** : 409, jamais 400.
 *
 * La requête est bien formée — c'est l'état de l'annuaire qui la refuse, et il aura peut-être changé
 * à la tentative suivante. Le code accompagne le message pour que l'écran puisse réagir sans relire
 * une phrase française.
 */
export function ruleResponse(error: DirectoryRuleError): Response {
  return json({ error: error.message, code: error.code }, 409)
}

export function invalidRequest(message: string): Response {
  return json({ error: message }, 400)
}
