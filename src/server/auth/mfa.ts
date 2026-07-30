/**
 * Le second facteur : ce qui se décide.
 *
 * `mfa-totp.ts` fait la mécanique du code, `mfa-secret.ts` le chiffrement, `mfa-recovery.ts` les
 * codes de secours. Ici vivent les règles — qui peut enrôler, ce qu'un code consomme, ce qu'un échec
 * coûte, et le seul endroit qui a le droit de promouvoir une session.
 *
 * ## Enrôlement en deux temps, et le second n'est pas une formalité
 *
 * Le démarrage écrit un secret ; la confirmation exige un **premier code valide** avant d'activer.
 * Sans ce second temps, un opérateur dont l'application n'a jamais scanné le QR code se retrouverait
 * avec un facteur qu'il ne détient pas — c'est-à-dire dehors, définitivement, sans que rien ne l'ait
 * signalé au moment où c'était réparable.
 *
 * ## Réenrôler est refusé dès qu'un facteur est actif
 *
 * **La garde la plus importante de ce module.** Une session partielle ne porte qu'un mot de passe :
 * si elle pouvait remplacer le second facteur, un mot de passe volé suffirait à le substituer, donc
 * à l'annuler — et le MFA ne protégerait plus rien. Remplacer un authentificateur perdu est une
 * opération administrative, avec sa garde de permission et son écriture d'audit (step-025, step-027).
 *
 * Reste la fenêtre du **premier** enrôlement : entre la création d'un compte et son premier facteur,
 * un mot de passe seul ouvre la console. C'est assumé — c'est la seule façon d'enrôler sans canal
 * hors bande — et c'est step-025 qui la ferme, en rendant le MFA obligatoire pour les rôles
 * privilégiés.
 *
 * ## Un seul point de promotion
 *
 * `completeMfa()` n'est appelée qu'ici, par `promote()`. C'est elle qui déplace la fin de validité du
 * plafond court de la session partielle au plafond absolu : la disperser reviendrait à prolonger,
 * ailleurs, une session qui n'a rien prouvé de plus.
 *
 * ## Ce que le rejeu coûte à un opérateur pressé
 *
 * Un double-clic envoie deux fois le même code : la première requête consomme le pas, la seconde se
 * voit refusée et **compte un échec**. C'est délibéré — un rejeu se refuse, sans exception qui
 * s'élargirait ensuite — et c'est un échec sur cinq, pas un verrouillage. À l'interface de ne pas
 * laisser cliquer deux fois (step-026).
 */

import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { Database } from '../db/index'
import { operators } from '../db/schema/auth'
import {
  consumeRecoveryCode,
  countUnusedRecoveryCodes,
  generateRecoveryCodes,
  replaceRecoveryCodes,
} from './mfa-recovery'
import { type MfaKeys, openTotpSecret, sealTotpSecret } from './mfa-secret'
import { checkTotpCode, generateTotpSecret, totpEnrollmentUri } from './mfa-totp'
import { completeMfa, type SessionState } from './session'
import { clearFailures, lockState, registerFailure } from './throttle'

/** Une session qui désigne quelqu'un — le second facteur reste à passer, ou l'est déjà. */
export type AuthenticatedSession = Exclude<SessionState, { status: 'none' }>

/** Une session partielle : la seule que la vérification accepte de promouvoir. */
export type PendingSession = Extract<SessionState, { status: 'pending_mfa' }>

/** Un code TOTP, tel que le tape un opérateur. Ce qui n'est pas cette forme est un code de secours. */
const TOTP_CODE_PATTERN = /^\d{6}$/

/** Repli quand la base ne rend pas d'échéance de verrou : mieux vaut une minute qu'un silence. */
const DEFAULT_RETRY_AFTER_SECONDS = 60

