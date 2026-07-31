/**
 * L'annuaire, côté écriture : créer un opérateur, lui donner des rôles, composer ces rôles.
 *
 * ## Deux garde-fous, et un seul endroit qui les tient
 *
 * Toute mutation d'ici peut retirer des droits, et deux retraits sont irrécupérables depuis
 * l'interface : **se retirer à soi-même** `operators:manage` ou `roles:manage` — plus personne ne
 * peut vous les rendre depuis cet écran — et **retirer le dernier `super_admin`** — la console
 * garde des administrateurs, mais plus de propriétaire, donc plus personne pour rendre les clés que
 * ce rôle est seul à porter (`content:read`, `gdpr:erase`).
 *
 * Les deux se vérifient **après** la mutation et non avant, et c'est ce qui les rend uniformes :
 * plutôt que d'énumérer ce que chaque geste pourrait casser — désactivation, retrait de rôle,
 * édition d'un paquet, suppression d'un rôle —, on applique, on relit, et on annule si l'état
 * d'arrivée est celui qu'on refuse. Un geste ajouté demain hérite de la garde sans qu'on y pense.
 *
 * L'annulation est celle de la transaction entière : `mutate()` (step-025) n'écrit sa ligne d'audit
 * qu'après le bloc, si bien qu'un refus ne laisse ni mutation ni trace d'une mutation qui n'a pas eu
 * lieu.
 *
 * ## Pourquoi un verrou consultatif
 *
 * « Le dernier `super_admin` » se lit avant de se décider, et PostgreSQL est en `READ COMMITTED` :
 * deux administrateurs qui désactivent chacun un propriétaire au même instant voient chacun l'autre
 * encore actif, et valident tous les deux. La console se retrouve sans propriétaire, sans qu'aucune
 * des deux transactions n'ait rien fait d'interdit. Le verrou sérialise les écritures de l'annuaire
 * — elles sont rares, et le coût est nul devant ce mode d'échec.
 *
 * ## Ce qui n'est pas ici
 *
 * Le hachage du mot de passe initial. Il coûte 166 ms et 128 Mio (`password.ts`) : le faire dans la
 * transaction tiendrait une connexion du pool pendant tout ce temps, alors que le pool en compte dix
 * par instance. L'appelant hache **avant** d'ouvrir la transaction et passe le condensat.
 */

import { and, eq, inArray, sql } from 'drizzle-orm'
import type { PermissionKey } from '~/lib/permissions'
import { revokeAllSessionsOf } from '../auth/session'
import type { Transaction } from '../db/index'
import {
  operatorRecoveryCodes,
  operatorRoles,
  operators,
  rolePermissions,
  roles,
} from '../db/schema/auth'

/**
 * Les refus qui viennent d'une **règle du produit**, par opposition à un manque de permission.
 *
 * Ils voyagent en exception et non en valeur de retour, contrairement au refus d'autorisation : ils
 * surviennent au milieu d'une transaction, et c'est son annulation qui fait la moitié du travail.
 * Un code de retour obligerait chaque appelant à annuler à la main — donc, un jour, à oublier.
 */
export type DirectoryRuleCode =
  | 'self_lockout'
  | 'last_super_admin'
  | 'default_role_locked'
  | 'duplicate_email'
  | 'duplicate_role_name'
  | 'unknown_operator'
  | 'unknown_role'
  | 'self_mfa_reset'

export class DirectoryRuleError extends Error {
  readonly code: DirectoryRuleCode

  constructor(code: DirectoryRuleCode, message: string) {
    super(message)
    this.name = 'DirectoryRuleError'
    this.code = code
  }
}

/** Les deux clés dont la perte est sans retour depuis l'interface. */
const SELF_LOCK_KEYS = ['operators:manage', 'roles:manage'] as const

/** Le rôle dont le contrat est « toutes les permissions » (§6.10). Nommé, jamais deviné. */
const OWNER_ROLE = 'super_admin'

/** Clé du verrou consultatif de l'annuaire, distincte de celles du seed et de l'amorçage. */
const DIRECTORY_LOCK = 'directory_write'

