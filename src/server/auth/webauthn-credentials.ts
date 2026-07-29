/**
 * Les authentificateurs enregistrés d'un opérateur — la colonne `mfa_webauthn_credentials`.
 *
 * ## Un tableau JSONB, donc un verrou de ligne à chaque écriture
 *
 * Le schéma stocke la liste dans une colonne (§3.1), pas dans une table. C'est le bon choix pour la
 * lecture — un opérateur en a deux ou trois, toujours lus ensemble — mais toute écriture devient une
 * **lecture-modification-écriture**, et c'est le motif qui perd des données en concurrence : deux
 * enregistrements simultanés lisent la même liste, y ajoutent chacun le leur, et le second écrasant le
 * premier, un opérateur croit détenir deux passkeys là où il n'en a qu'une.
 *
 * Chaque mutation passe donc par `SELECT … FOR UPDATE` sur la ligne d'opérateur. Le coût est d'un
 * verrou sur une ligne pour quelques microsecondes ; le défaut qu'il évite est silencieux, et se
 * découvrirait le jour où le premier appareil serait perdu.
 *
 * ## Aucune clé privée, jamais
 *
 * Ce qui est stocké est une clé **publique**. C'est ce qui rend cette colonne moins sensible que
 * `mfa_totp_secret` — la lire ne permet pas de se faire passer pour l'opérateur, seule la signature de
 * l'appareil le permet. Elle n'est donc pas chiffrée au repos, et ce n'est pas un oubli.
 */

import { eq, sql } from 'drizzle-orm'
import type { Database } from '../db/index'
import { operators } from '../db/schema/auth'
import type { StoredCredential } from './webauthn'

/** Longueur maximale du nom que l'opérateur donne à un appareil. */
const MAX_NAME_LENGTH = 60

export type RegisteredCredential = StoredCredential & {
  /** Le nom que l'opérateur lui donne — « MacBook », « clé du coffre ». Jamais imposé par le serveur. */
  readonly name: string
  readonly createdAt: string
  readonly lastUsedAt?: string
  /** `singleDevice` ou `multiDevice` : c'est ce qui distingue une clé physique d'une passkey synchronisée. */
  readonly deviceType?: string
  readonly backedUp?: boolean
}

/** Les authentificateurs d'un opérateur, dans leur ordre d'enregistrement. */
export async function listCredentials(
  db: Database,
  operatorId: string,
): Promise<RegisteredCredential[]> {
  const [row] = await db
    .select({ credentials: operators.mfaWebauthnCredentials })
    .from(operators)
    .where(eq(operators.id, operatorId))

  return parse(row?.credentials)
}

/**
 * Enregistre un authentificateur. Rend `false` si cet identifiant est déjà présent.
 *
 * Le refus du doublon est dans la même transaction que la lecture : `excludeCredentials` dit déjà au
 * navigateur de ne pas proposer un appareil déjà enrôlé, mais c'est une politesse côté client — la
 * garantie est ici.
 */
export function addCredential(
  db: Database,
  operatorId: string,
  credential: Omit<RegisteredCredential, 'createdAt'>,
): Promise<boolean> {
  return mutate(db, operatorId, (existing) => {
    if (existing.some((entry) => entry.id === credential.id)) return undefined

    return [...existing, { ...credential, name: trimName(credential.name), createdAt: nowIso() }]
  })
}

/** Renomme un authentificateur. Rend `false` s'il n'existe pas. */
export function renameCredential(
  db: Database,
  operatorId: string,
  credentialId: string,
  name: string,
): Promise<boolean> {
  return mutate(db, operatorId, (existing) => {
    if (!existing.some((entry) => entry.id === credentialId)) return undefined

    return existing.map((entry) =>
      entry.id === credentialId ? { ...entry, name: trimName(name) } : entry,
    )
  })
}

/** Retire un authentificateur. Rend `false` s'il n'existe pas. La garde du dernier facteur est ailleurs. */
export function revokeCredential(
  db: Database,
  operatorId: string,
  credentialId: string,
): Promise<boolean> {
  return mutate(db, operatorId, (existing) => {
    if (!existing.some((entry) => entry.id === credentialId)) return undefined

    return existing.filter((entry) => entry.id !== credentialId)
  })
}

/**
 * Consigne un usage : nouveau compteur de signature et date de dernier usage.
 *
 * **Le compteur doit progresser strictement.** C'est la détection de clonage de la spécification : un
 * authentificateur dupliqué finit par présenter une valeur qui n'avance plus, et refuser ce cas est ce
 * qui la rend utile. Certains appareils — les passkeys synchronisées, notamment — laissent
 * délibérément le compteur à zéro ; la comparaison ne s'applique donc qu'à ceux qui le tiennent.
 */
export function recordCredentialUse(
  db: Database,
  operatorId: string,
  credentialId: string,
  newCounter: number,
): Promise<boolean> {
  return mutate(db, operatorId, (existing) => {
    const target = existing.find((entry) => entry.id === credentialId)
    if (!target) return undefined
    if (newCounter > 0 && newCounter <= target.counter) return undefined

    return existing.map((entry) =>
      entry.id === credentialId ? { ...entry, counter: newCounter, lastUsedAt: nowIso() } : entry,
    )
  })
}

/**
 * Applique une transformation à la liste, **sous verrou de ligne**.
 *
 * La transformation rend `undefined` pour refuser — doublon, identifiant inconnu, compteur qui
 * n'avance pas — et la transaction se termine alors sans écriture. C'est ce qui permet aux gardes
 * d'être évaluées *à l'intérieur* du verrou plutôt qu'avant lui, là où deux appelants se glisseraient.
 */
async function mutate(
  db: Database,
  operatorId: string,
  transform: (existing: RegisteredCredential[]) => RegisteredCredential[] | undefined,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const locked = await tx.execute<{ mfa_webauthn_credentials: unknown }>(sql`
      SELECT mfa_webauthn_credentials FROM operators WHERE id = ${operatorId} FOR UPDATE
    `)

    const row = locked[0]
    if (!row) return false

    const next = transform(parse(row.mfa_webauthn_credentials))
    if (!next) return false

    await tx
      .update(operators)
      .set({ mfaWebauthnCredentials: next, updatedAt: sql`now()` })
      .where(eq(operators.id, operatorId))

    return true
  })
}

/**
 * Relit la colonne sans jamais lever.
 *
 * Une colonne bricolée à la main — ce qui arrive en exploitation — doit se lire comme « aucun
 * authentificateur », donc aboutir à un refus, jamais à une erreur serveur qui rendrait la panne
 * indiscernable d'une attaque.
 */
function parse(value: unknown): RegisteredCredential[] {
  if (!Array.isArray(value)) return []

  return value.filter(
    (entry): entry is RegisteredCredential =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as RegisteredCredential).id === 'string' &&
      typeof (entry as RegisteredCredential).publicKey === 'string' &&
      typeof (entry as RegisteredCredential).counter === 'number',
  )
}

function trimName(name: string): string {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH)
  return trimmed.length > 0 ? trimmed : 'Authentificateur'
}

/** L'horodatage vient de Node et non de PostgreSQL : la valeur part dans un document JSON, pas dans une colonne. */
function nowIso(): string {
  return new Date().toISOString()
}
