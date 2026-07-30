/**
 * L'autorisation — **invariant (c)**, et le seul endroit où il vit.
 *
 * ## Pourquoi un répertoire à part
 *
 * `src/server/auth/` répond à « qui est connecté ». Ce répertoire-ci répond à « a-t-il le droit de
 * faire ceci ». Les deux questions se ressemblent assez pour être confondues, et la confusion a
 * toujours le même effet : une session valide finit par valoir une autorisation. La frontière est
 * donc un répertoire et non un paragraphe.
 *
 * ## Ce que la garde ne remplace pas, et ce qui ne la remplace pas
 *
 * Le rendu conditionnel de l'interface (step-026) est un **confort**. Il masque un bouton ; il
 * n'interdit rien. Un opérateur qui poste directement sur la route atteint la fonction serveur, et
 * c'est ici — et uniquement ici — qu'il est arrêté. La raison d'être de cette step tient en une
 * phrase : **le jeton machine du BFF porte `content:read` en permanence**. Sans cette garde, tout
 * opérateur pourrait lire le corps d'un message, l'invariant (a) ne tenant plus qu'à l'absence de
 * bouton.
 *
 * ## Le second facteur est une condition d'autorisation, pas seulement d'authentification
 *
 * La step-025 demande qu'une session sans MFA passée n'atteigne « aucune permission d'écriture ni
 * `content:read` / `gdpr:erase` » (§6.9, « MFA requis pour les rôles privilégiés »). La règle
 * appliquée ici est **plus stricte** : une session partielle n'atteint **aucune** permission.
 *
 * C'est un choix, et il vaut d'être écrit. Distinguer les clés « privilégiées » des autres
 * demanderait une table à tenir à jour à chaque ajout au catalogue ; une clé oubliée y serait
 * classée « anodine » par défaut, c'est-à-dire du mauvais côté. Refuser tout ne demande rien à
 * personne et n'a aucun coût réel : une session partielle vit dix minutes, ne sert qu'à porter le
 * second facteur, et `/auth/me` ne lui rend déjà aucune permission.
 */

import type { PermissionKey } from '~/lib/permissions'
import { resolveOperatorPermissions } from '../auth/resolve'
import type { SessionState } from '../auth/session'
import type { Database } from '../db/index'

/**
 * Les trois codes de refus produits par le BFF lui-même.
 *
 * Ils ne viennent pas du contrat de la passerelle — celui-ci décrit ce que l'*API Admin* refuse, pas
 * ce que le tableau de bord refuse à ses propres opérateurs. Ils suivent en revanche la même forme
 * d'enveloppe (§1.4), parce qu'il n'y a qu'une forme d'erreur dans tout le produit.
 */
export const AUTHZ_CODES = {
  /**
   * Aucune session exploitable : absente, expirée, ou révoquée.
   *
   * Un opérateur **désactivé** y tombe aussi, mais par un autre chemin : `readSession` filtre sur
   * `operators.status`, si bien que sa session ne se résout déjà plus. Il n'atteint donc pas
   * `authorize` avec une session active — et s'il y était forcé, il obtiendrait `permission_denied`,
   * `resolveOperatorPermissions` filtrant lui aussi sur le statut. La distinction n'a pas d'effet
   * observable ; l'écrire évite de croire que cette garde-ci s'occupe des comptes fermés.
   */
  sessionAbsent: 'session_absent',
  /** Session ouverte, second facteur pas encore franchi. */
  mfaRequired: 'mfa_required',
  /** Session complète, permission absente de l'ensemble de l'opérateur. */
  denied: 'permission_denied',
} as const

export type AuthzCode = (typeof AUTHZ_CODES)[keyof typeof AUTHZ_CODES]

/**
 * Le refus, dans la forme d'enveloppe du produit (§1.4).
 *
 * `errors[]` est **toujours présent**, et toujours vide ici : une autorisation ne porte pas sur un
 * champ de formulaire. Le laisser tomber quand il est vide obligerait chaque appelant à traiter deux
 * formes d'erreur au lieu d'une — et c'est la seconde qu'on oublierait.
 */
export type Refusal = {
  readonly code: AuthzCode
  readonly message: string
  readonly errors: readonly { readonly field: string }[]
}

export type Authorization =
  | { readonly granted: true; readonly operatorId: string; readonly sessionId: string }
  | { readonly granted: false; readonly refusal: Refusal }

const SESSION_ABSENT_MESSAGE =
  'Action refusée : session absente ou expirée. Reconnectez-vous pour poursuivre.'

/**
 * Le refus du second facteur **dit la conduite à tenir**, contrairement au refus de connexion.
 *
 * Celui qui le reçoit détient déjà une session ouverte par un mot de passe valide : lui cacher ce
 * qui manque ne protégerait rien et le laisserait sans issue visible.
 */
const MFA_REQUIRED_MESSAGE =
  'Action refusée : franchissez votre second facteur avant d’agir sur la plateforme.'

/**
 * Le refus de permission **nomme la clé manquante**.
 *
 * « Un contrôle interdit est désactivé et expliqué, jamais silencieusement masqué » : un refus muet
 * envoie l'opérateur chercher un contournement, alors que la clé nommée lui dit quoi demander. Elle
 * ne divulgue rien — l'opérateur connaît déjà son propre ensemble par `/auth/me`, et le catalogue
 * est figé et public au sein du produit.
 */
function deniedMessage(key: PermissionKey): string {
  return `Action refusée : cette action demande la permission « ${key} », que votre compte ne détient pas.`
}

function refuse(code: AuthzCode, message: string): Authorization {
  return { granted: false, refusal: { code, message, errors: [] } }
}

/**
 * La décision, sans aucune entrée/sortie.
 *
 * Totale sur les trois états de session, pour que chaque chemin de refus se couvre sans base de
 * données. `granted` est l'ensemble **déjà résolu** de l'opérateur ; il n'est consulté que pour une
 * session complète, les deux autres états étant tranchés avant.
 */
export function authorize(
  session: SessionState,
  granted: readonly PermissionKey[],
  key: PermissionKey,
): Authorization {
  if (session.status === 'none') return refuse(AUTHZ_CODES.sessionAbsent, SESSION_ABSENT_MESSAGE)

  // Avant la vérification de la clé, et non après : une session partielle n'atteint rien, y compris
  // ce qu'elle détient. Voir l'en-tête pour la raison de cette sévérité.
  if (session.status === 'pending_mfa') return refuse(AUTHZ_CODES.mfaRequired, MFA_REQUIRED_MESSAGE)

  if (!granted.includes(key)) return refuse(AUTHZ_CODES.denied, deniedMessage(key))

  return { granted: true, operatorId: session.operatorId, sessionId: session.sessionId }
}

/**
 * La garde composable : à appeler au début de **toute** fonction serveur protégée.
 *
 * Les permissions sont résolues à chaque appel, jamais lues depuis la session ni depuis le cookie —
 * retirer un rôle doit retirer le pouvoir immédiatement, sans attendre une reconnexion. C'est le
 * même choix que `/auth/me`, et il passe par la même fonction : deux chemins de calcul finiraient
 * par diverger, et l'un des deux serait plus permissif.
 *
 * La base n'est **pas** interrogée quand la session ne peut de toute façon rien obtenir : un refus
 * ne doit pas coûter une requête, sinon il devient un moyen de charger la base sans être connecté.
 */
export async function requirePermission(
  db: Database,
  session: SessionState,
  key: PermissionKey,
): Promise<Authorization> {
  if (session.status !== 'active') return authorize(session, [], key)

  return authorize(session, await resolveOperatorPermissions(db, session.operatorId), key)
}
