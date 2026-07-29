/**
 * `POST /api/auth/mfa/verify` — la coquille HTTP, et rien d'autre.
 *
 * La décision est dans `mfa.ts`, la forme de la réponse — dont la discrétion du 401 — dans `http.ts`,
 * la garde de session dans `guard.ts`. Tous testés. Ce fichier est exclu de la mesure de couverture
 * parce qu'il ne décide rien ; le jour où il déciderait, la règle sortirait de la mesure sans que
 * personne ne le voie.
 *
 * Voir `login.ts` pour la raison qui place ce fichier sous `src/server/` plutôt que `src/routes/`.
 */

import { defineEventHandler, getRequestHeader, readBody } from 'h3'
import { getDatabase } from '../../db/index'
import { resolveSession } from '../guard'
import { meResponse, mfaVerifyResponse, parseMfaCode } from '../http'
import { verifyMfaCode } from '../mfa'
import { getMfaKeys, getSessionSecrets } from '../secrets'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const session = await resolveSession(db, getRequestHeader(event, 'cookie'), getSessionSecrets())

  // **Seule une session partielle entre ici.** Une session complète n'a rien à vérifier, et la
  // laisser repasser par là offrirait un point de devinette de plus, sans plafond court pour le
  // borner. Le refus emprunte celui de `/auth/me`, qui ne dit pas ce qui manque.
  if (session.status !== 'pending_mfa') return meResponse(undefined)

  // Uniquement du JSON : voir `mfa-enroll.ts`.
  const contentType = getRequestHeader(event, 'content-type')?.split(';')[0]?.trim()
  const body =
    contentType === 'application/json' ? await readBody(event).catch(() => undefined) : undefined

  const parsed = parseMfaCode(body)

  // Un corps illisible suit le chemin d'un code faux, sans passer par la base : il n'y a rien à
  // vérifier. Il ne compte pas d'échec pour autant — le compteur protège contre la devinette d'un
  // code, et un corps vide n'en est pas une.
  if (!parsed.ok) return mfaVerifyResponse({ outcome: 'invalid_code' })

  return mfaVerifyResponse(await verifyMfaCode(db, getMfaKeys(), session, parsed.code))
})
