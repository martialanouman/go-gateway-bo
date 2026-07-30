/**
 * `POST /api/auth/mfa/passkey/register` — la coquille HTTP, et rien d'autre.
 *
 * Deux phases sur un même point d'entrée : sans réponse d'authentificateur, l'opérateur demande des
 * options ; avec, il achève la cérémonie. La décision est dans `mfa-webauthn.ts`, la forme de la
 * réponse dans `http.ts` — tous deux testés. Ce fichier est exclu de la mesure de couverture parce
 * qu'il ne décide rien.
 *
 * Voir `login.ts` pour la raison qui place ce fichier sous `src/server/` plutôt que `src/routes/`.
 */

import { defineEventHandler, getRequestHeader } from 'h3'
import { getDatabase } from '../../db/index'
import { resolveSession } from '../guard'
import { meResponse, parsePasskeyRegistration, passkeyRegisterResponse } from '../http'
import { finishPasskeyRegistration, startPasskeyRegistration } from '../mfa-webauthn'
import { getSessionSecrets, getWebAuthnConfig } from '../secrets'
import { readJsonBody } from './json-body'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const session = await resolveSession(db, getRequestHeader(event, 'cookie'), getSessionSecrets())
  if (session.status === 'none') return meResponse(undefined)

  const parsed = parsePasskeyRegistration(await readJsonBody(event))
  const config = getWebAuthnConfig()

  if (parsed.phase === 'start') {
    return passkeyRegisterResponse(await startPasskeyRegistration(db, config, session))
  }

  if (parsed.phase === 'invalid') return passkeyRegisterResponse({ outcome: 'invalid_response' })

  return passkeyRegisterResponse(
    await finishPasskeyRegistration(db, config, session, parsed.response, parsed.name),
  )
})
