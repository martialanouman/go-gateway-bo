/**
 * `GET /api/auth/mfa/passkeys` — la liste des appareils enregistrés.
 *
 * Aucune permission dédiée : un opérateur lit **ses** appareils, et la session dit lesquels. La
 * gestion des facteurs d'un autre opérateur est une opération administrative (step-027).
 */

import { defineEventHandler, getRequestHeader } from 'h3'
import { getDatabase } from '../../db/index'
import { resolveSession } from '../guard'
import { meResponse, passkeyListResponse } from '../http'
import { listPasskeys } from '../mfa-webauthn'
import { getSessionSecrets } from '../secrets'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const session = await resolveSession(db, getRequestHeader(event, 'cookie'), getSessionSecrets())
  if (session.status === 'none') return meResponse(undefined)

  return passkeyListResponse(await listPasskeys(db, session))
})
