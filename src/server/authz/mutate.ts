/**
 * Le seul chemin par lequel une mutation du BFF doit passer.
 *
 * Trois choses qui doivent aller ensemble, et qui se séparent dès qu'on les écrit séparément : la
 * permission vérifiée, la mutation appliquée, la ligne d'audit écrite. Laissées à la discipline de
 * chaque route, l'une des trois finit par manquer — et c'est toujours l'audit, parce que c'est la
 * seule dont l'absence ne se voit pas à l'écran.
 *
 * ## L'audit valide avec la mutation, ou pas du tout
 *
 * Les deux écritures partagent une transaction. Ce n'est pas un raffinement : si l'audit échouait
 * après coup, la mutation resterait appliquée sans trace, et la table qui sert de **seule** preuve
 * de qui a fait quoi mentirait par omission. La step le pose ainsi — « échec d'audit = échec de
 * l'opération, jamais un succès silencieux ».
 *
 * Corollaire à assumer : une clé de payload interdite (voir `audit.ts`) fait échouer l'action. C'est
 * voulu. Le mode d'échec inverse — journaliser un corps de message parce que refuser aurait gêné —
 * est celui que l'invariant (a) existe pour empêcher.
 *
 * ## Ce qui reste dehors
 *
 * L'appel à l'API Admin. Il ne peut pas participer à une transaction PostgreSQL, et prétendre le
 * contraire serait un mensonge coûteux. Le motif à suivre chez l'appelant, à partir de la step-061 :
 * appeler la passerelle **dans** le bloc, de sorte qu'un échec distant lève avant la validation et
 * n'écrive aucune ligne. Une passerelle qui réussit et une transaction qui échoue reste possible —
 * la trace manque alors pour une action faite, ce qui est le sens le moins dangereux des deux.
 *
 * Deux conséquences à ne pas découvrir en production, et qui portent sur l'appelant :
 *
 * - l'appel distant tient une connexion du pool et ses verrous pendant tout l'aller-retour. Il doit
 *   être borné par un `AbortSignal.timeout()` plus court que l'`idle_in_transaction_session_timeout`
 *   posé dans `db/index.ts` — sinon dix mutations lentes figent la console entière ;
 * - `checkAuditSubject` et `before` sont vérifiés **avant** la transaction, mais `after` ne peut
 *   l'être qu'après le bloc. Un payload `after` refusé après un appel distant réussi laisse donc la
 *   passerelle mutée sans trace. C'est l'unique fenêtre de ce genre, et la refermer demanderait une
 *   ligne d'intention validée avant l'appel — à trancher en step-061, pas ici.
 *
 * ## Ce que ce combinateur ne peut pas empêcher
 *
 * Que `run` ignore le `tx` reçu et écrive par le `db` extérieur, resté dans la portée lexicale de
 * l'appelant. La mutation sortirait alors de la transaction et survivrait à un échec d'audit. Aucun
 * typage raisonnable ne le referme ; c'est un point de revue, et le test d'énumération n'en dit
 * rien. De même, un appelant peut appeler `requirePermission` et **jeter le résultat** : le refus
 * est une valeur, pas une exception. `mutate` est le chemin par défaut précisément pour que ces deux
 * fautes demandent d'en sortir délibérément.
 */

import type { PermissionKey } from '~/lib/permissions'
import type { SessionState } from '../auth/session'
import type { Database, Transaction } from '../db/index'
import { type AuditPayload, checkAuditPayload, checkAuditSubject, recordAudit } from './audit'
import { type Refusal, requirePermission } from './permission'

export type MutationRequest = {
  readonly session: SessionState
  /** La clé exigée. Le typage refuse une clé absente du catalogue — donc une garde qui ne garde rien. */
  readonly permission: PermissionKey
  /** Verbe stable et greppable : `operator.rename`, `route.update`, `credentials.rotate`. */
  readonly action: string
  readonly targetType?: string
  readonly targetId?: string
  readonly ipAddress?: string
  readonly before?: AuditPayload
}

/**
 * Ce que le bloc de mutation rend.
 *
 * `targetId` et `after` y figurent parce qu'une création ne connaît son identifiant qu'après
 * l'écriture : les exiger d'avance obligerait l'appelant à mentir ou à auditer sans cible.
 */
export type Mutation<T> = {
  readonly result: T
  readonly targetId?: string
  readonly after?: AuditPayload
}

/**
 * Qui agit, tel que la garde vient de le décider.
 *
 * Passé au bloc plutôt que relu depuis `request.session` : la session porte bien le même
 * identifiant, mais s'en servir demanderait à chaque appelant d'écarter d'abord les états qui n'en
 * ont pas — donc, un jour, d'écrire `session.operatorId ?? ''`. Une chaîne vide passée à une garde
 * d'auto-verrouillage (step-027) la désactiverait en silence.
 */
export type MutationActor = { readonly operatorId: string; readonly sessionId: string }

export type MutationOutcome<T> =
  | { readonly granted: true; readonly result: T }
  | { readonly granted: false; readonly refusal: Refusal }

/**
 * Vérifie, mute, audite — dans cet ordre, et sans issue par le milieu.
 *
 * La permission est vérifiée **avant** d'ouvrir la transaction : un refus ne doit pas coûter un
 * verrou. Le refus est rendu, jamais lancé — il fait partie du fonctionnement normal du produit, et
 * une exception pousserait chaque appelant à écrire un `try` autour d'un cas qui n'a rien
 * d'exceptionnel.
 *
 * Ce qui **est** lancé, en revanche : l'échec de la mutation et celui de l'audit. Les deux sont des
 * pannes, et les transformer en valeur de retour les rendrait ignorables.
 */
export async function mutate<T>(
  db: Database,
  request: MutationRequest,
  run: (tx: Transaction, actor: MutationActor) => Promise<Mutation<T>>,
): Promise<MutationOutcome<T>> {
  const decision = await requirePermission(db, request.session, request.permission)
  if (!decision.granted) return decision

  // Ce qui peut être vérifié **avant** d'agir l'est avant d'agir. `before` et le sujet ne dépendent
  // pas du bloc : les laisser échouer après coup ferait payer à la passerelle un refus purement
  // local — elle aurait muté, la transaction serait annulée, et il ne resterait aucune trace.
  checkAuditSubject(request)
  checkAuditPayload('before', request.before)

  const result = await db.transaction(async (tx) => {
    const mutation = await run(tx, {
      operatorId: decision.operatorId,
      sessionId: decision.sessionId,
    })

    await recordAudit(tx, {
      operatorId: decision.operatorId,
      action: request.action,
      targetType: request.targetType,
      // Ce que le bloc a appris prime sur ce que l'appelant croyait savoir : une création ne
      // connaît son identifiant qu'ici.
      targetId: mutation.targetId ?? request.targetId,
      before: request.before,
      after: mutation.after,
      ipAddress: request.ipAddress,
    })

    return mutation.result
  })

  return { granted: true, result }
}