export type EnrollmentStart =
  /**
   * Le secret et l'URI, **rendus une seule fois**. L'application authenticator doit pouvoir les
   * lire : c'est l'objet même de l'opération. Rien ne les rendra plus après cet appel.
   */
  | { readonly outcome: 'started'; readonly secret: string; readonly uri: string }
  /** Un TOTP est déjà actif. Le remplacer est une opération administrative — voir l'en-tête. */
  | { readonly outcome: 'already_enrolled' }
  /**
   * Un **autre** facteur est actif — une passkey — et la session n'a pas encore été promue.
   *
   * Distinct d'`already_enrolled` parce que la conduite à tenir est distincte : l'opérateur n'a
   * besoin de personne, il lui suffit de franchir la passkey qu'il détient, ce qui rendra sa session
   * complète et l'autorisera à ajouter une application authenticator. L'envoyer vers un
   * administrateur, comme le fait `already_enrolled`, serait un mauvais conseil.
   */
  | { readonly outcome: 'mfa_required' }

export type EnrollmentConfirmation =
  /** Facteur actif, session promue, et le lot de codes de récupération — **montré une seule fois**. */
  | { readonly outcome: 'activated'; readonly recoveryCodes: readonly string[] }
  /** Code faux, hors fenêtre, ou illisible. **Un seul cas**, comme partout dans ce module. */
  | { readonly outcome: 'invalid_code' }
  /** Aucun enrôlement à confirmer : jamais démarré, déjà confirmé, ou secret devenu illisible. */
  | { readonly outcome: 'no_pending_enrollment' }
  /**
   * Un autre facteur est apparu **entre** le démarrage et la confirmation, et la session n'a pas été
   * promue. Distinct de `no_pending_enrollment`, dont la copie dit « relancez l'enrôlement » : ce
   * geste-là échouerait à son tour, et l'opérateur tournerait en rond entre deux refus.
   */
  | { readonly outcome: 'mfa_required' }
  | { readonly outcome: 'rate_limited'; readonly retryAfterSeconds: number }

export type MfaVerification =
  /** Second facteur passé. `recovery` n'est présent que si c'est un code de secours qui a servi. */
  | { readonly outcome: 'completed'; readonly recovery?: { readonly remaining: number } }
  /** Code faux, hors fenêtre, rejoué, déjà consommé, ou aucun facteur actif. **Un seul cas.** */
  | { readonly outcome: 'invalid_code' }
  | { readonly outcome: 'rate_limited'; readonly retryAfterSeconds: number }

/**
 * La condition « aucun autre facteur », à poser **dans le `WHERE`** d'une écriture d'enrôlement.
 *
 * ## Pourquoi elle existe
 *
 * Le côté WebAuthn refuse depuis la step-024 d'enregistrer un appareil depuis une session partielle
 * quand un facteur existe déjà (`hasActiveFactor`). Le côté TOTP ne regardait, lui, que le TOTP —
 * et cette asymétrie était un **contournement complet du second facteur** : un opérateur protégé par
 * une passkey, c'est-à-dire le mieux protégé, voyait un mot de passe volé suffire à enrôler une
 * application authenticator, à promouvoir la session et à emporter les codes de récupération. Le
 * facteur résistant au hameçonnage se contournait par le plus faible.
 *
 * ## Pourquoi dans le `WHERE` et non dans un `if`
 *
 * Même raison qu'ailleurs dans ce module : un `if` qui précède l'écriture laisse deux onglets, ou
 * deux instances, se glisser entre la lecture et l'écriture. La condition doit être évaluée par
 * l'instruction qui écrit.
 *
 * ## Pourquoi une session complète en est dispensée
 *
 * Elle a déjà franchi un facteur. Ajouter une application authenticator à côté de sa passkey est
 * exactement ce qu'un opérateur prudent doit pouvoir faire — et c'est la règle que le côté WebAuthn
 * applique déjà, dans l'autre sens.
 */
