/**
 * Le journal d'audit — la moitié « traçabilité » de l'invariant (c).
 *
 * La passerelle ne voit qu'un client machine anonyme : cette table est la **seule** trace de qui a
 * fait quoi. Une mutation qui aboutit sans y laisser de ligne est un trou dans la seule preuve dont
 * on dispose, et c'est pourquoi l'écriture n'est jamais « au mieux » — voir `mutate.ts`.
 *
 * ## Ce que le payload a le droit de porter, et pourquoi c'est si étroit
 *
 * `AuditValue` exclut les objets et les tableaux. Ce n'est pas une simplification : c'est la
 * défense. Le mode d'échec des invariants (a) et (b) est toujours le même — un `after_json: entity`
 * qui verse une entité entière venue de la passerelle, corps de message et secrets compris, dans une
 * table faite pour être relue. Un type scalaire et plat rend ce geste **impossible à compiler** :
 * l'appelant doit nommer chaque champ qu'il journalise, donc décider de chacun.
 *
 * `checkAuditPayload` est le second filet, à l'exécution, pour ce que le typage ne peut pas voir :
 * `{ text: message.text }` compile parfaitement. Il porte sur le **nom** des clés.
 *
 * ## Ce que ce module ne protège pas
 *
 * Un secret rangé sous un nom anodin — `{ value: apiKey }`. Aucune liste de noms ne l'attrapera, et
 * prétendre le contraire serait pire que de l'écrire ici : la défense des invariants (a) et (b) est
 * que l'appelant ne mette **pas** ces valeurs dans le payload. Ce module rattrape les formes
 * nommées, il ne rend pas l'appelant inoffensif.
 */

import { sql } from 'drizzle-orm'
import { UNKNOWN_CLIENT_IP } from '../auth/client-ip'
import type { Querier } from '../db/index'
import { auditLog } from '../db/schema/audit'

/** Un scalaire. Voir l'en-tête : l'absence d'objet et de tableau est le cœur de la protection. */
export type AuditValue = string | number | boolean | null

export type AuditPayload = Readonly<Record<string, AuditValue>>

/**
 * Les fragments de nom qui font refuser une clé.
 *
 * Comparés en **sous-chaîne** sur la clé normalisée : `webhook_secret`, `webhookSecret` et
 * `SECRET` tombent tous sur `secret`, sans qu'il faille énumérer les graphies. Le prix est quelques
 * faux positifs plausibles — `content_type`, et `context` qui se termine par `text` — et c'est le
 * bon sens de l'erreur : une clé refusée à tort se renomme en une ligne, une clé acceptée à tort se
 * découvre dans un journal, des mois plus tard.
 *
 * `text` en particulier n'est pas négociable : c'est le nom que **le contrat** donne au corps d'un
 * message (`errors[].field === 'text'` sur un envoi trop long). Le retirer viderait de sa substance
 * la protection de l'invariant (a) au profit d'une gêne théorique.
 */
const FORBIDDEN_FRAGMENTS: readonly string[] = [
  // Invariant (a) — le corps d'un message ne sort pas de l'onglet qui l'affiche.
  'body',
  'content',
  'text',
  'payload',
  // Invariant (b) — un secret ne se réaffiche pas, donc ne se journalise pas non plus.
  'password',
  'passphrase',
  'secret',
  'token',
  'apikey',
  'privatekey',
  'credential',
]

/** `webhook_secret` et `webhookSecret` doivent se comparer à l'identique. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
}

/**
 * Vérifie un payload, et **lance** si une clé est interdite.
 *
 * Lancer plutôt que filtrer : un filtrage silencieux laisserait la mutation aboutir avec un audit
 * amputé, ce que la step nomme « un succès silencieux » et interdit. L'exception remonte jusqu'à la
 * transaction, qui n'est pas validée — l'action échoue avec son audit, ce qui est la seule issue
 * honnête.
 *
 * **Le message ne cite jamais la valeur**, seulement la clé. Une erreur qui recopie ce qu'elle
 * refuse le publie dans le premier log qui l'inspecte : ce serait exactement la fuite que ce module
 * existe pour empêcher.
 */
export function checkAuditPayload(where: 'before' | 'after', payload?: AuditPayload): void {
  if (!payload) return

  for (const key of Object.keys(payload)) {
    const normalized = normalizeKey(key)
    const hit = FORBIDDEN_FRAGMENTS.find((fragment) => normalized.includes(fragment))

    if (hit) {
      throw new Error(
        `Journal d'audit : la clé « ${key} » de \`${where}_json\` porte un nom réservé (« ${hit} »). ` +
          `Un corps de message ou un secret ne se journalise pas (invariants a et b) — retirez ce champ du payload.`,
      )
    }
  }
}

/**
 * L'adresse à écrire dans `ip_address`, ou `null`.
 *
 * La colonne est de type `inet` : le littéral `unknown` que produit `readClientIp` quand la
 * topologie n'est pas déclarée y ferait échouer l'insertion — donc la mutation, puisque l'audit et
 * elle réussissent ensemble. Une adresse qu'on n'a pas su déterminer s'écrit « absente ».
 */
export function auditIpAddress(ip?: string): string | null {
  const trimmed = ip?.trim()
  if (!trimmed || trimmed === UNKNOWN_CLIENT_IP) return null
  return trimmed
}

export type AuditEntry = {
  /** `null` pour une action de l'évaluateur d'alertes, qui n'a pas d'opérateur. */
  readonly operatorId: string | null
  /** Verbe stable et greppable : `route.update`, `credentials.rotate`, `content.read`. */
  readonly action: string
  readonly targetType?: string
  readonly targetId?: string
  readonly before?: AuditPayload
  readonly after?: AuditPayload
  readonly ipAddress?: string
}

/**
 * Écrit une ligne d'audit.
 *
 * Prend un `Querier` et non un `Database` : appelée dans la transaction de la mutation qu'elle
 * journalise, elle valide ou échoue avec elle. C'est ce qui rend impossible une mutation appliquée
 * dont l'audit manquerait.
 */
export async function recordAudit(db: Querier, entry: AuditEntry): Promise<void> {
  checkAuditPayload('before', entry.before)
  checkAuditPayload('after', entry.after)

  await db.insert(auditLog).values({
    operatorId: entry.operatorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    // `sql`null`` et non `undefined` : Drizzle omettrait la colonne, ce qui est équivalent ici mais
    // cesserait de l'être le jour où un défaut serait posé dessus.
    beforeJson: entry.before ?? sql`null`,
    afterJson: entry.after ?? sql`null`,
    ipAddress: auditIpAddress(entry.ipAddress),
  })
}
