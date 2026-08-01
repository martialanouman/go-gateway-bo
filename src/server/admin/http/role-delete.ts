/**
 * `POST /api/admin/roles/delete` — supprimer un rôle personnalisé.
 *
 * `post` et non `delete` : le point d'entrée prend un corps JSON comme les autres, et la méthode
 * `delete` avec corps est mal servie par une partie des intermédiaires. Le test d'énumération de
 * l'invariant (c) traite les deux à l'identique — l'un comme l'autre exigent garde et audit.
 *
 * Un rôle livré avec le produit est refusé (`directory-write.ts`), et l'écran le dit **avant** de
 * proposer le bouton : « un contrôle interdit est désactivé et expliqué, jamais silencieusement
 * masqué ».
 */

import { defineEventHandler } from 'h3'
import { mutate } from '../../authz/mutate'
import { readRoleSnapshot } from '../directory'
import { DirectoryRuleError, deleteRole } from '../directory-write'
import {
  auditList,
  invalidRequest,
  okResponse,
  parseRoleTarget,
  refusalResponse,
  ruleResponse,
} from '../http'
import { adminContext } from './context'

export default defineEventHandler(async (event) => {
  const { db, session, ipAddress, body } = await adminContext(event)

  const parsed = parseRoleTarget(body)
  if (!parsed.ok) return invalidRequest(parsed.message)

  const before = await readRoleSnapshot(db, parsed.roleId)
  if (!before) {
    return invalidRequest('Action refusée : ce rôle n’existe plus. Rechargez la liste des rôles.')
  }

  try {
    const outcome = await mutate(
      db,
      {
        session,
        permission: 'roles:manage',
        action: 'role.delete',
        targetType: 'role',
        targetId: parsed.roleId,
        ipAddress,
        before: {
          name: before.name,
          permission_count: before.permissions.length,
          permissions: auditList(before.permissions),
        },
      },
      async (tx, actor) => {
        const removed = await deleteRole(tx, actor.operatorId, { roleId: parsed.roleId })

        return {
          result: removed,
          // Combien d'opérateurs ont perdu ce paquet : la seule information que la suppression
          // ajoute à ce que `before` disait déjà.
          after: { deleted: true, holders: removed.holders },
        }
      },
    )

    if (!outcome.granted) return refusalResponse(outcome.refusal)

    return okResponse(outcome.result)
  } catch (error) {
    if (error instanceof DirectoryRuleError) return ruleResponse(error)
    throw error
  }
})