function noOtherFactorFrom(session: AuthenticatedSession) {
  if (session.status === 'active') return []

  // `jsonb_typeof = 'array'` d'abord, et ce n'est pas de la ceinture-bretelles : `jsonb_array_length`
  // **lève** sur un scalaire ou un objet. Sans ce garde, une colonne bricolée ferait remonter une
  // erreur PostgreSQL jusqu'au 500 au lieu du refus typé — et `webauthn-credentials.ts` pose déjà la
  // règle inverse : « jamais une erreur serveur qui rendrait la panne indiscernable d'une attaque ».
  // Une colonne qui n'est pas un tableau ne prouve pas l'absence de facteur : la condition est fausse,
  // donc l'enrôlement est refusé. Fail-closed, et lisible.
  return [
    sql`jsonb_typeof(${operators.mfaWebauthnCredentials}) = 'array'
        AND jsonb_array_length(${operators.mfaWebauthnCredentials}) = 0`,
  ]
}

/**
 * Dit **pourquoi** l'enrôlement a été refusé, une fois l'écriture conditionnelle sans effet.
 *
 * Les deux refus n'appellent pas la même conduite : un TOTP déjà actif se remplace par un
 * administrateur, tandis qu'une passkey détenue se franchit soi-même. Rendre le même code pour les
 * deux enverrait la moitié des opérateurs à la mauvaise porte.
 */
async function refusedStart(db: Database, session: AuthenticatedSession): Promise<EnrollmentStart> {
  const [operator] = await db
    .select({
      activatedAt: operators.mfaTotpActivatedAt,
      credentials: operators.mfaWebauthnCredentials,
    })
    .from(operators)
    .where(eq(operators.id, session.operatorId))

  const passkeys = Array.isArray(operator?.credentials) ? operator.credentials.length : 0
  if (!operator?.activatedAt && passkeys > 0) return { outcome: 'mfa_required' }

  return { outcome: 'already_enrolled' }
}

/**
 * Démarre un enrôlement TOTP.
 *
 * L'écriture est **conditionnelle** : elle n'aboutit que si aucun facteur n'est actif — ni TOTP, ni
 * passkey. La condition est dans le `WHERE` et non dans un `if` qui la précéderait : deux onglets,
 * ou deux instances, se glisseraient entre la lecture et l'écriture.
 */
export async function startTotpEnrollment(
  db: Database,
  keys: MfaKeys,
  session: AuthenticatedSession,
): Promise<EnrollmentStart> {
  const secret = generateTotpSecret()

  const [row] = await db
    .update(operators)
    .set({
      mfaTotpSecret: sealTotpSecret(secret, session.operatorId, keys),
      // Le marqueur d'anti-rejeu appartient au secret qu'il accompagne : le garder ferait refuser
      // des pas déjà consommés par un facteur qui n'existe plus.
      mfaTotpLastStep: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(operators.id, session.operatorId),
        isNull(operators.mfaTotpActivatedAt),
        ...noOtherFactorFrom(session),
      ),
    )
    .returning({ email: operators.email })

  if (!row) return refusedStart(db, session)

  return { outcome: 'started', secret, uri: totpEnrollmentUri(secret, row.email) }
}

/**
 * Confirme un enrôlement par un premier code valide : active le facteur, crée les codes de
 * récupération et promeut la session.
 *
 * La promotion est ici, et pas dans un appel de `verifyMfaCode` que le client devrait enchaîner :
 * l'opérateur vient de présenter un code valide, et lui en réclamer un second trente secondes plus
 * tard n'ajouterait rien à ce qui est prouvé.
 */
