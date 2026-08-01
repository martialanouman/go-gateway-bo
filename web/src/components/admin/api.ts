/**
 * L'annuaire vu du navigateur : lectures en cache, écritures en issues.
 *
 * ## Les types sont redéclarés ici, et c'est la règle
 *
 * L'invariant (d) interdit à `src/components/` d'importer quoi que ce soit de `src/server/`, y
 * compris un type. La forme rendue par le BFF est donc écrite deux fois — comme `CurrentOperator`
 * l'est déjà pour `/auth/me`. Ce que cela coûte : une divergence possible entre les deux
 * déclarations. Ce que cela achète : aucun chemin d'import du client vers le jeton machine, le mTLS
 * et la connexion PostgreSQL. Le second vaut le premier, et le parcours de bout en bout est ce qui
 * rattrape une forme qui aurait changé d'un côté seulement.
 *
 * ## Deux formes de retour, parce qu'il y a deux besoins
 *
 * Une **lecture** lève : TanStack Query attend une exception pour peindre l'état d'erreur, et le
 * statut HTTP voyage dans l'exception parce que c'est tout ce que la charte autorise à afficher —
 * jamais le texte distant (`ErrorState`).
 *
 * Une **écriture** rend une issue et ne lève jamais. Un refus de règle — « ce compte est le dernier
 * `super_admin` » — n'est pas une panne : c'est une réponse, et son message vient du serveur
 * verbatim. Le composer ici en produirait une seconde version, plus vague, qui finirait par
 * contredire la première.
 */

import type { PermissionKey } from '~/lib/permissions'

export type DirectoryOperator = {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly status: 'active' | 'disabled'
  readonly lastLoginAt: string | null
  readonly mfaEnrolled: boolean
  readonly roles: readonly { readonly id: string; readonly name: string }[]
}

/** Un rôle réduit à son identité : c'est tout ce que l'écran des opérateurs reçoit. */
export type RoleRef = { readonly id: string; readonly name: string; readonly isDefault: boolean }

export type DirectoryRole = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly isDefault: boolean
  readonly permissions: readonly PermissionKey[]
  readonly operatorCount: number
}

export type PermissionImpact = {
  readonly removedPermissions: readonly PermissionKey[]
  readonly affectedOperators: number
}

export const OPERATORS_QUERY_KEY = ['admin', 'operators'] as const
export const ROLES_QUERY_KEY = ['admin', 'roles'] as const

/**
 * L'échec d'une lecture, réduit à son statut.
 *
 * Le corps de la réponse n'est **pas** conservé : un message distant cite volontiers la valeur qu'il
 * refuse, et le peindre le ferait entrer dans la première capture d'écran collée dans un ticket.
 */
export class AdminRequestError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Lecture de l’annuaire refusée — ${status}`)
    this.name = 'AdminRequestError'
    this.status = status
  }
}

/** `0` quand la requête n'a jamais abouti : c'est ce que `ErrorState` attend pour le dire. */
const NETWORK_FAILURE = 0

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } }).catch(
    () => undefined,
  )
  if (!response) throw new AdminRequestError(NETWORK_FAILURE)
  if (!response.ok) throw new AdminRequestError(response.status)

  return (await response.json()) as T
}

export function operatorsQueryOptions() {
  return {
    queryKey: OPERATORS_QUERY_KEY,
    queryFn: () =>
      getJson<{ operators: readonly DirectoryOperator[]; roles: readonly RoleRef[] }>(
        '/api/admin/operators',
      ),
  }
}

export function rolesQueryOptions() {
  return {
    queryKey: ROLES_QUERY_KEY,
    queryFn: () => getJson<{ roles: readonly DirectoryRole[] }>('/api/admin/roles'),
  }
}

/**
 * L'aperçu d'impact d'un paquet candidat.
 *
 * La clé de cache porte les permissions : deux compositions différentes ne doivent pas se servir
 * l'une l'autre, sinon l'écran annoncerait le coût d'un changement que l'administrateur vient de
 * modifier.
 */
export function impactQueryOptions(roleId: string, permissions: readonly PermissionKey[]) {
  const query = new URLSearchParams({ role: roleId, permissions: permissions.join(',') })

  return {
    queryKey: ['admin', 'impact', roleId, [...permissions].sort().join(',')] as const,
    queryFn: () => getJson<PermissionImpact>(`/api/admin/roles/impact?${query.toString()}`),
  }
}

export type AdminOutcome<T> =
  | { readonly ok: true; readonly data: T }
  /** Refus du produit ou panne : le message est prêt à afficher, et vient du serveur quand il y en a un. */
  | { readonly ok: false; readonly message: string }

export const UNREACHABLE_MESSAGE =
  'Le serveur n’a pas répondu. Vérifiez votre connexion, puis réessayez.'

async function postJson<T>(path: string, body: unknown): Promise<AdminOutcome<T>> {
  const response = await fetch(path, {
    method: 'POST',
    // **Uniquement du JSON.** Un `<form>` `urlencoded` est une *simple request* : sans preflight
    // CORS, n'importe quelle page visitée par un administrateur pourrait déclencher ces actions
    // depuis son navigateur et avec son cookie.
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => undefined)

  if (!response) return { ok: false, message: UNREACHABLE_MESSAGE }

  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as
      | { error?: unknown }
      | undefined

    // Un 5xx n'est pas un refus : peindre « action refusée » pendant une panne du BFF ferait
    // conclure à un droit manquant, et chercher un contournement qui n'existe pas.
    if (response.status >= 500 || typeof payload?.error !== 'string') {
      return { ok: false, message: UNREACHABLE_MESSAGE }
    }

    return { ok: false, message: payload.error }
  }

  return { ok: true, data: (await response.json()) as T }
}

export type NewOperatorInput = {
  readonly email: string
  readonly displayName: string
  readonly roleIds: readonly string[]
}

/** Le mot de passe n'est rendu qu'ici, et une seule fois : il n'existe nulle part ailleurs. */
export type CreatedOperator = { readonly operatorId: string; readonly temporaryPassword: string }

export function createOperator(input: NewOperatorInput): Promise<AdminOutcome<CreatedOperator>> {
  return postJson('/api/admin/operators/create', input)
}

export type OperatorUpdate = {
  readonly operatorId: string
  readonly status?: 'active' | 'disabled'
  readonly roleIds?: readonly string[]
}

export function updateOperator(
  input: OperatorUpdate,
): Promise<AdminOutcome<{ closedSessions: number }>> {
  return postJson('/api/admin/operators/update', input)
}

export function resetOperatorMfa(
  operatorId: string,
): Promise<AdminOutcome<{ closedSessions: number }>> {
  return postJson('/api/admin/operators/mfa-reset', { operatorId })
}

export type RoleInput = {
  readonly name: string
  readonly description: string
  readonly permissions: readonly PermissionKey[]
}

export function createRole(input: RoleInput): Promise<AdminOutcome<{ roleId: string }>> {
  return postJson('/api/admin/roles/create', input)
}

export function updateRole(
  input: RoleInput & { readonly roleId: string },
): Promise<AdminOutcome<{ added: readonly string[]; removed: readonly string[] }>> {
  return postJson('/api/admin/roles/update', input)
}

export function deleteRole(
  roleId: string,
): Promise<AdminOutcome<{ name: string; holders: number }>> {
  return postJson('/api/admin/roles/delete', { roleId })
}
