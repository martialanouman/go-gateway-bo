/**
 * `POST /api/admin/roles` — créer un rôle.
 *
 * **La duplication d'un rôle par défaut passe par ici**, et par rien d'autre : l'écran pré-remplit
 * le formulaire avec le paquet du rôle source, l'administrateur ajuste, et ce qui arrive est une
 * création ordinaire. Un point d'entrée « dupliquer » aurait dû relire le rôle source côté serveur
 * pour faire exactement ce que le client a déjà sous les yeux — et aurait divergé de ce qu'il
 * affiche le jour où l'un des deux aurait changé.
 */

import { defineEventHandler } from 'h3'
import { mutate } from '../../authz/mutate'
import { createRole, DirectoryRuleError } from '../directory-write'
import {
  auditList,
  invalidRequest,
  okResponse,
  parseRoleDefinition,
  refusalResponse,
  ruleResponse,
} from '../http'
import { adminContext } from './context'

export default defineEventHandler(async (event) => {
  const { db, session, ipAddress, body } = await adminContext(event)

  const parsed = parseRoleDefinition(body)
  if (!parsed.ok) return invalidRequest(parsed.message)

  try {
    const outcome = await mutate(
      db,
      {
        session,
        permission: 'roles:manage',
        action: 'role.create',
        targetType: 'role',
        ipAddress,
      },
      async (tx, actor) => {
        const created = await createRole(tx, actor.operatorId, parsed)

        return {
          result: { roleId: created.roleId },
          targetId: created.roleId,
          after: {
            name: parsed.name,
            description: parsed.description,
            permission_count: parsed.permissions.length,
            permissions: auditList(parsed.permissions),
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