export async function confirmTotpEnrollment(
  db: Database,
  keys: MfaKeys,
  session: AuthenticatedSession,
  code: string,
  now: Date = new Date(),
): Promise<EnrollmentConfirmation> {
  const lock = await lockState(db, 'mfa', session.operatorId)
  if (lock.locked) return { outcome: 'rate_limited', retryAfterSeconds: retryAfter(lock.until) }

  const [operator] = await db
    .select({ secret: operators.mfaTotpSecret, activatedAt: operators.mfaTotpActivatedAt })
    .from(operators)
    .where(eq(operators.id, session.operatorId))

  if (!operator?.secret || operator.activatedAt) return { outcome: 'no_pending_enrollment' }

  // Une enveloppe illisible — clé retirée, colonne bricolée — se lit comme « rien à confirmer » :
  // l'opérateur redémarre un enrôlement, ce qui la remplacera. Un refus de code l'aurait laissé
  // taper indéfiniment un code correct.
  const secret = openTotpSecret(operator.secret, session.operatorId, keys)
  if (!secret) return { outcome: 'no_pending_enrollment' }

  const check = await checkTotpCode(secret, code, now)
  if (!check.valid) {
    await registerFailure(db, 'mfa', session.operatorId)
    return { outcome: 'invalid_code' }
  }

  const recoveryCodes = generateRecoveryCodes()

  // Activation et codes de récupération dans la **même** transaction : un facteur actif sans porte de
  // sortie enfermerait dehors le premier opérateur qui perdrait son téléphone.
  const activated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(operators)
      .set({
        mfaTotpActivatedAt: sql`now()`,
        mfaTotpLastStep: check.timeStep,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(operators.id, session.operatorId),
          isNull(operators.mfaTotpActivatedAt),
          // La même condition qu'au démarrage, et pas seulement par symétrie : un secret en attente
          // peut dater d'**avant** l'enregistrement d'une passkey — enrôlement commencé, jamais
          // confirmé, puis appareil enregistré. Sans elle, ce secret oublié resterait une porte.
          ...noOtherFactorFrom(session),
        ),
      )
      .returning({ id: operators.id })

    if (!row) return false

    await replaceRecoveryCodes(tx, session.operatorId, recoveryCodes, keys)
    return true
  })

  // Deux causes possibles à l'écriture sans effet, et deux conduites à tenir opposées : le facteur
  // a été activé entre-temps (relancer n'a pas de sens, c'est fait), ou une passkey est apparue
  // depuis le démarrage (il faut la présenter). `refusedStart` fait déjà cette distinction côté
  // démarrage ; la refaire ici évite d'envoyer l'opérateur relancer un enrôlement qui sera refusé.
  if (!activated) {
    const refusal = await refusedStart(db, session)
    return refusal.outcome === 'mfa_required'
      ? { outcome: 'mfa_required' }
      : { outcome: 'no_pending_enrollment' }
  }

  await promote(db, session)

  return { outcome: 'activated', recoveryCodes }
}

/**
 * Vérifie un code et promeut la session partielle.
 *
 * Le type du paramètre fait le travail d'une garde : seule une session **partielle** entre ici. Une
 * session complète n'a rien à vérifier, et lui permettre de repasser par là offrirait un point de
 * devinette de plus, sans plafond court pour le borner.
 */
export async function verifyMfaCode(
  db: Database,
  keys: MfaKeys,
  session: PendingSession,
  code: string,
  now: Date = new Date(),
): Promise<MfaVerification> {
  const lock = await lockState(db, 'mfa', session.operatorId)
  if (lock.locked) return { outcome: 'rate_limited', retryAfterSeconds: retryAfter(lock.until) }

  // **Aucun facteur actif, aucun code n'ouvre rien** — ni TOTP, ni code de récupération. La garde est
  // ici, avant l'aiguillage, et pas dans chaque branche : un code de récupération qui survivrait à la
  // réinitialisation du facteur (step-027) deviendrait un second facteur pour un compte qui vient
  // précisément de le perdre. Le mettre une seule fois, en amont, rend la règle indéformable.
  const factor = await activeTotpFactor(db, session.operatorId)
  if (!factor) {
    await registerFailure(db, 'mfa', session.operatorId)
    return { outcome: 'invalid_code' }
  }

  const trimmed = code.trim()
  const accepted = TOTP_CODE_PATTERN.test(trimmed)
    ? await consumeTotpCode(db, keys, session.operatorId, factor.envelope, trimmed, now)
    : await consumeRecovery(db, keys, session.operatorId, trimmed)

  if (!accepted.valid) {
    await registerFailure(db, 'mfa', session.operatorId)
    return { outcome: 'invalid_code' }
  }

  await promote(db, session)

  return accepted.remaining === undefined
    ? { outcome: 'completed' }
    : { outcome: 'completed', recovery: { remaining: accepted.remaining } }
}

