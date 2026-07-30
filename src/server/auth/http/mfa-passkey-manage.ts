/**
 * `POST /api/auth/mfa/passkeys/manage` — renommer ou retirer un appareil.
 *
 * **Une session complète est exigée.** Retirer un facteur est un geste de sécurité : le permettre
 * depuis une session partielle laisserait un mot de passe volé démonter le second facteur pièce par
 * pièce. La garde du dernier facteur, elle, vit dans `mfa-webauthn.ts`.
 */

import { defineEventHandler, getRequestHeader } from 'h3'
import { getDatabase } from '../../db/index'
import { resolveSession } from '../guard'
import { meResponse, parsePasskeyId, passkeyRevokeResponse } from '../http'
import { renamePasskey, revokePasskey } from '../mfa-webauthn'
import { getSessionSecrets } from '../secrets'
import { readJsonBody } from './json-body'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const session = await resolveSession(db, getRequestHeader(event, 'cookie'), getSessionSecrets())
  if (session.status !== 'active') return meResponse(undefined)

  const body = await readJsonBody(event)
  const credentialId = parsePasskeyId(body)
  if (!credentialId) return passkeyRevokeResponse({ outcome: 'unknown_credential' })

  const name = (body as { name?: unknown } | undefined)?.name

  return passkeyRevokeResponse(
    typeof name === 'string'
      ? await renamePasskey(db, session, credentialId, name)
      : await revokePasskey(db, session, credentialId),
  )
})
