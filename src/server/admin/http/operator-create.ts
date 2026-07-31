/**
 * `POST /api/admin/operators` — créer un compte, et rendre son mot de passe **une seule fois**.
 *
 * ## Le secret ne vit que dans cette réponse
 *
 * Il n'est ni stocké en clair, ni journalisé, ni réaffichable : la base ne garde que le condensat
 * scrypt, et `after_json` porte l'adresse et les rôles, jamais le mot de passe. C'est l'invariant
 * (b), et il se lit ici : le seul chemin par lequel cette valeur sort du BFF est le corps de cette
 * réponse-ci.
 *
 * ## Le hachage précède la transaction
 *
 * 166 ms et 128 Mio (`password.ts`). Hacher dans le bloc tiendrait une connexion du pool — dix par
 * instance — pendant tout ce temps, et le verrou de l'annuaire avec elle.
 */

import { defineEventHandler } from 'h3'
import { hashPassword } from '../../auth/password'
import { generateTemporaryPassword } from '../../auth/temporary-password'
import { mutate } from '../../authz/mutate'
import { createOperator, DirectoryRuleError } from '../directory-write'
import {
  auditList,
  invalidRequest,
  okResponse,
  parseNewOperator,
  refusalResponse,
  ruleResponse,
} from '../http'
import { adminContext } from './context'

export default defineEventHandler(async (event) => {
  const { db, session, ipAddress, body } = await adminContext(event)

  const parsed = parseNewOperator(body)
  if (!parsed.ok) return invalidRequest(parsed.message)

  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await hashPassword(temporaryPassword)

  try {
    const outcome = await mutate(
      db,
      {
        session,
        permission: 'operators:manage',
        action: 'operator.create',
        targetType: 'operator',
        ipAddress,
      },
      async (tx) => {
        const created = await createOperator(tx, {
          email: parsed.email,
          displayName: parsed.displayName,
          passwordHash,
          roleIds: parsed.roleIds,
        })

        return {
          result: created.operatorId,
          // La cible n'est connue qu'ici : une création n'a pas d'identifiant avant d'exister.
          targetId: created.operatorId,
          after: {
            email: parsed.email,
            display_name: parsed.displayName,
            roles: auditList(created.roleNames),
            status: 'active',
          },
        }
      },
    )

    if (!outcome.granted) return refusalResponse(outcome.refusal)

    return okResponse({ operatorId: outcome.result, temporaryPassword })
  } catch (error) {
    if (error instanceof DirectoryRuleError) return ruleResponse(error)
    throw error
  }
})
