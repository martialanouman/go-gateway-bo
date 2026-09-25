const UPPERCASE = /\p{Lu}/u
const LOWERCASE = /\p{Ll}/u
const DIGIT = /\p{Nd}/u
const SPECIAL = /[^\p{L}\p{Nd}]/u
const MINIMUM_LENGTH = 12

/**
 * Le miroir client d'`auth.CheckPassword` (`internal/auth/policy.go`) — mêmes cinq libellés, même
 * ordre. Écrit à la main plutôt qu'engendré : le contrat ne porte pas de politique de mot de passe,
 * et rien ne dériverait d'un schéma OpenAPI qui ne la déclare pas.
 */
export function missingFromPassword(value: string): string[] {
  const missing: string[] = []

  if ([...value].length < MINIMUM_LENGTH) missing.push('douze caractères au moins')
  if (!UPPERCASE.test(value)) missing.push('une majuscule')
  if (!LOWERCASE.test(value)) missing.push('une minuscule')
  if (!DIGIT.test(value)) missing.push('un chiffre')
  if (!SPECIAL.test(value)) missing.push('un caractère spécial')

  return missing
}