async function lockDirectory(tx: Transaction): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${DIRECTORY_LOCK}))`)
}

/** Celles des deux clés sensibles qu'un opérateur **actif** détient à cet instant. */
async function selfLockKeysOf(tx: Transaction, operatorId: string): Promise<Set<string>> {
  const rows = await tx
    .selectDistinct({ key: rolePermissions.permissionKey })
    .from(operators)
    .innerJoin(operatorRoles, eq(operatorRoles.operatorId, operators.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, operatorRoles.roleId))
    .where(
      and(
        eq(operators.id, operatorId),
        // Le statut compte : se désactiver soi-même est le verrouillage le plus direct, et il ne
        // passe par aucun retrait de rôle.
        eq(operators.status, 'active'),
        inArray(rolePermissions.permissionKey, [...SELF_LOCK_KEYS]),
      ),
    )

  return new Set(rows.map((row) => row.key))
}

async function countActiveOwners(tx: Transaction): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(operatorRoles)
    .innerJoin(operators, eq(operators.id, operatorRoles.operatorId))
    .innerJoin(roles, eq(roles.id, operatorRoles.roleId))
    .where(and(eq(roles.name, OWNER_ROLE), eq(operators.status, 'active')))

  return row?.total ?? 0
}

function selfLockoutMessage(key: string): string {
  return (
    `Changement refusé : votre compte perdrait la permission « ${key} », ` +
    `et plus personne ne pourrait vous la rendre depuis cet écran.`
  )
}

const LAST_OWNER_MESSAGE =
  `Changement refusé : plus aucun compte actif ne porterait le rôle ${OWNER_ROLE}. ` +
  `Les permissions que ce rôle est seul à porter deviendraient inaccessibles à tous.`

/**
 * Le contour commun à toute écriture de l'annuaire : verrou, mutation, relecture des deux gardes.
 *
 * Les états d'**avant** sont capturés plutôt que comparés à une constante, pour deux raisons. Se
 * retirer une clé qu'on n'avait pas n'est pas un verrouillage — un administrateur qui ne détient que
 * `roles:manage` doit pouvoir travailler. Et une installation qui n'a déjà plus de `super_admin`
 * actif ne doit pas voir **toutes** ses écritures d'annuaire refusées : une garde qui refuse du
 * légitime finit par être retirée, et c'est elle qu'on retirerait.
 */
async function guarded<T>(tx: Transaction, actorId: string, run: () => Promise<T>): Promise<T> {
  await lockDirectory(tx)

  const keysBefore = await selfLockKeysOf(tx, actorId)
  const ownersBefore = await countActiveOwners(tx)

  const result = await run()

  const keysAfter = await selfLockKeysOf(tx, actorId)
  const lost = [...keysBefore].find((key) => !keysAfter.has(key))
  if (lost) throw new DirectoryRuleError('self_lockout', selfLockoutMessage(lost))

  if (ownersBefore > 0 && (await countActiveOwners(tx)) === 0) {
    throw new DirectoryRuleError('last_super_admin', LAST_OWNER_MESSAGE)
  }

  return result
}

/** Vérifie que chaque identifiant désigne un rôle, et rend leurs noms — pour le journal d'audit. */
async function namesOfRoles(tx: Transaction, roleIds: readonly string[]): Promise<string[]> {
  if (roleIds.length === 0) return []

  const rows = await tx
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(inArray(roles.id, [...roleIds]))

  if (rows.length !== new Set(roleIds).size) {
    // Le cas réel n'est pas une saisie fantaisiste : c'est un rôle supprimé pendant que l'écran
    // était ouvert. Le dire vaut mieux qu'une violation de clé étrangère.
    throw new DirectoryRuleError(
      'unknown_role',
      'Action refusée : un des rôles demandés n’existe plus. Rechargez la liste des rôles.',
    )
  }

  return rows.map((row) => row.name).sort()
}

async function attachRoles(
  tx: Transaction,
  operatorId: string,
  roleIds: readonly string[],
): Promise<void> {
  if (roleIds.length === 0) return

  await tx.insert(operatorRoles).values(roleIds.map((roleId) => ({ operatorId, roleId })))
}

export type NewOperator = {
  readonly email: string
  readonly displayName: string
  /** Déjà haché par l'appelant, hors transaction. Voir l'en-tête. */
  readonly passwordHash: string
  readonly roleIds: readonly string[]
}

/**
 * Sans `actorId`, contrairement aux autres écritures d'ici : une création ne peut retirer aucun
 * droit à personne, donc aucune des deux gardes ne la regarde. Le prendre pour la symétrie aurait
 * laissé croire qu'elle est surveillée comme les autres.
 */
export async function createOperator(
  tx: Transaction,
  input: NewOperator,
): Promise<{ operatorId: string; roleNames: readonly string[] }> {
  // Le verrou sert quand même : il rend le contrôle d'unicité ci-dessous décidable plutôt que
  // soumis à une course entre deux créations du même email.
  await lockDirectory(tx)

  const email = input.email.trim()

  const [taken] = await tx
    .select({ id: operators.id })
    .from(operators)
    .where(sql`lower(${operators.email}) = lower(${email})`)

  if (taken) {
    // Rattraper la violation d'index aurait donné le même refus, mais dans une transaction déjà
    // avortée : le message rendu à l'écran aurait alors été celui de PostgreSQL.
    throw new DirectoryRuleError(
      'duplicate_email',
      `Création refusée : un opérateur utilise déjà l’adresse « ${email} » — la casse ne les distingue pas.`,
    )
  }

  const roleNames = await namesOfRoles(tx, input.roleIds)

  const [created] = await tx
    .insert(operators)
    .values({ email, displayName: input.displayName.trim(), passwordHash: input.passwordHash })
    .returning({ id: operators.id })

  const operatorId = created?.id ?? ''
  await attachRoles(tx, operatorId, input.roleIds)

  return { operatorId, roleNames }
}

export type OperatorStatus = 'active' | 'disabled'

export async function setOperatorStatus(
  tx: Transaction,
  actorId: string,
  input: { readonly operatorId: string; readonly status: OperatorStatus },
): Promise<{ email: string; closedSessions: number }> {
  return guarded(tx, actorId, async () => {
    const [updated] = await tx
      .update(operators)
      .set({ status: input.status, updatedAt: sql`now()` })
      .where(eq(operators.id, input.operatorId))
      .returning({ email: operators.email })

    if (!updated) throw unknownOperator()

    // **Dans la même transaction que la désactivation.** Un compte fermé dont les sessions
    // survivent reste utilisable jusqu'à leur expiration — douze heures pendant lesquelles
    // l'écran affiche « désactivé » et la personne travaille.
    const closedSessions =
      input.status === 'disabled' ? await revokeAllSessionsOf(tx, input.operatorId) : 0

    return { email: updated.email, closedSessions }
  })
}

export async function setOperatorRoles(
  tx: Transaction,
  actorId: string,
  input: { readonly operatorId: string; readonly roleIds: readonly string[] },
): Promise<{ email: string; roleNames: readonly string[] }> {
  return guarded(tx, actorId, async () => {
    const [operator] = await tx
      .select({ email: operators.email })
      .from(operators)
      .where(eq(operators.id, input.operatorId))

    if (!operator) throw unknownOperator()

    const roleNames = await namesOfRoles(tx, input.roleIds)

    // Remplacement et non ajout : l'écran présente un ensemble, et un ajout laisserait un rôle
    // décoché en place. Le retrait est le geste que la garde de verrouillage surveille.
    await tx.delete(operatorRoles).where(eq(operatorRoles.operatorId, input.operatorId))
    await attachRoles(tx, input.operatorId, input.roleIds)

    return { email: operator.email, roleNames }
  })
}

/**
 * Efface les deux facteurs d'un opérateur qui a perdu son appareil.
 *
 * **Refusé sur son propre compte**, et ce n'est pas une gêne : celui qui perd son téléphone entre
 * par un code de récupération (`mfa-recovery.ts`), pas par cet écran — qu'il ne peut de toute façon
 * pas atteindre sans avoir franchi son second facteur. Se réinitialiser soi-même reviendrait à
 * démonter le facteur depuis une session que ce facteur protège.
 */
export async function resetOperatorMfa(
  tx: Transaction,
  actorId: string,
  input: { readonly operatorId: string },
): Promise<{ email: string; closedSessions: number }> {
  if (input.operatorId === actorId) {
    throw new DirectoryRuleError(
      'self_mfa_reset',
      'Réinitialisation refusée : ce second facteur est le vôtre. ' +
        'Entrez par un code de récupération, ou demandez-la à un autre administrateur.',
    )
  }

  const [updated] = await tx
    .update(operators)
    .set({
      mfaTotpSecret: null,
      mfaTotpActivatedAt: null,
      // Le pas anti-rejeu part avec le secret : conservé, il ferait refuser les premiers codes du
      // facteur suivant, et le nouvel enrôlement paraîtrait cassé.
      mfaTotpLastStep: null,
      mfaWebauthnCredentials: sql`'[]'::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(eq(operators.id, input.operatorId))
    .returning({ email: operators.email })

  if (!updated) throw unknownOperator()

  await tx
    .delete(operatorRecoveryCodes)
    .where(eq(operatorRecoveryCodes.operatorId, input.operatorId))

  // Les sessions ouvertes ont été validées par le facteur qu'on vient d'effacer. Les laisser vivre
  // laisserait un appareil volé — celui-là même qui motive la réinitialisation — connecté.
  const closedSessions = await revokeAllSessionsOf(tx, input.operatorId)

  return { email: updated.email, closedSessions }
}

