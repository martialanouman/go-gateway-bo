/**
 * Une route qui **délègue sa garde** à un module de service — et que le détecteur doit signaler.
 *
 * C'est le faux positif que la détection transitive rouvrait, et il n'a rien de tordu : dès la
 * step-061, un module de service exportera à la fois des lectures et des mutations. Le handler n'en
 * importe qu'une, l'import est réellement utilisé — le linter ne dit rien — et la fermeture
 * d'imports suffisait à créditer une route qui n'appelle aucune garde.
 *
 * Ici, `mutation-fictive.ts` importe bien `mutate`, mais ce fichier-ci ne l'importe pas. La
 * convention veut que la garde vive dans la fonction serveur : cette route est donc non gardée, et
 * le remède est de remonter l'appel d'un cran.
 */

import type { SessionState } from '~/server/auth/session'
import type { Database } from '~/server/db/index'
import { renameFixture } from './mutation-fictive'

export function handleDelegatingRoute(db: Database, session: SessionState) {
  return renameFixture(db, session, 'Nom modifié')
}
