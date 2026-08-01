/**
 * Ce que toute coquille de l'annuaire lit avant de décider : la base, la session, l'adresse, le corps.
 *
 * Écrit une fois plutôt que neuf : la règle qui compte est celle du corps — **uniquement du JSON**
 * (`json-body.ts`) —, et neuf copies de quatre lignes auraient fini par diverger sur ce détail-là.
 *
 * **Ce module ne garde rien**, et c'est délibéré. La permission s'appelle depuis le handler
 * lui-même : `routes-gardees.test.ts` exige l'import de `requirePermission` ou `mutate` **dans** la
 * fonction serveur, précisément pour qu'une garde déléguée à un utilitaire commun ne puisse pas
 * disparaître de cet utilitaire sans que rien ne rougisse.
 */

import { getRequestHeader, getRequestIP, type H3Event } from 'h3'
import { readClientIp, readTrustedProxyCount } from '../../auth/client-ip'
import { resolveSession } from '../../auth/guard'
import { readJsonBody } from '../../auth/http/json-body'
import { getSessionSecrets } from '../../auth/secrets'
import type { SessionState } from '../../auth/session'
import { type Database, getDatabase } from '../../db/index'

export type AdminContext = {
  readonly db: Database
  readonly session: SessionState
  readonly ipAddress: string
  readonly body: unknown
}

export async function adminContext(event: H3Event): Promise<AdminContext> {
  const db = getDatabase()
  const session = await resolveSession(db, getRequestHeader(event, 'cookie'), getSessionSecrets())

  return {
    db,
    session,
    ipAddress: readClientIp(
      {
        forwardedFor: getRequestHeader(event, 'x-forwarded-for'),
        remoteAddress: getRequestIP(event),
      },
      readTrustedProxyCount(process.env),
    ),
    body: await readJsonBody(event),
  }
}
