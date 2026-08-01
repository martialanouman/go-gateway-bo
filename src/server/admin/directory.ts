/**
 * L'annuaire : qui accède à la console, et avec quels droits.
 *
 * ## Des lectures, et rien d'autre
 *
 * Ce module ne mute rien. Les mutations passent par `mutate()` (step-025), qui vérifie la permission,
 * agit et audite dans une seule transaction — les mélanger ici donnerait deux chemins vers la base
 * dont un seul est audité, et c'est toujours celui-là qui finit par être emprunté.
 *
 * ## Ce qui sort d'ici sort du BFF
 *
 * Donc `operatorSafeColumns`, jamais la table entière : un `select()` sans argument emporterait le
 * condensat de mot de passe et le secret TOTP chiffré jusqu'à une réponse HTTP. La règle est écrite
 * sur la constante ; ce module est le premier à la suivre en dehors de l'authentification.
 *
 * **Ce qui garde réellement la sortie est la projection explicite**, pas le `select` : chaque
 * fonction rend un objet littéral, si bien qu'une colonne ajoutée par mégarde à la requête n'atteint
 * pas l'appelant. Vérifié par mutation — sélectionner les deux colonnes de secret ne fait rougir
 * aucun test tant que la projection ne les recopie pas. `operatorSafeColumns` reste une ceinture :
 * le jour où quelqu'un rendra `...row`, c'est elle qui limitera les dégâts.
 */

import { asc, eq, inArray, sql } from 'drizzle-orm'
import type { PermissionKey } from '~/lib/permissions'
import type { Database, Transaction } from '../db/index'
import {
  operatorRoles,
  operatorSafeColumns,
  operators,
  rolePermissions,
  roles,
} from '../db/schema/auth'

/** Un opérateur tel que l'écran d'administration le voit. Aucun secret, aucun condensat. */
export type DirectoryOperator = {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly status: 'active' | 'disabled'
  readonly lastLoginAt: string | null
  /** `true` dès qu'un facteur existe — TOTP activé ou au moins une passkey. */
  readonly mfaEnrolled: boolean
  readonly roles: readonly { readonly id: string; readonly name: string }[]
}

export type DirectoryRole = {
  readonly id: string
  readonly name: string
  readonly description: string
  /** Livré avec le produit : non supprimable, et l'écran doit le dire plutôt que griser. */
  readonly isDefault: boolean
  readonly permissions: readonly PermissionKey[]
  /** Combien d'opérateurs le portent — l'écran s'en sert pour l'aperçu d'impact. */
  readonly operatorCount: number
}

/**
 * Les rôles de plusieurs opérateurs, en une requête.
 *
 * Une requête par opérateur aurait été plus simple à lire et aurait fait N+1 appels sur un écran qui
 * en liste des dizaines. Le regroupement se fait en mémoire : la jointure rend une ligne par couple,
 * et c'est à l'appelant de la replier.
 */
async function rolesByOperator(
  db: Database | Transaction,
  operatorIds: readonly string[],
): Promise<Map<string, { id: string; name: string }[]>> {
  const grouped = new Map<string, { id: string; name: string }[]>()
  if (operatorIds.length === 0) return grouped

  const rows = await db
    .select({ operatorId: operatorRoles.operatorId, id: roles.id, name: roles.name })
    .from(operatorRoles)
    .innerJoin(roles, eq(roles.id, operatorRoles.roleId))
    .where(inArray(operatorRoles.operatorId, [...operatorIds]))
    .orderBy(asc(roles.name))

  for (const row of rows) {
    const known = grouped.get(row.operatorId)
    if (known) known.push({ id: row.id, name: row.name })
    else grouped.set(row.operatorId, [{ id: row.id, name: row.name }])
  }

  return grouped
}

export async function listOperators(db: Database): Promise<readonly DirectoryOperator[]> {
  const rows = await db
    .select({
      ...operatorSafeColumns,
      // **Un booléen, jamais la valeur.** Ce que l'écran doit savoir est « ce compte a-t-il un second
      // facteur », pas lequel ni depuis quand. Faire remonter `mfa_totp_secret` — même chiffré —
      // jusqu'à une réponse HTTP n'apporterait rien et sortirait un secret du BFF.
      mfaEnrolled: sql<boolean>`(
        ${operators.mfaTotpActivatedAt} is not null
        or jsonb_array_length(coalesce(${operators.mfaWebauthnCredentials}, '[]'::jsonb)) > 0
      )`,
    })
    .from(operators)
    .orderBy(asc(operators.email))

  const grouped = await rolesByOperator(
    db,
    rows.map((row) => row.id),
  )

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    mfaEnrolled: row.mfaEnrolled,
    roles: grouped.get(row.id) ?? [],
  }))
}

