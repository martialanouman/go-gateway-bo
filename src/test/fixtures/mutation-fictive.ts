/**
 * Le maillon intermédiaire du cas gardé.
 *
 * Il existe pour que la fixture gardée n'écrive **pas** elle-même `mutate` : ce que le détecteur
 * doit établir est qu'une garde est atteinte par la fermeture d'imports, pas qu'un mot figure dans
 * le fichier du handler. Un détecteur qui ne lirait que le premier niveau passerait ce test à côté,
 * et laisserait passer en production toute route qui délègue sa mutation — c'est-à-dire toutes.
 */

import type { SessionState } from '~/server/auth/session'
import { mutate } from '~/server/authz/mutate'
import type { Database } from '~/server/db/index'

export function renameFixture(db: Database, session: SessionState, name: string) {
  return mutate(
    db,
    { session, permission: 'operators:manage', action: 'fixture.rename' },
    async () => ({ result: name, after: { display_name: name } }),
  )
}
