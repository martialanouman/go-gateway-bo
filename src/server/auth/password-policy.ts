/**
 * La politique de mot de passe.
 *
 * Trois règles, et **seulement** trois : longueur, mots de passe notoirement compromis, et
 * ressemblance avec l'identité de l'opérateur.
 *
 * Ce qui n'y est délibérément pas : les règles de composition — une majuscule, un chiffre, un
 * caractère spécial. Elles ne produisent pas d'entropie, elles produisent `Password1!`, et le NIST
 * recommande explicitement de ne plus les imposer. La longueur est ce qui protège réellement.
 *
 * ## La liste des mots de passe compromis
 *
 * Embarquée, courte et normalisée. Un service en ligne — « have I been pwned » et ses semblables —
 * enverrait un préfixe du condensat du mot de passe vers un tiers depuis le BFF : un appel réseau
 * sur le chemin d'authentification, donc un point de panne, et une divulgation partielle. Pour un
 * outil interne de 300 opérateurs, une liste des mots de passe les plus courants suffit à écarter ce
 * qu'une attaque par dictionnaire trouve en premier.
 *
 * La liste est volontairement modeste : elle attrape les choix catastrophiques, elle ne prétend pas
 * remplacer une vraie base de fuites. La longueur minimale fait le reste du travail.
 */

/** Un compte du cockpit vaut mieux que le minimum du NIST : douze caractères, sans exception. */
export const MIN_PASSWORD_LENGTH = 12

/**
 * Normalisés en minuscules, sans espaces. La comparaison se fait sur la même forme, si bien que
 * `Azerty123456` et `AZERTY123456` sont écartés par la même entrée.
 */
const COMPROMISED = new Set([
  'motdepasse',
  'motdepasse123',
  'azerty123456',
  'azertyuiop123',
  'password1234',
  'password12345',
  'passw0rd1234',
  '123456789012',
  '112233445566',
  'qwertyuiop12',
  'administrateur',
  'administrator',
  'iloveyou1234',
  'bonjour12345',
  'soleil123456',
  'chocolat1234',
  'gateway12345',
  'passerelle12',
  'dashboard123',
  'changeme1234',
  'letmein12345',
  'welcome12345',
])

export type PasswordRejection =
  | { readonly reason: 'too_short'; readonly minLength: number }
  | { readonly reason: 'compromised' }
  | { readonly reason: 'contains_identity' }

/**
 * Rend la raison du refus, ou `undefined` si le mot de passe convient.
 *
 * `identityParts` reçoit l'email et le nom affiché : un mot de passe qui contient son propre
 * identifiant est deviné du premier coup par quiconque connaît l'annuaire interne — c'est-à-dire par
 * tout le monde, dans un outil interne.
 */
export function checkPasswordPolicy(
  password: string,
  identityParts: readonly string[] = [],
): PasswordRejection | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { reason: 'too_short', minLength: MIN_PASSWORD_LENGTH }
  }

  const normalized = password.trim().toLowerCase()
  if (COMPROMISED.has(normalized)) return { reason: 'compromised' }

  for (const part of identityParts) {
    // Le fragment significatif d'un email est ce qui précède l'arobase ; comparer l'adresse entière
    // ne verrait pas `operateur2026!` choisi par `operateur@example.test`.
    for (const fragment of fragmentsOf(part)) {
      if (fragment.length >= 4 && normalized.includes(fragment)) {
        return { reason: 'contains_identity' }
      }
    }
  }

  return undefined
}

function fragmentsOf(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[@.\s_-]+/)
    .filter((fragment) => fragment.length > 0)
}

/**
 * Le message rendu à l'opérateur — **conséquence d'abord**, et jamais le mot de passe lui-même.
 *
 * Ces libellés s'affichent à la création et à la rotation d'un mot de passe, pas à la connexion : un
 * échec de connexion ne dit jamais pourquoi.
 */
export function explainRejection(rejection: PasswordRejection): string {
  switch (rejection.reason) {
    case 'too_short':
      return `Ce mot de passe est refusé : il doit faire au moins ${rejection.minLength} caractères. La longueur protège davantage qu’un mélange de symboles.`
    case 'compromised':
      return 'Ce mot de passe est refusé : il figure parmi les plus utilisés, donc parmi les premiers essayés lors d’une attaque.'
    case 'contains_identity':
      return 'Ce mot de passe est refusé : il contient une partie de votre adresse ou de votre nom, que tout l’annuaire interne connaît.'
  }
}
