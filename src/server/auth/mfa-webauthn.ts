/**
 * Le second facteur par passkey : ce qui se décide.
 *
 * `webauthn.ts` fait les cérémonies, `webauthn-credentials.ts` tient la liste, `session.ts` porte le
 * défi. Ici vivent les règles — qui peut enregistrer un appareil, ce qu'un échec coûte, et ce qu'on
 * refuse de retirer.
 *
 * ## Qui peut enregistrer un appareil, et c'est la garde qui compte
 *
 * - **Aucun facteur actif** : une session partielle suffit. C'est le premier enrôlement, et il n'y a
 *   pas d'autre chemin — exiger un facteur pour en créer un premier n'ouvrirait jamais la porte. La
 *   fenêtre de confiance initiale est assumée, et c'est step-025 qui la ferme en rendant le MFA
 *   obligatoire par rôle.
 * - **Un facteur existe déjà** : il faut une session **complète**. Sans cela, un mot de passe volé
 *   suffirait à ajouter une passkey d'attaquant, donc à contourner le second facteur sans jamais le
 *   présenter.
 *
 * Cette règle est plus permissive que celle du TOTP, et délibérément : ajouter une passkey est
 * **additif**, alors que réenrôler un TOTP *remplace* le seul secret existant. Un geste destructif
 * reste administratif (step-027) ; un geste additif se contente d'exiger qu'on détienne déjà un
 * facteur.
 *
 * ## Ce qu'on refuse de retirer
 *
 * Le dernier facteur, quel qu'il soit. Sans cette garde, un opérateur se met dehors en un clic et
 * seule une intervention en base le remet. La notion volontairement retenue ici est « au moins un
 * facteur actif », **pas** « le rôle exige-t-il le MFA » : cette seconde question appartient à
 * step-025, et l'importer ici aurait fait dépendre une garde de disponibilité d'un moteur de
 * permissions qui n'existe pas encore.
 */

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { eq } from 'drizzle-orm'
import type { Database } from '../db/index'
import { operators } from '../db/schema/auth'
import type { AuthenticatedSession, PendingSession } from './mfa'
import { completeMfa, consumeWebAuthnChallenge, issueWebAuthnChallenge } from './session'
import { clearFailures, lockState, registerFailure } from './throttle'
import {
  authenticationOptions,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
  type WebAuthnConfig,
} from './webauthn'
import {
  addCredential,
  listCredentials,
  type RegisteredCredential,
  recordCredentialUse,
  renameCredential,
  revokeCredentialUnlessLastFactor,
} from './webauthn-credentials'

/** Repli quand la base ne rend pas d'échéance de verrou : mieux vaut une minute qu'un silence. */
const DEFAULT_RETRY_AFTER_SECONDS = 60

/**
 * Ce qu'une réponse peut dire d'un authentificateur.
 *
 * **Ni la clé publique, ni le compteur.** Ce ne sont pas des secrets — la clé est publique par
 * construction — mais rien dans l'interface n'en a besoin, et une donnée qui ne sort pas ne peut pas
 * être recopiée dans un journal.
 */
export type PublicCredential = {
  readonly id: string
  readonly name: string
  readonly createdAt: string
  readonly lastUsedAt?: string
  readonly deviceType?: string
  readonly backedUp?: boolean
}

export type PasskeyRegistrationStart =
  | { readonly outcome: 'started'; readonly options: PublicKeyCredentialCreationOptionsJSON }
  /** Un facteur existe déjà et la session n'est pas complète — voir l'en-tête. */
  | { readonly outcome: 'mfa_required' }

export type PasskeyRegistrationFinish =
  | { readonly outcome: 'registered'; readonly credentials: readonly PublicCredential[] }
  /** Signature invalide, origine inattendue, défi qui ne correspond pas, ou appareil déjà enrôlé. */
  | { readonly outcome: 'invalid_response' }
  /** Aucune cérémonie en cours : jamais démarrée, déjà achevée, ou défi périmé. */
  | { readonly outcome: 'no_pending_ceremony' }
  | { readonly outcome: 'mfa_required' }

export type PasskeyAuthenticationStart =
  | { readonly outcome: 'started'; readonly options: PublicKeyCredentialRequestOptionsJSON }
  /** Aucune passkey enregistrée : à l'interface de proposer le TOTP. */
  | { readonly outcome: 'no_passkey' }
  | { readonly outcome: 'rate_limited'; readonly retryAfterSeconds: number }

