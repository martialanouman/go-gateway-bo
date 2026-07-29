/**
 * L'authentification par mot de passe — première moitié de la connexion.
 *
 * Elle ne rend **jamais** de session : le succès n'ouvre qu'un challenge MFA, et la session n'existe
 * qu'après le second facteur (step-022 à step-024). C'est ce qui fait qu'un mot de passe volé ne
 * suffit pas.
 *
 * ## Trois oracles à fermer, et un seul les ferme tous
 *
 * Un attaquant n'a pas besoin de lire la réponse pour apprendre : il lui suffit de mesurer.
 *
 * 1. **Identifiant inconnu** — sans précaution, le chemin s'arrête avant scrypt et répond en cinq
 *    millisecondes au lieu de cent soixante-six. On vérifie donc le mot de passe contre une
 *    **empreinte factice** ; le travail est fait, et perdu, exactement comme pour un vrai compte.
 * 2. **Compte verrouillé** — même piège : court-circuiter la vérification rendrait le verrouillage
 *    mesurable, donc l'existence du compte. Le verrou est donc constaté, mais la vérification a
 *    quand même lieu.
 * 3. **Écritures asymétriques** — le chemin « compte connu » touche Postgres différemment du chemin
 *    « inconnu ». Égaliser branche par branche est un travail sans fin, et faux à la première
 *    modification.
 *
 * D'où le **plancher de latence**, qui les couvre tous les trois : la réponse part à une échéance
 * fixe comptée depuis l'arrivée de la requête, quel que soit le chemin. Ce n'est pas « ajouter un
 * délai » — ajouter conserverait l'écart — c'est **attendre jusqu'à**.
 *
 * Son mode d'échec est réel et doit être surveillé : sous charge, l'attente du sémaphore peut
 * dépasser le plancher, et l'oracle temporel réapparaît précisément quand l'attaquant le décide,
 * puisque c'est lui qui produit la charge. Un dépassement est donc compté et remonté comme un
 * **incident de sécurité**, pas comme une lenteur.
 *
 * Ce qui reste ouvert, et qu'on assume : le **succès** confirme l'identifiant et le mot de passe.
 * C'est la fonction du produit. Il passe sous le même plancher que les autres chemins.
 */

import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { Database } from '../db/index'
import { operators } from '../db/schema/auth'
import { isCountableIp } from './client-ip'
import { QueueFullError, type Semaphore } from './concurrency'
import { hashPassword, type ScryptParameters, verifyPassword } from './password'
import { clearFailures, lockState, registerFailure, subjectKey } from './throttle'

export type LoginInput = {
  readonly identifier: string
  readonly password: string
  readonly ipAddress: string
  /**
   * Saisie illisible — corps non JSON, champs absents ou hors bornes.
   *
   * Traitée par le **même** chemin qu'un échec ordinaire, plancher et compteur d'adresse compris.
   * Un retour immédiat côté transport donnerait un chemin gratuit, jamais compté, et surtout un
   * étalon exact de la latence réseau et serveur — de quoi calibrer toutes les autres mesures.
   */
  readonly malformed?: boolean
}

export type LoginOutcome =
  /** Mot de passe correct : reste le second facteur. Aucune session n'est ouverte ici. */
  | { readonly outcome: 'mfa_required'; readonly operatorId: string }
  /**
   * Tout le reste : identifiant inconnu, mot de passe faux, compte verrouillé, compte désactivé.
   * **Un seul cas**, délibérément — les distinguer, c'est les divulguer.
   */
  | { readonly outcome: 'invalid_credentials' }
  /** Adresse trop insistante. Le seul refus qui s'explique, parce qu'il ne parle que de l'appelant. */
  | { readonly outcome: 'rate_limited'; readonly retryAfterSeconds: number }

export type LoginService = {
  attempt(input: LoginInput): Promise<LoginOutcome>
  /** Nombre de réponses parties après l'échéance. Non nul = l'oracle temporel est rouvert. */
  readonly deadlineMisses: () => number
}

/**
 * Échéance de réponse, comptée depuis l'arrivée de la requête.
 *
 * Doit couvrir confortablement le chemin légitime complet — attente de file, scrypt (~166 ms) et
 * allers-retours Postgres. La valeur est un point de départ mesuré sur la machine de développement,
 * **à recaler sur le p99 réel en pré-production** : devinée une fois pour toutes, elle serait fausse
 * partout ailleurs.
 */
const DEFAULT_FLOOR_MS = 500

