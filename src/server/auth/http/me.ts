/**
 * `GET /api/auth/me` — la coquille HTTP.
 *
 * Aucune règle ici : la garde est dans `guard.ts`, la composition dans `me.ts`, la forme de la
 * réponse — dont la discrétion du 401 — dans `http.ts`. Tous trois testés.
 *
 * Voir `login.ts` pour la raison qui place ce fichier sous `src/server/` plutôt que `src/routes/`.
 */

import { defineEventHandler, getRequestHeader } from 'h3'
import { getDatabase } from '../../db/index'
import { resolveSession } from '../guard'
import { meResponse } from '../http'
import { currentOperator } from '../me'
import { getSessionSecrets } from './secrets'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const session = await resolveSession(db, getRequestHeader(event, 'cookie'), getSessionSecrets())

  return meResponse(await currentOperator(db, session))
})
