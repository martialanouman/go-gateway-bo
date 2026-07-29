/**
 * `GET /api/auth/me` — la coquille HTTP.
 *
 * Aucune règle ici : la garde est dans `guard.ts`, la composition dans `me.ts`, tous deux testés.
 * Voir `login.ts` pour la raison qui place ce fichier sous `src/server/` plutôt que `src/routes/`.
 */

import { defineEventHandler, getRequestHeader } from 'h3'
import { getDatabase } from '../../db/index'
import { readSessionSecrets, type SessionSecrets } from '../cookie'
import { resolveSession } from '../guard'
import { currentOperator } from '../me'

let secrets: SessionSecrets | undefined

function getSessionSecrets(): SessionSecrets {
  secrets ??= readSessionSecrets(process.env)
  return secrets
}

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const session = await resolveSession(db, getRequestHeader(event, 'cookie'), getSessionSecrets())
  const me = await currentOperator(db, session)

  if (!me) {
    // 401 sec, sans indice sur la raison : cookie absent, signature invalide, session révoquée,
    // échue, ou opérateur désactivé donnent la même réponse. Le client n'a qu'une conduite à tenir —
    // aller au login — et lui en dire plus ne l'aiderait pas.
    return new Response(JSON.stringify({ error: 'Session absente ou expirée.' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  return new Response(JSON.stringify(me), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Jamais en cache : cette réponse porte l'identité et les permissions du moment. Servie à
      // quelqu'un d'autre par un intermédiaire, elle lui donnerait la vue d'un autre opérateur.
      'cache-control': 'no-store',
    },
  })
})
