/**
 * `POST /api/auth/logout` — la coquille HTTP.
 *
 * `POST` et non `GET` : une déconnexion est une mutation, et un `GET` se déclenche depuis une image
 * ou un lien préchargé. On ne veut pas qu'un tiers puisse déconnecter un opérateur en lui faisant
 * ouvrir une page.
 *
 * Aucune règle ici non plus : la fermeture est dans `session.ts`, la réponse — toujours 204, toujours
 * le cookie effacé — dans `http.ts`, et les deux y sont testées.
 *
 * Voir `login.ts` pour la raison qui place ce fichier sous `src/server/` plutôt que `src/routes/`.
 */

import { defineEventHandler, getRequestHeader } from 'h3'
import { getDatabase } from '../../db/index'
import { resolveSession } from '../guard'
import { logoutResponse } from '../http'
import { endSession } from '../session'
import { getSessionSecrets } from './secrets'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const session = await resolveSession(db, getRequestHeader(event, 'cookie'), getSessionSecrets())

  await endSession(db, session)

  return logoutResponse()
})
