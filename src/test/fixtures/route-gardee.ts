/**
 * Une route de mutation **correctement gardée**, telle que le détecteur doit la voir.
 *
 * Elle n'est déclarée dans aucun `vite.config.ts` : elle ne sert qu'à prouver que
 * `routes-gardees.test.ts` reconnaît une garde atteinte **indirectement** — ici via
 * `mutation-fictive.ts`. Sans ce cas, un détecteur cassé rendrait le test principal vert à jamais.
 */

import type { SessionState } from '~/server/auth/session'
import type { Database } from '~/server/db/index'
import { renameFixture } from './mutation-fictive'

export function handleFixtureRoute(db: Database, session: SessionState) {
  return renameFixture(db, session, 'Nom modifié')
}