export function createLoginService(deps: {
  db: Database
  throttleSecret: string
  semaphore: Semaphore
  parameters?: ScryptParameters
  floorMs?: number
}): LoginService {
  const floorMs = deps.floorMs ?? DEFAULT_FLOOR_MS
  let misses = 0

  /**
   * Empreinte contre laquelle un identifiant inconnu est vérifié.
   *
   * Dérivée d'un secret aléatoire au premier usage, et non écrite en dur : si les paramètres de
   * hachage changent un jour, la parité de coût suit toute seule. Aucun mot de passe ne peut la
   * satisfaire — le secret n'existe nulle part ailleurs.
   */
  let decoy: Promise<string> | undefined
  const decoyHash = () => {
    decoy ??= hashPassword(randomBytes(32).toString('hex'), deps.parameters)
    return decoy
  }

  async function decide(input: LoginInput): Promise<LoginOutcome> {
    // Une adresse indéterminée n'est pas comptée : un seau commun verrouillerait la connexion de
    // tout le monde au vingtième échec de n'importe qui. Le compteur par identifiant, lui, continue
    // de protéger chaque compte — c'est celui qui empêche de casser un mot de passe.
    const countIp = isCountableIp(input.ipAddress)
    const ipKey = subjectKey('ip', input.ipAddress, deps.throttleSecret)

    // **Avant le ticket de sémaphore**, et c'est l'ordre qui compte : une lecture Postgres de
    // quelques millisecondes élimine l'attaquant mono-adresse sans qu'il consomme jamais une place
    // de vérification. La file reste disponible pour les connexions légitimes.
    const ipLock = countIp ? await lockState(deps.db, 'ip', ipKey) : { locked: false as const }
    if (ipLock.locked) {
      const retryAfterSeconds = ipLock.until
        ? Math.max(1, Math.ceil((ipLock.until.getTime() - Date.now()) / 1000))
        : 60
      return { outcome: 'rate_limited', retryAfterSeconds }
    }

    const operatorKey = subjectKey('operator', input.identifier, deps.throttleSecret)

    return deps.semaphore.run(async () => {
      const accountLocked = (await lockState(deps.db, 'operator', operatorKey)).locked

      const [operator] = await deps.db
        .select({
          id: operators.id,
          passwordHash: operators.passwordHash,
          status: operators.status,
        })
        .from(operators)
        .where(eq(sql`lower(${operators.email})`, input.identifier.trim().toLowerCase()))

      // La vérification a lieu **dans tous les cas** : compte inconnu, désactivé ou verrouillé. Sauter
      // scrypt sur l'un de ces chemins le rendrait mesurable — voir l'en-tête.
      const passwordMatches = await verifyPassword(
        input.password,
        operator?.passwordHash ?? (await decoyHash()),
      )

      const authenticated =
        !input.malformed &&
        passwordMatches &&
        operator !== undefined &&
        operator.status === 'active' &&
        !accountLocked

      if (!authenticated) {
        // Compté sur les deux portées, et sur les deux chemins — connu comme inconnu. Ne compter que
        // les identifiants existants rendrait l'écriture asymétrique, donc l'existence du compte
        // mesurable.
        //
        // **Sauf quand le compte est déjà verrouillé.** Ré-incrémenter alors prolongerait le verrou
        // à chaque tentative, et la durée double à chaque palier : le titulaire légitime qui tape
        // son bon mot de passe ré-armerait son propre blocage, et une poignée de requêtes par
        // quart d'heure suffirait à garder un opérateur nommé dehors indéfiniment. Dans un cockpit
        // interne dont les adresses sont devinables, c'est un déni de service ciblé qui ne coûte
        // rien — et silencieux par construction, puisque ce verrou ne s'annonce jamais.
        await Promise.all([
          accountLocked ? Promise.resolve() : registerFailure(deps.db, 'operator', operatorKey),
          countIp ? registerFailure(deps.db, 'ip', ipKey) : Promise.resolve(),
        ])
        return { outcome: 'invalid_credentials' }
      }

      // **Seule la portée `operator` est effacée.** Effacer aussi le compteur d'adresse donnerait à
      // quiconque détient un compte valide — y compris un compte peu privilégié déjà compromis — le
      // moyen de remettre son quota à zéro à volonté : dix-neuf échecs de balayage, une connexion
      // réussie sur son propre compte, et l'on recommence. La portée `ip` ne décroît que par
      // l'écoulement de sa fenêtre.
      await clearFailures(deps.db, 'operator', operatorKey)

      return { outcome: 'mfa_required', operatorId: operator.id }
    })
  }

  return {
    deadlineMisses: () => misses,

    async attempt(input: LoginInput): Promise<LoginOutcome> {
      const startedAt = Date.now()

      let result: LoginOutcome
      try {
        result = await decide(input)
      } catch (error) {
        // La file pleine se traduit comme un refus d'adresse : uniforme, et donc muet sur les
        // comptes. Elle passe sous le même plancher que tout le reste, sinon la saturation
        // deviendrait elle-même l'oracle — identifiant connu refusé vite, inconnu servi lentement.
        if (error instanceof QueueFullError) {
          result = { outcome: 'rate_limited', retryAfterSeconds: 5 }
        } else {
          throw error
        }
      }

      const remaining = floorMs - (Date.now() - startedAt)
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining))
      } else {
        // Dépassement : la réponse est partie plus tard que l'échéance, donc sa durée dépend du
        // chemin parcouru. C'est l'oracle temporel rouvert, et un attaquant qui produit la charge
        // choisit le moment. À surveiller comme un incident, pas comme une lenteur.
        misses += 1
      }

      return result
    },
  }
}