export async function listRoles(db: Database): Promise<readonly DirectoryRole[]> {
  const rows = await db
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      isDefault: roles.isDefault,
    })
    .from(roles)
    .orderBy(asc(roles.name))

  if (rows.length === 0) return []

  const ids = rows.map((row) => row.id)

  const [permissionRows, countRows] = await Promise.all([
    db
      .select({ roleId: rolePermissions.roleId, key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(inArray(rolePermissions.roleId, ids))
      .orderBy(asc(rolePermissions.permissionKey)),
    db
      .select({ roleId: operatorRoles.roleId, count: sql<number>`count(*)::int` })
      .from(operatorRoles)
      .where(inArray(operatorRoles.roleId, ids))
      .groupBy(operatorRoles.roleId),
  ])

  const byRole = new Map<string, PermissionKey[]>()
  for (const row of permissionRows) {
    const known = byRole.get(row.roleId)
    if (known) known.push(row.key as PermissionKey)
    else byRole.set(row.roleId, [row.key as PermissionKey])
  }

  const counts = new Map(countRows.map((row) => [row.roleId, row.count]))

  return rows.map((row) => ({
    ...row,
    permissions: byRole.get(row.id) ?? [],
    operatorCount: counts.get(row.id) ?? 0,
  }))
}

/**
 * L'état d'avant, pour la ligne d'audit — **des scalaires, jamais l'entité**.
 *
 * `mutate()` vérifie son `before` hors de la transaction : il faut donc le lire ici, une requête
 * avant. Les listes sortent **en tableaux triés** et non recollées : `AuditValue` exclut les
 * tableaux, mais la mise en forme appartient à `auditList` (`http.ts`), qui sait aussi quoi faire
 * d'un paquet de quarante-quatre clés — une valeur d'audit s'arrête à 512 caractères, et un audit
 * refusé **annule la mutation**.
 *
 * Rend `undefined` pour une cible disparue : l'écran était ouvert, quelqu'un d'autre a supprimé la
 * ligne, et le refus doit le dire plutôt que d'auditer un état vide.
 */
export type OperatorSnapshot = { readonly status: string; readonly roles: readonly string[] }

export async function readOperatorSnapshot(
  db: Database,
  operatorId: string,
): Promise<OperatorSnapshot | undefined> {
  const [row] = await db
    .select({ status: operators.status })
    .from(operators)
    .where(eq(operators.id, operatorId))

  if (!row) return undefined

  const held = await db
    .select({ name: roles.name })
    .from(operatorRoles)
    .innerJoin(roles, eq(roles.id, operatorRoles.roleId))
    .where(eq(operatorRoles.operatorId, operatorId))
    .orderBy(asc(roles.name))

  return { status: row.status, roles: held.map((entry) => entry.name) }
}

export type RoleSnapshot = {
  readonly name: string
  readonly description: string
  readonly permissions: readonly string[]
}

export async function readRoleSnapshot(
  db: Database,
  roleId: string,
): Promise<RoleSnapshot | undefined> {
  const [row] = await db
    .select({ name: roles.name, description: roles.description })
    .from(roles)
    .where(eq(roles.id, roleId))

  if (!row) return undefined

  const held = await db
    .select({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId))
    .orderBy(asc(rolePermissions.permissionKey))

  return { ...row, permissions: held.map((entry) => entry.key) }
}

/**
 * Ce qu'un changement de permissions coûterait, **avant** de le sauvegarder.
 *
 * « Ce changement retire *N* permissions à *M* opérateurs » : c'est la seule information qui permet
 * de distinguer un ajustement anodin d'un geste qui met une équipe dehors. Elle se calcule ici et
 * non dans l'écran, parce qu'elle dépend de qui porte le rôle — une donnée que le navigateur n'a pas
 * et ne doit pas avoir.
 *
 * On ne compte que les **retraits**. Un ajout ne peut pas casser un opérateur, et le compter
 * noierait le seul chiffre qui appelle une hésitation.
 */
export type PermissionImpact = {
  readonly removedPermissions: readonly PermissionKey[]
  readonly affectedOperators: number
}

export async function previewPermissionChange(
  db: Database,
  roleId: string,
  next: readonly PermissionKey[],
): Promise<PermissionImpact> {
  const [current, [holders]] = await Promise.all([
    db
      .select({ key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(operatorRoles)
      .where(eq(operatorRoles.roleId, roleId)),
  ])

  const keeping = new Set<string>(next)
  const removed = current
    .map((row) => row.key as PermissionKey)
    .filter((key) => !keeping.has(key))
    .sort()

  return {
    removedPermissions: removed,
    // Zéro opérateur touché quand rien n'est retiré : annoncer « 4 opérateurs » sous une liste vide
    // ferait hésiter sur un changement qui n'enlève rien.
    affectedOperators: removed.length === 0 ? 0 : (holders?.count ?? 0),
  }
}
