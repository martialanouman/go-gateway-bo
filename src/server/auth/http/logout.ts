/**
 * `POST /api/auth/logout` — la coquille HTTP.
 *
 * `POST` et non `GET` : une déconnexion est une mutation, et un `GET` se déclenche depuis une image
 * ou un lien préchargé. On ne veut pas qu'un tiers puisse déconnecter un opérateur en lui faisant
 * ouvrir une page.
 *
 * Voir `login.ts` pour la raison qui place ce fichier sous `src/server/` plutôt que `src/routes/`.
 */

import { defineEventHandler, getRequestHeader } from 'h3'
import { getDatabase } from '../../db/index'
import { clearedSessionCookie, readSessionSecrets, type SessionSecrets } from '../cookie'
import { resolveSession } from '../guard'
import { revokeSession } from '../session'

let secrets: SessionSecrets | undefined

function getSessionSecrets(): SessionSecrets {
  secrets ??= readSessionSecrets(process.env)
  return secrets
}

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const session = await resolveSession(db, getRequestHeader(event, 'cookie'), getSessionSecrets())

  // Une session partielle se déconnecte comme une autre : abandonner un second facteur en cours doit
  // fermer ce qui a été ouvert, sinon la session traînerait jusqu'à son expiration.
  if (session.status !== 'none') await revokeSession(db, session.sessionId)

  // **Toujours 204, et toujours le cookie effacé**, même sans session : répondre différemment
  // indiquerait à l'appelant s'il en détenait une. Et effacer inconditionnellement évite qu'un
  // cookie périmé reste collé au navigateur après une révocation côté serveur.
  return new Response(null, {
    status: 204,
    headers: { 'set-cookie': clearedSessionCookie(), 'cache-control': 'no-store' },
  })
})