export type PasskeyAuthentication =
  | { readonly outcome: 'completed' }
  | { readonly outcome: 'invalid_response' }
  | { readonly outcome: 'no_pending_ceremony' }
  | { readonly outcome: 'rate_limited'; readonly retryAfterSeconds: number }

export type PasskeyRevocation =
  | { readonly outcome: 'revoked'; readonly credentials: readonly PublicCredential[] }
  | { readonly outcome: 'unknown_credential' }
  /** Le retirer laisserait l'opérateur sans aucun second facteur — voir l'en-tête. */
  | { readonly outcome: 'last_factor' }

/** Les authentificateurs d'un opérateur, dans la forme qu'une réponse peut porter. */
export async function listPasskeys(
  db: Database,
  session: AuthenticatedSession,
): Promise<readonly PublicCredential[]> {
  return publicView(await listCredentials(db, session.operatorId))
}

/**
 * Démarre l'enregistrement d'un appareil : options à envoyer au navigateur, défi conservé côté serveur.
 */
export async function startPasskeyRegistration(
  db: Database,
  config: WebAuthnConfig,
  session: AuthenticatedSession,
): Promise<PasskeyRegistrationStart> {
  const existing = await listCredentials(db, session.operatorId)

  if (session.status !== 'active' && (await hasActiveFactor(db, session.operatorId, existing))) {
    return { outcome: 'mfa_required' }
  }

  const [operator] = await db
    .select({ email: operators.email })
    .from(operators)
    .where(eq(operators.id, session.operatorId))

  if (!operator) return { outcome: 'mfa_required' }

  const options = await registrationOptions(
    config,
    { id: session.operatorId, email: operator.email },
    existing,
  )
  await issueWebAuthnChallenge(db, session.sessionId, options.challenge)

  return { outcome: 'started', options }
}

/**
 * Achève l'enregistrement : vérifie la réponse, conserve l'appareil, et promeut la session.
 *
 * La promotion suit le même raisonnement que la confirmation d'un enrôlement TOTP — l'opérateur vient
 * de prouver qu'il détient l'appareil, et lui réclamer une seconde cérémonie n'ajouterait rien.
 */
export async function finishPasskeyRegistration(
  db: Database,
  config: WebAuthnConfig,
  session: AuthenticatedSession,
  response: RegistrationResponseJSON,
  name: string,
): Promise<PasskeyRegistrationFinish> {
  const existing = await listCredentials(db, session.operatorId)

  if (session.status !== 'active' && (await hasActiveFactor(db, session.operatorId, existing))) {
    return { outcome: 'mfa_required' }
  }

  // Le défi est consommé **avant** la vérification : qu'elle réussisse ou échoue, il ne doit plus
  // valoir quelque chose. L'ordre inverse laisserait un défi réutilisable après chaque échec.
  const challenge = await consumeWebAuthnChallenge(db, session.sessionId)
  if (!challenge) return { outcome: 'no_pending_ceremony' }

  const verified = await verifyRegistration(config, response, challenge)
  if (!verified.verified) {
    await registerFailure(db, 'mfa', session.operatorId)
    return { outcome: 'invalid_response' }
  }

  const added = await addCredential(db, session.operatorId, { ...verified.credential, name })
  if (!added) return { outcome: 'invalid_response' }

  await promote(db, session)

  return {
    outcome: 'registered',
    credentials: publicView(await listCredentials(db, session.operatorId)),
  }
}

/** Démarre une authentification par passkey. */
export async function startPasskeyAuthentication(
  db: Database,
  config: WebAuthnConfig,
  session: PendingSession,
): Promise<PasskeyAuthenticationStart> {
  const lock = await lockState(db, 'mfa', session.operatorId)
  if (lock.locked) return { outcome: 'rate_limited', retryAfterSeconds: retryAfter(lock.until) }

  const credentials = await listCredentials(db, session.operatorId)
  if (credentials.length === 0) return { outcome: 'no_passkey' }

  const options = await authenticationOptions(config, credentials)
  await issueWebAuthnChallenge(db, session.sessionId, options.challenge)

  return { outcome: 'started', options }
}

/**
 * Achève une authentification par passkey et promeut la session.
 *
 * Le compteur de signature est consigné par une écriture conditionnelle : s'il n'a pas progressé, la
 * consigne échoue et la cérémonie est refusée. C'est la détection de clonage, et elle ne vaut que si
 * le refus est ici — vérifier sans conserver ne comparerait jamais rien.
 */
