/**
 * Le second facteur par application authenticator — la mécanique TOTP, et rien d'autre.
 *
 * Ce module ne connaît ni la base, ni les sessions, ni la limitation de débit : il produit un
 * secret, l'URI que scanne une application, et répond « ce code est-il valide, et à quel pas de
 * temps ». Tout ce qui se décide — anti-rejeu, promotion de session, comptage des échecs — vit dans
 * `mfa.ts`, contre un vrai PostgreSQL.
 *
 * ## Le pas de temps est rendu, et ce n'est pas un détail d'implémentation
 *
 * Un code TOTP reste valide pendant toute sa fenêtre : sans mémoire de ce qui a été consommé, le
 * même code fonctionne autant de fois qu'on le présente pendant une minute. Quiconque lit un code
 * par-dessus une épaule, dans un journal ou sur un canal de support l'a donc rejouable. C'est
 * l'appelant qui ferme cette porte, en avançant un marqueur partagé — mais il lui faut pour cela
 * savoir **quel** pas de temps le code vient de consommer. D'où le retour, plutôt qu'un booléen.
 *
 * ## Ce que la fenêtre de dérive coûte
 *
 * `epochTolerance` ouvre la vérification aux codes voisins, pour absorber la dérive d'horloge du
 * téléphone et le temps de saisie. Chaque pas accepté en plus multiplie d'autant la surface de
 * devinette **et** allonge la durée pendant laquelle un code intercepté vaut encore quelque chose.
 * Trente secondes — le pas voisin de part et d'autre — est la valeur usuelle : au-delà, on paie une
 * commodité en sécurité ; en deçà, une horloge de quelques secondes en retard rend le produit
 * inutilisable.
 *
 * ## Ce qui n'est pas utilisé, et pourquoi
 *
 * otplib sait refuser lui-même un pas déjà consommé (`afterTimeStep`). Ce module ne s'en sert pas :
 * cette garde vit **en base**, parce qu'elle doit tenir entre instances, et deux gardes répondant à
 * la même question finiraient par ne pas répondre pareil. La bibliothèque lève par ailleurs si le
 * pas fourni dépasse la fenêtre courante — ce qu'un recul d'horloge suffit à produire, et qui
 * transformerait alors un refus en erreur serveur.
 *
 * ## Un piège de la bibliothèque, écrit ici parce qu'il ne se voit pas
 *
 * `algorithm` s'écrit en **casse basse**. `'SHA1'` ne lève pas : il produit des codes *différents*,
 * silencieusement — une console qui n'accepterait jamais le code d'aucune application, sans une
 * seule erreur pour l'expliquer. Le typage refuse la mauvaise casse, et les vecteurs de la RFC 6238
 * dans le test la refusent aussi : c'est ce second filet qui l'a trouvée.
 */

import { generateSecret, generateURI, NobleCryptoPlugin, ScureBase32Plugin, TOTP } from 'otplib'

/** Pas de temps, en secondes. La valeur qu'attendent toutes les applications authenticator. */
export const TOTP_PERIOD_SECONDS = 30

/** Dérive tolérée, en secondes : le pas voisin de part et d'autre. Voir l'en-tête. */
const DRIFT_TOLERANCE_SECONDS = 30

/** Vingt octets — cent soixante bits, le minimum que recommande la RFC 4226 (§4, R6). */
const SECRET_BYTES = 20

/**
 * L'émetteur affiché dans l'application authenticator.
 *
 * Il apparaît à côté de l'adresse de l'opérateur, et c'est ce qui distingue cette entrée des autres
 * dans une liste qui en compte parfois vingt.
 */
const ISSUER = 'Passerelle SMS'

/**
 * Les paramètres du facteur, déclarés **une fois**.
 *
 * La classe plutôt que les fonctions libres, pour deux raisons qui se rejoignent : les options ne se
 * répètent pas d'un appel à l'autre — donc ne peuvent pas diverger — et son résultat de vérification
 * est celui de TOTP, qui porte le pas de temps. La forme libre rend une union avec HOTP, où ce champ
 * n'existe pas : l'anti-rejeu n'aurait plus rien à faire avancer.
 *
 * Les trois valeurs sont écrites bien qu'elles soient les défauts de la bibliothèque : un défaut qui
 * changerait à une montée de version changerait les codes acceptés, et personne ne relit les notes
 * de version d'un paquet qui « n'a pas bougé d'API ».
 *
 * Les greffons se déclarent, eux, parce que la classe ne les câble pas — contrairement aux fonctions
 * libres. C'est **construit une fois, au chargement du module** : un greffon manquant fait alors
 * échouer le démarrage, là où une construction par appel l'aurait transformé en « aucun code n'est
 * jamais valide », indiscernable d'une attaque en cours.
 */
const totp = new TOTP({
  period: TOTP_PERIOD_SECONDS,
  digits: 6,
  algorithm: 'sha1',
  // Implémentations pures JavaScript de `@noble` et `@scure`, celles que la bibliothèque câble
  // elle-même dans sa forme libre. Le greffon `node:crypto` existe, dans un paquet de plus, pour un
  // HMAC-SHA-1 sur vingt octets — un gain que personne ne mesurera.
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
})

export type TotpCheck =
  /** Code accepté, avec le pas de temps qu'il vient de consommer — voir l'en-tête. */
  | { readonly valid: true; readonly timeStep: number }
  /** Code faux, hors fenêtre, illisible, ou secret illisible. **Un seul cas**, comme au login. */
  | { readonly valid: false }

/** Un secret prêt à être scellé puis stocké. Base32, tel que l'attend une application authenticator. */
export function generateTotpSecret(): string {
  return generateSecret({ length: SECRET_BYTES })
}

/**
 * L'URI `otpauth://` que le navigateur transformera en QR code.
 *
 * **Le QR se dessine côté client** (step-026) : produire une image ici obligerait à la faire
 * traverser le réseau, donc à la journaliser, la mettre en cache et la retrouver dans un
 * intermédiaire — pour un contenu qui est exactement le secret.
 */
export function totpEnrollmentUri(secret: string, email: string): string {
  return generateURI({
    issuer: ISSUER,
    label: email,
    secret,
    period: TOTP_PERIOD_SECONDS,
    digits: 6,
    algorithm: 'sha1',
  })
}

/**
 * Vérifie un code contre un secret, à un instant donné.
 *
 * **Ne lève jamais** : la saisie comme le secret arrivent d'ailleurs — le réseau pour l'un, une
 * enveloppe déchiffrée pour l'autre. Une exception ferait remonter une erreur serveur là où le refus
 * est la seule réponse juste, et rendrait au passage une sonde distinguable d'un échec ordinaire.
 */
export async function checkTotpCode(
  secret: string,
  code: string,
  now: Date = new Date(),
): Promise<TotpCheck> {
  try {
    const result = await totp.verify(code.trim(), {
      secret,
      epoch: unixSeconds(now),
      epochTolerance: DRIFT_TOLERANCE_SECONDS,
    })

    return result.valid ? { valid: true, timeStep: result.timeStep } : { valid: false }
  } catch {
    return { valid: false }
  }
}

/**
 * Le code attendu à un instant donné. **Réservé aux tests** — rien en production n'a de raison de
 * produire un code, seulement d'en vérifier un.
 */
export function totpCodeAt(secret: string, now: Date): Promise<string> {
  return totp.generate({ secret, epoch: unixSeconds(now) })
}

/** L'unité de la RFC 6238, et celle qu'attend la bibliothèque : des secondes, pas des millisecondes. */
function unixSeconds(instant: Date): number {
  return Math.floor(instant.getTime() / 1000)
}
