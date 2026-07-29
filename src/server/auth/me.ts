/**
 * `GET /auth/me` — qui est connecté, et ce que l'interface a le droit d'afficher.
 *
 * ## Pour le rendu, jamais pour l'autorisation
 *
 * C'est l'**invariant (c)**, et c'est la seule chose à retenir de ce module. L'ensemble de
 * permissions rendu ici sert à décider quels boutons apparaissent — pas à décider si une action
 * aboutit. Chaque fonction serveur revérifie ses propres permissions (`requirePermission`,
 * step-025). Un contrôle masqué dont la route n'est pas gardée reste une faille : masquer n'est pas
 * interdire.
 *
 * ## Les permissions sont résolues à chaque appel
 *
 * Jamais lues depuis la session ni depuis le cookie. Un opérateur à qui l'on retire un rôle doit
 * perdre son pouvoir **immédiatement**, sans attendre qu'il se reconnecte — et un ensemble figé à
 * l'ouverture de session ferait survivre le pouvoir aussi longtemps que le cookie.
 */

import { eq } from 'drizzle-orm'
import type { PermissionKey } from '~/lib/permissions'
import type { Database } from '../db/index'
import { operatorSafeColumns, operators } from '../db/schema/auth'
import { resolveOperatorPermissions } from './resolve'
import type { SessionState } from './session'

export type CurrentOperator = {
  readonly id: string
  readonly email: string
  readonly displayName: string
  /** L'union des permissions de ses rôles, résolue à l'instant. Pour le rendu seulement. */
  readonly permissions: readonly PermissionKey[]
  /** `false` tant que le second facteur n'est pas passé : l'interface doit alors montrer le challenge. */
  readonly mfaCompleted: boolean
}

/**
 * Compose la réponse `/auth/me`, ou `undefined` s'il n'y a personne.
 *
 * Une session **partielle** rend un opérateur avec `mfaCompleted: false` et **aucune permission** :
 * l'interface a besoin de savoir qui est en train de s'authentifier pour afficher l'écran du second
 * facteur, mais lui donner ses permissions à ce stade permettrait de peindre un tableau de bord
 * complet à quelqu'un qui n'a présenté qu'un mot de passe.
 */
export async function currentOperator(
  db: Database,
  session: SessionState,
): Promise<CurrentOperator | undefined> {
  if (session.status === 'none') return undefined

  const [operator] = await db
    .select(operatorSafeColumns)
    .from(operators)
    .where(eq(operators.id, session.operatorId))

  if (!operator) return undefined

  const permissions =
    session.status === 'active' ? await resolveOperatorPermissions(db, session.operatorId) : []

  return {
    id: operator.id,
    email: operator.email,
    displayName: operator.displayName,
    permissions,
    mfaCompleted: session.status === 'active',
  }
}
