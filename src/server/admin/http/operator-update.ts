/**
 * `POST /api/admin/operators/update` — statut et rôles, dans la même transaction.
 *
 * Deux gestes en un point d'entrée, parce qu'ils se décident ensemble : « ce compte part, retirons
 * ses rôles » est une seule intention, et deux requêtes en auraient fait deux lignes d'audit dont
 * l'une pouvait échouer seule.
 *
 * L'état d'avant se lit **hors** de la transaction, comme `mutate` l'exige de son `before`. La
 * fenêtre entre cette lecture et l'écriture est réelle mais bornée par le verrou consultatif de
 * l'annuaire : ce qui pourrait diverger est le contenu de `before_json`, jamais la mutation.
 */

import { defineEventHandler } from 'h3'
import { mutate } from '../../authz/mutate'
import { readOperatorSnapshot } from '../directory'
import { DirectoryRuleError, setOperatorRoles, setOperatorStatus } from '../directory-write'
import {
  auditList,
  invalidRequest,
  okResponse,
  parseOperatorUpdate,
  refusalResponse,
  ruleResponse,
} from '../http'
import { adminContext } from './context'

export default defineEventHandler(async (event) => {
  const { db, session, ipAddress, body } = await adminContext(event)

  const parsed = parseOperatorUpdate(body)
  if (!parsed.ok) return invalidRequest(parsed.message)

  const before = await readOperatorSnapshot(db, parsed.operatorId)
  if (!before) {
    return invalidRequest('Action refusée : cet opérateur n’existe plus. Rechargez la liste.')
  }

  try {
    const outcome = await mutate(
      db,
      {
        session,
        permission: 'operators:manage',
        action: 'operator.update',
        targetType: 'operator',
        targetId: parsed.operatorId,
        ipAddress,
        before: { status: before.status, roles: auditList(before.roles) },
      },
      async (tx, actor) => {
        const status = parsed.status
          ? await setOperatorStatus(tx, actor.operatorId, {
              operatorId: parsed.operatorId,
              status: parsed.status,
            })
          : undefined

        const roles = parsed.roleIds
          ? await setOperatorRoles(tx, actor.operatorId, {
              operatorId: parsed.operatorId,
              roleIds: parsed.roleIds,
            })
          : undefined

        return {
          result: { closedSessions: status?.closedSessions ?? 0 },
          after: {
            status: parsed.status ?? before.status,
            roles: roles ? auditList(roles.roleNames) : auditList(before.roles),
            // Combien de personnes ont perdu leur session en même temps : c'est ce qu'on cherche
            // en relisant le journal après un incident.
            closed_sessions: status?.closedSessions ?? 0,
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