export async function finishPasskeyAuthentication(
  db: Database,
  config: WebAuthnConfig,
  session: PendingSession,
  response: AuthenticationResponseJSON,
): Promise<PasskeyAuthentication> {
  const lock = await lockState(db, 'mfa', session.operatorId)
  if (lock.locked) return { outcome: 'rate_limited', retryAfterSeconds: retryAfter(lock.until) }

  const challenge = await consumeWebAuthnChallenge(db, session.sessionId)
  if (!challenge) return { outcome: 'no_pending_ceremony' }

  const credential = (await listCredentials(db, session.operatorId)).find(
    (entry) => entry.id === response.id,
  )

  // Appareil inconnu : le même refus qu'une signature invalide. Distinguer dirait à qui présente une
  // passkey volée si elle est enrôlée ici.
  if (!credential) {
    await registerFailure(db, 'mfa', session.operatorId)
    return { outcome: 'invalid_response' }
  }

  const verified = await verifyAuthentication(config, response, challenge, credential)
  if (!verified.verified) {
    await registerFailure(db, 'mfa', session.operatorId)
    return { outcome: 'invalid_response' }
  }

  if (!(await recordCredentialUse(db, session.operatorId, credential.id, verified.newCounter))) {
    await registerFailure(db, 'mfa', session.operatorId)
    return { outcome: 'invalid_response' }
  }

  await promote(db, session)

  return { outcome: 'completed' }
}

/**
 * Retire un appareil, sauf s'il est le dernier facteur de l'opérateur.
 *
 * **La garde n'est pas évaluée ici**, et c'est délibéré : elle doit l'être sous le même verrou que
 * l'écriture, sinon deux retraits concurrents d'appareils différents constatent chacun qu'il en reste
 * un autre et aboutissent tous les deux. Ce module se contente donc de traduire le verdict que
 * `revokeCredentialUnlessLastFactor` rend depuis l'intérieur de sa transaction.
 */
export async function revokePasskey(
  db: Database,
  session: AuthenticatedSession,
  credentialId: string,
): Promise<PasskeyRevocation> {
  const result = await revokeCredentialUnlessLastFactor(db, session.operatorId, credentialId)
  if (result !== 'revoked') return { outcome: result }

  return {
    outcome: 'revoked',
    credentials: publicView(await listCredentials(db, session.operatorId)),
  }
}

/**
 * Renomme un appareil. Aucune garde de disponibilité : un nom ne protège rien.
 *
 * Le nom vient de l'opérateur — « MacBook », « clé du coffre » — et c'est ce qui rend une liste de
 * trois appareils exploitable au moment d'en retirer un. Un libellé imposé par le serveur ferait de
 * cette liste trois lignes indistinguables.
 */
export async function renamePasskey(
  db: Database,
  session: AuthenticatedSession,
  credentialId: string,
  name: string,
): Promise<PasskeyRevocation> {
  if (!(await renameCredential(db, session.operatorId, credentialId, name))) {
    return { outcome: 'unknown_credential' }
  }

  return {
    outcome: 'revoked',
    credentials: publicView(await listCredentials(db, session.operatorId)),
  }
}

/** Un facteur actif, tous types confondus : une passkey enregistrée ou un TOTP confirmé. */
async function hasActiveFactor(
  db: Database,
  operatorId: string,
  credentials: readonly RegisteredCredential[],
): Promise<boolean> {
  return credentials.length > 0 || (await hasActivatedTotp(db, operatorId))
}

async function hasActivatedTotp(db: Database, operatorId: string): Promise<boolean> {
  const [operator] = await db
    .select({ activatedAt: operators.mfaTotpActivatedAt })
    .from(operators)
    .where(eq(operators.id, operatorId))

  return Boolean(operator?.activatedAt)
}

/** Le seul endroit de ce module qui promeut une session, et qui remet le compteur d'échecs à zéro. */
async function promote(db: Database, session: AuthenticatedSession): Promise<void> {
  await clearFailures(db, 'mfa', session.operatorId)
  await completeMfa(db, session.sessionId)
}

/** Retire de chaque entrée ce qu'aucune réponse n'a besoin de porter. */
function publicView(credentials: readonly RegisteredCredential[]): readonly PublicCredential[] {
  return credentials.map((entry) => ({
    id: entry.id,
    name: entry.name,
    createdAt: entry.createdAt,
    ...(entry.lastUsedAt ? { lastUsedAt: entry.lastUsedAt } : {}),
    ...(entry.deviceType ? { deviceType: entry.deviceType } : {}),
    ...(entry.backedUp === undefined ? {} : { backedUp: entry.backedUp }),
  }))
}

function retryAfter(until: Date | undefined): number {
  if (!until) return DEFAULT_RETRY_AFTER_SECONDS
  return Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000))
}
