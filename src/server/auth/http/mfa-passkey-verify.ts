/**
 * `POST /api/auth/mfa/passkey/verify` — la coquille HTTP, et rien d'autre.
 *
 * **Seule une session partielle entre ici**, comme pour la vérification TOTP : une session complète
 * n'a rien à vérifier, et la laisser repasser offrirait un point de devinette de plus.
 */

import { defineEventHandler, getRequestHeader } from 'h3'
import { getDatabase } from '../../db/index'
import { resolveSession } from '../guard'
import { meResponse, parsePasskeyAuthentication, passkeyVerifyResponse } from '../http'
import { finishPasskeyAuthentication, startPasskeyAuthentication } from '../mfa-webauthn'
import { getSessionSecrets, getWebAuthnConfig } from '../secrets'
import { readJsonBody } from './json-body'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const session = await resolveSession(db, getRequestHeader(event, 'cookie'), getSessionSecrets())
  if (session.status !== 'pending_mfa') return meResponse(undefined)

  const parsed = parsePasskeyAuthentication(await readJsonBody(event))
  const config = getWebAuthnConfig()

  if (parsed.phase === 'start') {
    return passkeyVerifyResponse(await startPasskeyAuthentication(db, config, session))
  }

  if (parsed.phase === 'invalid') return passkeyVerifyResponse({ outcome: 'invalid_response' })

  return passkeyVerifyResponse(
    await finishPasskeyAuthentication(db, config, session, parsed.response),
  )
})
