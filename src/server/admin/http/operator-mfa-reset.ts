/**
 * `POST /api/admin/operators/mfa-reset` — effacer le second facteur d'un compte.
 *
 * Le geste du téléphone perdu. Il ferme aussi les sessions ouvertes du compte : elles ont été
 * validées par le facteur qu'on vient d'effacer, et l'appareil qui les porte est précisément celui
 * dont on ne sait plus où il est.
 *
 * Rien du facteur n'entre dans l'audit — ni secret, ni identifiant d'appareil. Ce que la ligne dit
 * est qu'il n'y en a plus.
 */

import { defineEventHandler } from 'h3'
import { mutate } from '../../authz/mutate'
import { DirectoryRuleError, resetOperatorMfa } from '../directory-write'
import {
  invalidRequest,
  okResponse,
  parseOperatorTarget,
  refusalResponse,
  ruleResponse,
} from '../http'
import { adminContext } from './context'

export default defineEventHandler(async (event) => {
  const { db, session, ipAddress, body } = await adminContext(event)

  const parsed = parseOperatorTarget(body)
  if (!parsed.ok) return invalidRequest(parsed.message)

  try {
    const outcome = await mutate(
      db,
      {
        session,
        permission: 'operators:manage',
        action: 'operator.mfa_reset',
        targetType: 'operator',
        targetId: parsed.operatorId,
        ipAddress,
        // Pas de `before` : écrire `mfa_enrolled: true` sans l'avoir lu ferait affirmer au journal
        // qu'un facteur existait, y compris sur un compte qui n'en avait aucun. Ce que cette
        // action garantit est l'état d'arrivée, et c'est lui qu'elle journalise.
      },
      async (tx, actor) => {
        const reset = await resetOperatorMfa(tx, actor.operatorId, {
          operatorId: parsed.operatorId,
        })

        return {
          result: { closedSessions: reset.closedSessions },
          after: { mfa_enrolled: false, closed_sessions: reset.closedSessions },
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