export type RoleDefinition = {
  readonly name: string
  readonly description: string
  readonly permissions: readonly PermissionKey[]
}

export async function createRole(
  tx: Transaction,
  actorId: string,
  input: RoleDefinition,
): Promise<{ roleId: string }> {
  await lockDirectory(tx)

  const name = input.name.trim()
  await refuseDuplicateName(tx, name)

  const [created] = await tx
    .insert(roles)
    .values({ name, description: input.description.trim(), createdBy: actorId })
    .returning({ id: roles.id })

  const roleId = created?.id ?? ''
  await replacePermissions(tx, roleId, input.permissions)

  return { roleId }
}

export async function updateRole(
  tx: Transaction,
  actorId: string,
  input: RoleDefinition & { readonly roleId: string },
): Promise<{ added: readonly string[]; removed: readonly string[] }> {
  return guarded(tx, actorId, async () => {
    const [role] = await tx
      .select({ name: roles.name, isDefault: roles.isDefault })
      .from(roles)
      .where(eq(roles.id, input.roleId))

    if (!role) throw unknownRole()

    const name = input.name.trim()

    if (role.isDefault && name !== role.name) {
      // Le seed réinsère les rôles livrés **par nom** (`seed.ts`) : un rôle renommé serait recréé
      // au déploiement suivant, et l'installation se retrouverait avec les deux — l'ancien nom
      // vide, le nouveau porté par tout le monde.
      throw new DirectoryRuleError(
        'default_role_locked',
        `Renommage refusé : « ${role.name} » est livré avec le produit et son nom l’identifie au ` +
          `déploiement suivant. Sa description et ses permissions, elles, restent modifiables.`,
      )
    }

    if (name !== role.name) await refuseDuplicateName(tx, name)

    const before = await tx
      .select({ key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, input.roleId))

    await tx
      .update(roles)
      .set({ name, description: input.description.trim() })
      .where(eq(roles.id, input.roleId))

    await replacePermissions(tx, input.roleId, input.permissions)

    const kept = new Set<string>(input.permissions)
    const had = new Set(before.map((row) => row.key))

    return {
      added: input.permissions.filter((key) => !had.has(key)).sort(),
      removed: [...had].filter((key) => !kept.has(key)).sort(),
    }
  })
}

