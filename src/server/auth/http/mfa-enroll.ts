/**
 * `POST /api/auth/mfa/enroll` — la coquille HTTP, et rien d'autre.
 *
 * Deux phases sur un même point d'entrée : sans code, l'opérateur demande un QR code ; avec un code,
 * il confirme. C'est `parseEnrollmentBody` qui les distingue, et `mfa.ts` qui décide — tous deux
 * testés. Ce fichier est exclu de la mesure de couverture parce qu'il ne décide rien ; le jour où il
 * déciderait, la règle sortirait de la mesure sans que personne ne le voie.
 *
 * Voir `login.ts` pour la raison qui place ce fichier sous `src/server/` plutôt que `src/routes/`.
 */

import { defineEventHandler, getRequestHeader, readBody } from 'h3'
import { getDatabase } from '../../db/index'
import { resolveSession } from '../guard'
import { meResponse, mfaEnrollResponse, parseEnrollmentBody } from '../http'
import { confirmTotpEnrollment, startTotpEnrollment } from '../mfa'
import { getMfaKeys, getSessionSecrets } from '../secrets'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const session = await resolveSession(db, getRequestHeader(event, 'cookie'), getSessionSecrets())

  // Une session — partielle ou complète — est requise : l'enrôlement écrit sur un compte, il faut
  // savoir lequel. Le refus emprunte celui de `/auth/me`, qui ne dit pas ce qui manque.
  if (session.status === 'none') return meResponse(undefined)

  // Uniquement du JSON, pour la même raison qu'au login : un `<form>` urlencodé est une *simple
  // request*, sans preflight CORS, donc déclenchable depuis n'importe quelle page visitée par un
  // opérateur — avec son cookie de session.
  const contentType = getRequestHeader(event, 'content-type')?.split(';')[0]?.trim()
  const body =
    contentType === 'application/json' ? await readBody(event).catch(() => undefined) : undefined

  const parsed = parseEnrollmentBody(body)
  const keys = getMfaKeys()

  if (parsed.phase === 'start') {
    return mfaEnrollResponse(await startTotpEnrollment(db, keys, session))
  }

  // Un champ `code` illisible se traite comme un code faux, jamais comme un démarrage : reprendre au
  // démarrage écraserait le secret que l'application vient de scanner.
  if (parsed.phase === 'invalid') return mfaEnrollResponse({ outcome: 'invalid_code' })

  return mfaEnrollResponse(await confirmTotpEnrollment(db, keys, session, parsed.code))
})
