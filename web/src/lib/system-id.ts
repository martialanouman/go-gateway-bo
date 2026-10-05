const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const PREFIX_LENGTH = 8
const SUFFIX_LENGTH = 6
const FALLBACK_LENGTH = 12

function randomCharacters(length: number) {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(length)),
    // 256 n'est pas un multiple de 36 : un biais de quelques pour cent, sans portée pour un
    // identifiant de connexion qui n'a rien de secret et dont la passerelle garde l'unicité.
    (byte) => ALPHABET[byte % ALPHABET.length],
  ).join('')
}

/**
 * Un `system_id` lisible et presque sûrement libre : le nom du compte puis un suffixe aléatoire,
 * 15 caractères au plus (SMPP v3.4 §4.1.1). La passerelle refuse un doublon en 409.
 */
export function generatedSystemId(accountName: string) {
  const prefix = accountName
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, PREFIX_LENGTH)

  return prefix === ''
    ? randomCharacters(FALLBACK_LENGTH)
    : `${prefix}-${randomCharacters(SUFFIX_LENGTH)}`
}
