/**
 * Le journal d'audit — la moitié « traçabilité » de l'invariant (c).
 *
 * La passerelle ne voit qu'un client machine anonyme : cette table est la **seule** trace de qui a
 * fait quoi. Une mutation qui aboutit sans y laisser de ligne est un trou dans la seule preuve dont
 * on dispose, et c'est pourquoi l'écriture n'est jamais « au mieux » — voir `mutate.ts`.
 *
 * ## Trois filets, et aucun n'est étanche
 *
 * Le mode d'échec des invariants (a) et (b) est toujours le même : un `after_json` qui verse une
 * entité entière venue de la passerelle — corps de message et secrets compris — dans une table faite
 * pour être relue. Trois barrières, du plus fort au plus faible :
 *
 * 1. **Le typage.** `AuditValue` exclut objets et tableaux, donc `{ after: entity }` ne compile pas.
 *    L'appelant doit nommer chaque champ, donc décider de chacun.
 * 2. **Le nom des clés** (`checkAuditPayload`), pour ce que le typage ne voit pas :
 *    `{ text: message.text }` compile parfaitement.
 * 3. **La forme des valeurs**, pour le contournement le plus probable de tous : `AuditValue` inclut
 *    `string`, donc `{ snapshot: JSON.stringify(entity) }` passe les deux premiers filets. Personne
 *    n'écrit `{ text: … }` volontairement ; tout le monde écrit un `JSON.stringify` pour aller vite.
 *    Une chaîne qui commence par `{` ou `[` est donc refusée.
 *
 * ## Ce que ce module ne protège pas — et il faut le lire avant de s'y fier
 *
 * Un secret ou un corps rangé sous un nom anodin et non sérialisé : `{ value: apiKey }`,
 * `{ preview: sms.slice(0, 40) }`. **Aucune liste de noms ne l'attrapera.** La borne de longueur
 * n'y change rien non plus : un SMS fait 160 caractères, il tient dans n'importe quelle borne
 * raisonnable — elle limite la taille des lignes, elle ne prouve aucune absence.
 *
 * La défense des invariants (a) et (b) reste que l'appelant ne mette **pas** ces valeurs dans le
 * payload. Ce module rattrape les formes nommées et sérialisées ; il ne rend pas l'appelant
 * inoffensif, et le prétendre serait pire que de l'écrire ici.
 */

import { isIP } from 'node:net'
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
  // Invariant (a) — le corps d'un message ne sort pas de l'onglet qui l'affiche. `text` couvre
  // `sms_text`, `body` couvre `message_body`. Les trois derniers sont les noms qu'on donne à un
  // corps qu'on croit avoir rendu inoffensif en le tronquant — il ne l'est pas.
  'body',
  'content',
  'text',
  'payload',
  'preview',
  'snippet',
  'excerpt',
  // Invariant (b) — un secret ne se réaffiche pas, donc ne se journalise pas non plus.
  //
  // Les six premiers viennent du contrat et du schéma de ce dépôt : `mfa_totp_secret`,
  // `password_hash`, `code_hash` (codes de récupération), `webauthn_challenge`,
  // `mfa_webauthn_credentials`, et les `secret` / `password` / `api_key` de l'API Admin. Le reste
  // est l'inventaire habituel du matériel cryptographique, ajouté avant d'en avoir besoin.
  'password',
  'passphrase',
  'secret',
  'token',
  'apikey',
  'privatekey',
  'credential',
  'recovery',
  'challenge',
  'hash',
  'salt',
  'pepper',
  'hmac',
  'signature',
  'encryptionkey',
  'signingkey',
  'pem',
]

/**
 * Bornes de forme sur les champs qui ne sont pas des payloads.
 *
 * `targetId` est le trou que le reste du module laissait ouvert : un `text` libre, inséré brut, et
 * c'est **le** champ qu'un appelant remplit avec une valeur venue de la requête. `targetId:
 * message.text` compilait, passait tous les filtres, et écrivait un corps de message dans la table
 * faite pour être relue.
 *
 * Un identifiant n'a ni espace ni saut de ligne : cette seule contrainte écarte tout corps de
 * message, tout en laissant passer les UUID, les codes de compte et les MSISDN.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:+-]{1,128}$/

/** Le verbe d'audit, tel que l'en-tête le décrit : `route.update`, `content.read`. */
const ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/

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

  for (const [key, value] of Object.entries(payload)) {
    const normalized = normalizeKey(key)
    const hit = FORBIDDEN_FRAGMENTS.find((fragment) => normalized.includes(fragment))

    if (hit) {
      throw new Error(
        `Journal d'audit : la clé « ${key} » de \`${where}_json\` porte un nom réservé (« ${hit} »). ` +
          `Un corps de message ou un secret ne se journalise pas (invariants a et b) — retirez ce champ du payload.`,
      )
    }

    checkAuditValue(where, key, value)
  }
}

/** Longueur au-delà de laquelle une valeur n'est plus un champ de contrôle. Voir l'en-tête. */
const MAX_VALUE_LENGTH = 512

