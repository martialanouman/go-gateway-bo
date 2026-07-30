/**
 * Une route de mutation **correctement gardée**, telle que le détecteur doit la voir.
 *
 * Elle appelle `mutate` elle-même, ce qui est la convention que `routes-gardees.test.ts` impose et
 * que `CLAUDE.md` énonce : la garde vit dans la fonction serveur. Sa jumelle `route-deleguee.ts`
 * montre le cas refusé — une garde déléguée à un module de service.
 *
 * Elle n'est déclarée dans aucun `BFF_ROUTES` : elle ne sert qu'à éprouver le détecteur en positif.
 * Sans elle, un détecteur qui crierait sur tout passerait pour un détecteur qui marche.
 */

import type { SessionState } from '~/server/auth/session'
import { mutate } from '~/server/authz/mutate'
import type { Database } from '~/server/db/index'

export function handleFixtureRoute(db: Database, session: SessionState) {
  return mutate(
    db,
    { session, permission: 'operators:manage', action: 'fixture.rename' },
    async () => ({ result: 'Nom modifié', after: { display_name: 'Nom modifié' } }),
  )
}