type Consumption = { readonly valid: boolean; readonly remaining?: number }

/**
 * L'enveloppe du facteur **actif** d'un opérateur, ou `undefined` s'il n'en a pas.
 *
 * Un secret écrit sans `mfa_totp_activated_at` ne compte pas : c'est un enrôlement en cours, que seul
 * `confirmTotpEnrollment` a le droit de faire aboutir.
 */
async function activeTotpFactor(
  db: Database,
  operatorId: string,
): Promise<{ readonly envelope: string } | undefined> {
  const [operator] = await db
    .select({ secret: operators.mfaTotpSecret, activatedAt: operators.mfaTotpActivatedAt })
    .from(operators)
    .where(eq(operators.id, operatorId))

  if (!operator?.secret || !operator.activatedAt) return undefined
  return { envelope: operator.secret }
}

/**
 * Vérifie un code TOTP **et** consomme son pas de temps.
 *
 * Les deux sont indissociables : un code vérifié mais non consommé reste rejouable pendant toute sa
 * fenêtre. C'est pourquoi cette fonction n'expose pas de « vérifier sans consommer ».
 */
async function consumeTotpCode(
  db: Database,
  keys: MfaKeys,
  operatorId: string,
  envelope: string,
  code: string,
  now: Date,
): Promise<Consumption> {
  const secret = openTotpSecret(envelope, operatorId, keys)
  if (!secret) return { valid: false }

  const check = await checkTotpCode(secret, code, now)
  if (!check.valid) return { valid: false }

  return { valid: await advanceTimeStep(db, operatorId, check.timeStep) }
}

/**
 * Avance le marqueur d'anti-rejeu, et rend `false` si le pas était déjà consommé.
 *
 * **Une seule écriture conditionnelle**, en base et non en mémoire : c'est ce qui la rend vraie entre
 * instances. PostgreSQL réévalue la condition après avoir attendu la transaction concurrente, si
 * bien que deux requêtes simultanées portant le même code n'en voient qu'une aboutir.
 *
 * La comparaison est **stricte et monotone** : un pas antérieur est refusé aussi, sans quoi le code
 * voisin que la fenêtre de dérive tolère resterait rejouable après le passage du plus récent.
 */
async function advanceTimeStep(
  db: Database,
  operatorId: string,
  timeStep: number,
): Promise<boolean> {
  const advanced = await db
    .update(operators)
    .set({ mfaTotpLastStep: timeStep })
    .where(
      and(
        eq(operators.id, operatorId),
        or(isNull(operators.mfaTotpLastStep), lt(operators.mfaTotpLastStep, timeStep)),
      ),
    )
    .returning({ id: operators.id })

  return advanced.length > 0
}

async function consumeRecovery(
  db: Database,
  keys: MfaKeys,
  operatorId: string,
  code: string,
): Promise<Consumption> {
  if (!(await consumeRecoveryCode(db, operatorId, code, keys))) return { valid: false }

  return { valid: true, remaining: await countUnusedRecoveryCodes(db, operatorId) }
}

/**
 * Le seul endroit qui promeut une session, et qui remet le compteur d'échecs à zéro.
 *
 * Une session déjà complète y passe sans effet : `completeMfa()` ne touche que celles dont le second
 * facteur n'est pas encore marqué. C'est ce qui permet à la confirmation d'enrôlement d'appeler le
 * même chemin, qu'elle vienne d'une session partielle ou d'une session déjà ouverte.
 *
 * Seule la portée `mfa` est effacée : le compteur d'adresse de la connexion ne décroît que par
 * l'écoulement de sa fenêtre, sinon détenir un compte valide donnerait le moyen de remettre son
 * quota à zéro à volonté.
 */
async function promote(db: Database, session: AuthenticatedSession): Promise<void> {
  await clearFailures(db, 'mfa', session.operatorId)
  await completeMfa(db, session.sessionId)
}

function retryAfter(until: Date | undefined): number {
  if (!until) return DEFAULT_RETRY_AFTER_SECONDS
  return Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000))
}
