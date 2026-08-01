/**
 * `GET /api/admin/operators` — l'annuaire tel que l'écran des opérateurs le montre.
 *
 * Les rôles accompagnent la liste, **réduits à leur identité** : l'écran a besoin de les proposer
 * dans le sélecteur de rattachement, pas de montrer leur paquet. Rendre les permissions ici les
 * donnerait à qui détient `operators:manage` sans `roles:manage` — deux clés que le §6.10 sépare
 * exprès.
 */

import { defineEventHandler } from 'h3'
import { requirePermission } from '../../authz/permission'
import { listOperators, listRoles } from '../directory'
import { okResponse, refusalResponse } from '../http'
import { adminContext } from './context'

export default defineEventHandler(async (event) => {
  const { db, session } = await adminContext(event)

  const decision = await requirePermission(db, session, 'operators:manage')
  if (!decision.granted) return refusalResponse(decision.refusal)

  const [operators, roles] = await Promise.all([listOperators(db), listRoles(db)])

  return okResponse({
    operators,
    roles: roles.map((role) => ({ id: role.id, name: role.name, isDefault: role.isDefault })),
  })
})
