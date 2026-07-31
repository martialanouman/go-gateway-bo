/**
 * `GET /api/admin/roles` — les rôles, leur paquet et leur nombre de porteurs.
 *
 * Le catalogue de permissions ne voyage **pas** avec : il est figé et versionné avec les livraisons
 * (`~/lib/permissions`), donc déjà dans le paquet du navigateur. Le rendre ici ferait transiter à
 * chaque affichage quarante-quatre descriptions que le client possède déjà.
 */

import { defineEventHandler } from 'h3'
import { requirePermission } from '../../authz/permission'
import { listRoles } from '../directory'
import { okResponse, refusalResponse } from '../http'
import { adminContext } from './context'

export default defineEventHandler(async (event) => {
  const { db, session } = await adminContext(event)

  const decision = await requirePermission(db, session, 'roles:manage')
  if (!decision.granted) return refusalResponse(decision.refusal)

  return okResponse({ roles: await listRoles(db) })
})
