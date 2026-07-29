/**
 * Hachage et vérification de mot de passe.
 *
 * **scrypt de `node:crypto`**, sans dépendance. Argon2id est le premier choix de l'OWASP, et il
 * n'est pas retenu ici : les implémentations Node passent toutes par un module natif, ce qui heurte
 * la politique d'approvisionnement du dépôt (quarantaine de 24 h, `allowBuilds` explicite, chaque
 * avis `pnpm audit` trié à la main). scrypt est le second choix de la même recommandation, il est
 * dans la bibliothèque standard, et le format d'empreinte ci-dessous rend le changement possible
 * plus tard sans invalider un seul mot de passe.
 *
 * ## Le format porte ses paramètres
 *
 * `$scrypt$n=131072,r=8,p=1$<sel base64>$<empreinte base64>` — la convention PHC, celle qu'utilisent
 * argon2 et bcrypt. La vérification lit les paramètres **de l'empreinte**, jamais ceux de la
 * configuration courante : durcir les paramètres n'invalide donc rien, les anciennes empreintes
 * restent vérifiables, et un futur `$argon2id$…` cohabitera avec elles le temps de la migration.
 *
 * ## Le coût mémoire est une contrainte d'architecture, pas un réglage
 *
 * Aux paramètres de production, **chaque vérification en vol demande 128 Mio** et 166 ms. Dix
 * tentatives simultanées, ce sont 1,3 Gio. La step-021 (anti-brute-force) doit donc borner la
 * **concurrence** des vérifications, et pas seulement le nombre d'essais par compte : sans cela,
 * cinquante requêtes de login concurrentes suffisent à faire tomber une instance par épuisement
 * mémoire — un déni de service qui ne coûte rien à monter.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

export type ScryptParameters = { readonly N: number; readonly r: number; readonly p: number }

/**
 * Recommandation OWASP pour scrypt. Mesurés à 166 ms et 128 Mio par vérification.
 *
 * Ces valeurs montent avec le matériel, elles ne redescendent pas : une empreinte produite avec des
 * paramètres plus faibles reste vérifiable, donc rien n'oblige à les figer pour toujours.
 */
export const PASSWORD_PARAMETERS: ScryptParameters = { N: 131_072, r: 8, p: 1 }

/** Seize octets, la longueur minimale que recommande la documentation de `crypto.scrypt`. */
const SALT_BYTES = 16

/** Soixante-quatre octets : plus long que n'importe quelle empreinte utile à comparer. */
const KEY_BYTES = 64

/**
 * Plafond mémoire concédé à un appel, avec la marge que scrypt exige au-dessus de `128 × N × r`.
 *
 * Il borne aussi les empreintes **venues de la base** : une ligne corrompue ou fabriquée annonçant
 * `n=1073741824` ferait sinon allouer des gigaoctets à la première tentative de connexion.
 */
export const MAX_MEMORY_BYTES = 192 * 1024 * 1024

/**
 * Mémoire qu'OpenSSL demande réellement pour un jeu de paramètres.
 *
 * **Ce n'est pas `128 × N × r`.** Vérifié : avec `N=131072, r=8, p=1`, `maxmem = 128 × N × r` —
 * soit 134 217 728 — échoue en « memory limit exceeded ». Le seuil exact est 134 220 800, la formule
 * ci-dessous. L'écart est de trois kilo-octets, ce qui suffit à faire échouer 100 % des connexions.
 */
function memoryFor(N: number, r: number, p: number): number {
  return 128 * r * (N + 2) + 128 * r * p
}

/**
 * Plafond de parallélisme accepté dans une empreinte lue en base.
 *
 * `p` n'ajoute presque rien à la mémoire mais multiplie le **temps**. Une empreinte forgée avec
 * `p=50000` passerait une garde qui ne regarde que la mémoire, et occuperait un thread du pool
 * libuv — quatre par défaut — pendant des heures, dès la première tentative de connexion.
 */
const MAX_PARALLELISM = 16

