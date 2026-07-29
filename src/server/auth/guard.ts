/**
 * La garde de session : du cookie brut jusqu'à l'état vérifié.
 *
 * Un seul chemin, emprunté par tous les handlers. Deux chemins finiraient par diverger, et c'est
 * toujours le plus permissif qui survit — celui qu'on a écrit en dernier, pour débloquer un écran.
 *
 * ## Ce que cette garde n'est pas
 *
 * Elle répond à « **qui est connecté, et son second facteur est-il passé ?** ». Elle ne répond
 * jamais à « a-t-il le droit de faire ceci ». L'autorisation par permission est une vérification
 * distincte, appliquée dans chaque fonction serveur (`requirePermission`, step-025), et l'invariant
 * (c) tient précisément à ce que les deux ne se confondent pas : une session valide n'autorise rien
 * par elle-même.
 */

import type { Database } from '../db/index'
import { SESSION_COOKIE_NAME, type SessionSecrets, verifySessionCookie } from './cookie'
import { readSession, type SessionState } from './session'

/**
 * Extrait la valeur du cookie de session d'un en-tête `Cookie` brut.
 *
 * Écrit à la main plutôt que par une bibliothèque : l'en-tête est simple, et la seule subtilité qui
 * compte est qu'une valeur peut contenir des `=` — la découpe se fait donc au **premier** signe
 * égal, jamais par un `split('=')` qui tronquerait silencieusement une signature.
 */
export function readSessionCookie(header: string | null | undefined): string | undefined {
  if (!header) return undefined

  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue

    if (part.slice(0, separator).trim() === SESSION_COOKIE_NAME) {
      const value = part.slice(separator + 1).trim()
      return value.length > 0 ? value : undefined
    }
  }

  return undefined
}

/**
 * L'état de session porté par une requête.
 *
 * Rend `none` pour tout ce qui n'est pas une session vivante : cookie absent, signature invalide,
 * session révoquée, échue, inactive, ou opérateur désactivé. **Un seul cas**, parce que les
 * distinguer dans une réponse reviendrait à renseigner l'appelant sur ce qu'il n'a pas.
 */
export async function resolveSession(
  db: Database,
  cookieHeader: string | null | undefined,
  secrets: SessionSecrets,
): Promise<SessionState> {
  const cookie = readSessionCookie(cookieHeader)
  if (!cookie) return { status: 'none' }

  // La signature filtre en mémoire ce qui n'a jamais été émis ici : un cookie forgé ne coûte pas une
  // requête. Elle ne dit pas pour autant que la session est encore valable — seule la base le dit.
  const sessionId = verifySessionCookie(cookie, secrets)
  if (!sessionId) return { status: 'none' }

  return readSession(db, sessionId)
}
