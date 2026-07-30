/** Un handler réaliste : il résout la session comme tous les autres, et ne garde RIEN. */

import type { SessionSecrets } from '~/server/auth/cookie'
import { resolveSession } from '~/server/auth/guard'
import type { Database } from '~/server/db/index'

export async function handleRealisticRoute(db: Database, cookie: string, s: SessionSecrets) {
  const session = await resolveSession(db, cookie, s)
  return session.status === 'active' ? 'muté sans permission ni audit' : 'refusé'
}
