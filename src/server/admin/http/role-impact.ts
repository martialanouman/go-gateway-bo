/**
 * `GET /api/admin/roles/impact` — « ce changement retire *N* permissions à *M* opérateurs ».
 *
 * Une lecture, donc un `GET`, avec les clés candidates en paramètre de requête. Un `POST` aurait
 * été plus commode pour une liste de cette longueur, mais le test d'énumération de l'invariant (c)
 * le prendrait pour une mutation et exigerait une ligne d'audit — pour une demande qui ne change
 * rien, et sur une route qui aurait alors rejoint une liste d'exemptions réservée à
 * l'authentification.
 */

import { defineEventHandler, getQuery } from 'h3'
import { requirePermission } from '../../authz/permission'
import { previewPermissionChange } from '../directory'
import { invalidRequest, okResponse, parseImpactQuery, refusalResponse } from '../http'
import { adminContext } from './context'

export default defineEventHandler(async (event) => {
  const { db, session } = await adminContext(event)

  const decision = await requirePermission(db, session, 'roles:manage')
  if (!decision.granted) return refusalResponse(decision.refusal)

  const query = getQuery(event)
  const parsed = parseImpactQuery({
    role: typeof query.role === 'string' ? query.role : undefined,
    permissions: typeof query.permissions === 'string' ? query.permissions : undefined,
  })
  if (!parsed.ok) return invalidRequest(parsed.message)

  return okResponse(await previewPermissionChange(db, parsed.roleId, parsed.permissions))
})