/**
 * Plafond de `N` accepté dans une empreinte lue en base.
 *
 * La borne existe aussi pour rattraper une limite de l'arithmétique : le test de puissance de deux
 * `N & (N - 1)` opère sur 32 bits signés, si bien que `N = 2**32` y passe pour une puissance de deux
 * valide. Le vérifier ici plutôt que de dépendre de l'ordre des gardes suivantes.
 */
const MAX_COST = 2 ** 20

/** Hache un mot de passe. Rend une empreinte auto-descriptive, prête à être stockée telle quelle. */
export async function hashPassword(
  password: string,
  parameters: ScryptParameters = PASSWORD_PARAMETERS,
): Promise<string> {
  if (password.length === 0) {
    // Une empreinte de chaîne vide est parfaitement valide et se vérifierait sans broncher : un
    // opérateur créé avec un mot de passe vide se connecterait en laissant le champ vide.
    throw new Error('Un mot de passe vide ne peut pas être haché.')
  }

  const salt = randomBytes(SALT_BYTES)
  const derived = await scrypt(password, salt, KEY_BYTES, {
    ...parameters,
    maxmem: MAX_MEMORY_BYTES,
  })

  return `$scrypt$n=${parameters.N},r=${parameters.r},p=${parameters.p}$${salt.toString('base64')}$${derived.toString('base64')}`
}

/**
 * Vérifie un mot de passe contre une empreinte stockée.
 *
 * Rend `false` pour toute empreinte illisible — jamais une exception. Une trace de pile remontée
 * jusqu'à un formulaire de login raconterait la structure du stockage, et une ligne corrompue en
 * base doit refuser la connexion, pas casser l'écran.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored)
  if (!parsed) return false

  try {
    const derived = await scrypt(password, parsed.salt, parsed.expected.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: MAX_MEMORY_BYTES,
    })

    // Longueurs égales par construction — `timingSafeEqual` lève sinon. La comparaison est à temps
    // constant pour ne pas laisser mesurer, octet par octet, à quel endroit l'empreinte diverge.
    return timingSafeEqual(derived, parsed.expected)
  } catch {
    // Paramètres hors de ce que `maxmem` autorise, ou empreinte de longueur aberrante : refus.
    return false
  }
}

type Parsed = { N: number; r: number; p: number; salt: Buffer; expected: Buffer }

function parse(stored: string): Parsed | undefined {
  const match = /^\$scrypt\$n=(\d+),r=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(stored)
  if (!match) return undefined

  const [, rawN, rawR, rawP, rawSalt, rawExpected] = match
  // `noUncheckedIndexedAccess` type les captures en `string | undefined` : elles sont garanties par
  // la forme du motif, mais le compilateur ne le sait pas, et le lui faire admettre par un `!`
  // supprimerait la garde partout où le motif changerait.
  if (!rawN || !rawR || !rawP || !rawSalt || !rawExpected) return undefined

  const N = Number(rawN)
  const r = Number(rawR)
  const p = Number(rawP)

  // `N` doit être une puissance de deux — scrypt lève sinon — et le coût annoncé doit tenir dans ce
  // qu'on accepte de calculer. Ces valeurs viennent de la base : elles sont à traiter comme une
  // entrée hostile, pas comme une donnée de confiance.
  if (!Number.isInteger(N) || N < 2 || N > MAX_COST || (N & (N - 1)) !== 0) return undefined
  if (!Number.isInteger(r) || r < 1 || r > 32) return undefined
  if (!Number.isInteger(p) || p < 1 || p > MAX_PARALLELISM) return undefined
  if (memoryFor(N, r, p) > MAX_MEMORY_BYTES) return undefined

  const salt = decodeBase64(rawSalt)
  const expected = decodeBase64(rawExpected)
  if (!salt || !expected || salt.length === 0 || expected.length === 0) return undefined

  return { N, r, p, salt, expected }
}

/**
 * `Buffer.from(…, 'base64')` ignore les caractères invalides au lieu d'échouer : `'!!!'` rendrait un
 * tampon vide plutôt qu'une erreur. On ré-encode pour vérifier que l'entrée était bien du base64.
 */
function decodeBase64(value: string): Buffer | undefined {
  const decoded = Buffer.from(value, 'base64')
  return decoded.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '')
    ? decoded
    : undefined
}
