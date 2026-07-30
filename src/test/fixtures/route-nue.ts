/**
 * Le cas fabriqué que la step-025 demande : **une route de mutation qui ne garde rien**.
 *
 * Elle écrit en base sans vérifier de permission et sans laisser de trace. C'est exactement la forme
 * de l'oubli qu'on cherche à rendre impossible : rien ne la distingue d'une route correcte à la
 * lecture, elle fonctionne parfaitement, et elle ouvre à tout opérateur ce que le catalogue réserve
 * à quelques-uns.
 *
 * Elle n'est déclarée dans aucun `vite.config.ts`. Si elle l'était, le test principal échouerait —
 * ce qui est précisément la démonstration.
 */

import { eq } from 'drizzle-orm'
import type { Database } from '~/server/db/index'
import { operators } from '~/server/db/schema/auth'

export function handleBareRoute(db: Database, operatorId: string, name: string) {
  return db.update(operators).set({ displayName: name }).where(eq(operators.id, operatorId))
}
