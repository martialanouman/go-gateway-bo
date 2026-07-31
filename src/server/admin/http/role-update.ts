/**
 * `POST /api/admin/roles/update` — nom, description et paquet de permissions.
 *
 * L'audit porte les **deux deltas** en plus de l'état d'arrivée. Le compte de permissions dit ce
 * qu'est devenu le rôle ; ce qui a été retiré dit ce que des gens ont perdu, et c'est cette
 * seconde question qu'on se pose en relisant le journal après un incident.
 */

import { defineEventHandler } from 'h3'
import { mutate } from '../../authz/mutate'
import { readRoleSnapshot } from '../directory'
import { DirectoryRuleError, updateRole } from '../directory-write'
import {
  auditList,
  invalidRequest,
  okResponse,
  parseRoleUpdate,
  refusalResponse,
  ruleResponse,
} from '../http'
import { adminContext } from './context'

export default defineEventHandler(async (event) => {
  const { db, session, ipAddress, body } = await adminContext(event)

  const parsed = parseRoleUpdate(body)
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
        action: 'role.update',
        targetType: 'role',
        targetId: parsed.roleId,
        ipAddress,
        before: {
          name: before.name,
          description: before.description,
          permission_count: before.permissions.length,
          permissions: auditList(before.permissions),
        },
      },
      async (tx, actor) => {
        const change = await updateRole(tx, actor.operatorId, parsed)

        return {
          result: change,
          after: {
            name: parsed.name,
            description: parsed.description,
            permission_count: parsed.permissions.length,
            permissions_added: auditList(change.added),
            permissions_removed: auditList(change.removed),
          },
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
