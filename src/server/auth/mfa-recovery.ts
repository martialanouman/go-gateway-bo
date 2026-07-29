/**
 * Les codes de récupération — ce qu'un opérateur présente quand son téléphone n'est plus là.
 *
 * ## Ils suivent la règle des secrets d'identifiants (invariant b)
 *
 * Affichés **une seule fois**, à la création du lot, et jamais réaffichés. Aucune action « revoir mes
 * codes » n'existe et n'existera : la seule opération possible est d'en régénérer un lot, ce qui
 * invalide le précédent. C'est ce qui fait qu'une capture d'écran de la console ne contient jamais
 * de code utilisable.
 *
 * ## Le format se recopie à la main, sous pression
 *
 * Un opérateur lit ces codes sur un papier ou dans un gestionnaire de mots de passe, au moment
 * précis où il ne peut plus entrer. L'alphabet écarte donc `0`, `O`, `1`, `I`, `L` et `U` — les
 * caractères qu'on lit de travers — et la saisie est normalisée avant hachage : tirets, espaces et
 * casse sont des variantes de la même chose, pas des codes différents.
 *
 * Trente caractères possibles sur dix positions font près de cinquante bits. À ce niveau, la force
 * brute en ligne ne mène nulle part, et c'est ce qui justifie un HMAC plutôt qu'un scrypt — voir
 * l'en-tête de la table dans `db/schema/auth.ts`.
 */

import { createHmac, randomInt } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database, Querier } from '../db/index'
import { operatorRecoveryCodes } from '../db/schema/auth'
import type { MfaKeys } from './mfa-secret'

/** Taille du lot. Voir le test : assez pour ne pas pousser à désactiver le facteur en cours de route. */
export const RECOVERY_CODE_COUNT = 10

/** Alphabet sans les caractères ambigus à la lecture — ni `0`/`O`, ni `1`/`I`/`L`, ni `U`. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Deux groupes de cinq : la longueur au-delà de laquelle une recopie manuelle décroche. */
const GROUP_LENGTH = 5
const GROUPS = 2

/**
 * Un lot de codes prêts à être montrés — **une seule fois**.
 *
 * L'appelant les hache pour les stocker et rend les originaux dans la réponse. Rien ne les conserve
 * ensuite : ni journal, ni cache, ni variable de module.
 */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    Array.from({ length: GROUPS }, () => randomGroup()).join('-'),
  )
}

/**
 * Un groupe tiré **sans biais** dans l'alphabet.
 *
 * `randomBytes(1)[0] % 30` favoriserait les seize premiers caractères, puisque 256 n'est pas un
 * multiple de 30 — de quoi retirer discrètement quelques bits à un secret qui n'en a pas de trop.
 * `randomInt` fait le rejet d'échantillons lui-même, dans la bibliothèque standard : on hérite d'une
 * distribution uniforme sans écrire la boucle qui la produit, donc sans la branche impossible à
 * couvrir qu'elle traînerait avec elle.
 */
function randomGroup(): string {
  return Array.from({ length: GROUP_LENGTH }, () =>
    ALPHABET.charAt(randomInt(ALPHABET.length)),
  ).join('')
}

/**
 * Le condensat sous lequel un code est stocké et retrouvé.
 *
 * Déterministe, et il doit l'être : la vérification retrouve le code **par égalité**, donc par index.
 * Un sel par ligne — ce que fait un mot de passe — obligerait à essayer les dix lignes une par une.
 */
export function hashRecoveryCode(code: string, keys: MfaKeys): string {
  return createHmac('sha256', keys.recoveryPepper).update(normalize(code), 'utf8').digest('hex')
}

/** Casse et séparateurs ne distinguent pas deux codes : ils distinguent deux façons de le taper. */
function normalize(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, '')
}

/**
 * Remplace le lot d'un opérateur, en une transaction.
 *
 * Remplacer, et non ajouter : un nouveau lot **invalide** le précédent, sinon les codes d'un
 * téléphone perdu resteraient valables aussi longtemps que l'opérateur existe. La transaction évite
 * qu'un échec entre la suppression et l'insertion laisse un compte sans aucune porte de sortie.
 *
 * Accepte une transaction déjà ouverte : l'activation d'un facteur et la création de ses codes
 * doivent réussir ensemble, et c'est l'appelant qui tient cette transaction. Passer le pool ouvre la
 * sienne ; passer une transaction pose un point de sauvegarde à l'intérieur.
 */
export async function replaceRecoveryCodes(
  db: Querier,
  operatorId: string,
  codes: readonly string[],
  keys: MfaKeys,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(operatorRecoveryCodes).where(eq(operatorRecoveryCodes.operatorId, operatorId))
    await tx
      .insert(operatorRecoveryCodes)
      .values(codes.map((code) => ({ operatorId, codeHash: hashRecoveryCode(code, keys) })))
  })
}

/**
 * Consomme un code, et rend `true` s'il valait quelque chose.
 *
 * **Une seule écriture conditionnelle**, et c'est ce qui rend l'usage unique vrai : lire puis écrire
 * laisserait deux requêtes simultanées — deux instances, deux onglets — consommer le même code et
 * franchir toutes les deux. Ici, PostgreSQL n'accorde la ligne qu'à la première ; la seconde ne
 * reçoit rien et se voit refusée.
 */
export async function consumeRecoveryCode(
  db: Database,
  operatorId: string,
  code: string,
  keys: MfaKeys,
): Promise<boolean> {
  const consumed = await db
    .update(operatorRecoveryCodes)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(operatorRecoveryCodes.operatorId, operatorId),
        eq(operatorRecoveryCodes.codeHash, hashRecoveryCode(code, keys)),
        isNull(operatorRecoveryCodes.usedAt),
      ),
    )
    .returning({ id: operatorRecoveryCodes.id })

  return consumed.length > 0
}

/**
 * Combien de codes restent utilisables.
 *
 * Ce nombre est rendu à l'opérateur après chaque consommation : « il vous en reste trois » est ce qui
 * lui fait régénérer un lot avant d'arriver à zéro, moment où seule une intervention administrative
 * le remettrait dans la console.
 */
export async function countUnusedRecoveryCodes(db: Database, operatorId: string): Promise<number> {
  const rows = await db
    .select({ id: operatorRecoveryCodes.id })
    .from(operatorRecoveryCodes)
    .where(
      and(eq(operatorRecoveryCodes.operatorId, operatorId), isNull(operatorRecoveryCodes.usedAt)),
    )

  return rows.length
}