/**
 * Refuse une entité sérialisée déguisée en chaîne.
 *
 * `{ snapshot: JSON.stringify(entity) }` est le contournement le plus probable de tout ce module :
 * il compile, il passe la liste de noms, et il verse l'entité entière. Une chaîne de payload d'audit
 * qui commence par `{` ou `[` n'est pas un champ de contrôle.
 *
 * La borne de longueur, elle, **ne prouve rien sur l'invariant (a)** — un SMS fait 160 caractères et
 * tiendrait dans n'importe quelle borne raisonnable. Elle est là pour la taille des lignes.
 */
function checkAuditValue(where: 'before' | 'after', key: string, value: AuditValue): void {
  if (typeof value !== 'string') return

  const trimmed = value.trim()

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    throw new Error(
      `Journal d'audit : la valeur de « ${key} » dans \`${where}_json\` est une structure sérialisée. ` +
        `Journalisez les champs un par un — un \`JSON.stringify\` d'entité y verserait corps et secrets (invariants a et b).`,
    )
  }

  if (value.length > MAX_VALUE_LENGTH) {
    throw new Error(
      `Journal d'audit : la valeur de « ${key} » dans \`${where}_json\` dépasse ${MAX_VALUE_LENGTH} caractères. ` +
        `Un champ de contrôle est court ; journalisez un identifiant plutôt qu'un contenu.`,
    )
  }
}

/**
 * Vérifie les champs hors payload, et **lance** comme le reste du module.
 *
 * `targetId` était le trou : un `text` libre inséré brut, et le champ qu'un appelant remplit le plus
 * volontiers avec une valeur venue de la requête. Voir `IDENTIFIER_PATTERN`.
 */
export function checkAuditSubject(entry: AuditSubject): void {
  if (!ACTION_PATTERN.test(entry.action)) {
    throw new Error(
      `Journal d'audit : l'action « ${entry.action} » ne suit pas la forme attendue ` +
        `(\`domaine.verbe\`, en minuscules — par exemple \`route.update\`). Un verbe stable se grep dans les logs.`,
    )
  }

  for (const [field, value] of [
    ['target_type', entry.targetType],
    ['target_id', entry.targetId],
  ] as const) {
    if (value !== undefined && !IDENTIFIER_PATTERN.test(value)) {
      // La valeur n'est **pas** citée : c'est précisément parce qu'elle pourrait être un corps de
      // message qu'elle est refusée, et la citer la publierait dans le premier log qui l'inspecte.
      throw new Error(
        `Journal d'audit : \`${field}\` n'a pas la forme d'un identifiant (128 caractères au plus, ` +
          `sans espace ni saut de ligne). Journalisez l'identifiant de la cible, jamais son contenu.`,
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

  // **Toute autre valeur invalide compte aussi, et pas seulement `unknown`.** Dès que
  // `AUTH_TRUSTED_PROXIES` vaut au moins 1, `readClientIp` rend un maillon de `x-forwarded-for` —
  // un en-tête fourni par l'appelant, dont rien ne valide la forme en amont. Le laisser passer
  // ferait échouer l'insertion en `22P02`, donc la transaction, donc **la mutation** : un en-tête
  // forgé deviendrait un interrupteur d'arrêt sur les écritures d'autrui. Et le message d'erreur de
  // PostgreSQL recopie la valeur reçue, ce qui la publierait au log par-dessus le marché.
  return isIP(trimmed) === 0 ? null : trimmed
}

/** Ce qu'une entrée d'audit désigne, hors payload : le champ que  vérifie. */
export type AuditSubject = {
  readonly action: string
  readonly targetType?: string
  readonly targetId?: string
}

export type AuditEntry = AuditSubject & {
  /** `null` pour une action de l'évaluateur d'alertes, qui n'a pas d'opérateur. */
  readonly operatorId: string | null
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
/**
 * Un payload, ou `NULL` — **`{}` compte comme rien**.
 *
 * Un objet vide est `truthy` : sans cette normalisation, un appelant qui construit son `after` en
 * filtrant une entité et qui filtre tout écrirait `after_json = '{}'`. La ligne *paraîtrait*
 * complète, et la relecture après incident (step-184) ne distinguerait pas « pas d'après » de
 * « après vide » — deux choses très différentes le jour où l'on cherche ce qui s'est passé.
 */
function jsonOrNull(payload?: AuditPayload) {
  return payload && Object.keys(payload).length > 0 ? payload : sql`null`
}

export async function recordAudit(db: Querier, entry: AuditEntry): Promise<void> {
  checkAuditSubject(entry)
  checkAuditPayload('before', entry.before)
  checkAuditPayload('after', entry.after)

  await db.insert(auditLog).values({
    operatorId: entry.operatorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    // `sql`null`` et non `undefined` : Drizzle traduit `undefined` par le mot-clé `default` de la
    // colonne, ce qui donne bien `NULL` aujourd'hui faute de défaut posé — mais cesserait de le
    // donner le jour où l'on en poserait un. Le `NULL` explicite ne dépend de rien.
    beforeJson: jsonOrNull(entry.before),
    afterJson: jsonOrNull(entry.after),
    ipAddress: auditIpAddress(entry.ipAddress),
  })
}