export async function deleteRole(
  tx: Transaction,
  actorId: string,
  input: { readonly roleId: string },
): Promise<{ name: string; holders: number }> {
  return guarded(tx, actorId, async () => {
    const [role] = await tx
      .select({ name: roles.name, isDefault: roles.isDefault })
      .from(roles)
      .where(eq(roles.id, input.roleId))

    if (!role) throw unknownRole()

    if (role.isDefault) {
      throw new DirectoryRuleError(
        'default_role_locked',
        `Suppression refusée : « ${role.name} » est livré avec le produit. Dupliquez-le pour en ` +
          `faire une variante, ou retirez-le des opérateurs qui le portent.`,
      )
    }

    const [held] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(operatorRoles)
      .where(eq(operatorRoles.roleId, input.roleId))

    // La cascade de `operator_roles` fait le retrait chez les porteurs ; le compte est rendu pour
    // que l'audit dise combien de personnes ont perdu quelque chose.
    await tx.delete(roles).where(eq(roles.id, input.roleId))

    return { name: role.name, holders: held?.total ?? 0 }
  })
}

async function replacePermissions(
  tx: Transaction,
  roleId: string,
  permissions: readonly PermissionKey[],
): Promise<void> {
  await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId))

  if (permissions.length === 0) return

  await tx
    .insert(rolePermissions)
    .values(permissions.map((permissionKey) => ({ roleId, permissionKey })))
}

async function refuseDuplicateName(tx: Transaction, name: string): Promise<void> {
  const [taken] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(sql`lower(${roles.name}) = lower(${name})`)

  if (taken) {
    throw new DirectoryRuleError(
      'duplicate_role_name',
      `Nom refusé : un rôle nommé « ${name} » existe déjà. Deux rôles homonymes rendraient ` +
        `illisible la colonne « rôles » de l’écran des opérateurs.`,
    )
  }
}

function unknownOperator(): DirectoryRuleError {
  return new DirectoryRuleError(
    'unknown_operator',
    'Action refusée : cet opérateur n’existe plus. Rechargez la liste.',
  )
}

function unknownRole(): DirectoryRuleError {
  return new DirectoryRuleError(
    'unknown_role',
    'Action refusée : ce rôle n’existe plus. Rechargez la liste des rôles.',
  )
}
