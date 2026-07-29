/**
 * Le secret TOTP au repos, et le poivre des codes de récupération.
 *
 * ## Pourquoi un chiffrement, alors que les mots de passe se contentent d'un hachage
 *
 * Parce que ce n'est pas la même donnée. Une empreinte de mot de passe ne sert qu'à vérifier ; un
 * secret TOTP est **exploitable tel quel** — qui le lit produit des codes valides indéfiniment. Une
 * lecture de la base, un réplica, une sauvegarde qui traîne, et le second facteur ne coûte plus
 * rien. On ne peut pas le hacher : la vérification a besoin du secret lui-même.
 *
 * Le chiffrement déplace donc la question : lire la base ne suffit plus, il faut **aussi** le
 * fichier d'environnement. Deux compromissions au lieu d'une, et elles ne se produisent pas au même
 * endroit — un dump de base circule, une variable d'environnement de production beaucoup moins.
 *
 * ## AES-256-GCM, et l'identifiant de l'opérateur en donnée authentifiée
 *
 * GCM authentifie ce qu'il chiffre : une enveloppe modifiée ne se déchiffre pas, elle est refusée.
 * L'identifiant de l'opérateur y entre comme **donnée associée** — il n'est pas chiffré, il est
 * couvert par le sceau. Conséquence concrète : recopier la colonne d'un opérateur vers un autre en
 * base ne transporte pas son second facteur. Sans cette liaison, quiconque écrit dans la table se
 * donnerait le second facteur d'un administrateur en copiant une ligne.
 *
 * ## Une seule variable, deux usages, jamais la même valeur
 *
 * `AUTH_MFA_SECRET` porte le matériel initial ; HKDF en dérive deux clés indépendantes — celle qui
 * chiffre, et le poivre sous lequel les codes de récupération sont hachés. Les employer toutes deux
 * telles quelles ferait qu'une fuite dans un usage compromettrait l'autre, et demander deux
 * variables à l'exploitant pour la même cérémonie de déploiement n'aurait fait qu'inviter à les
 * remplir avec la même valeur.
 *
 * ## Ce que perdre la clé signifie, et pourquoi ce n'est pas une raison de s'en passer
 *
 * Perdre `AUTH_MFA_SECRET` rend tous les seconds facteurs illisibles : plus personne ne franchit le
 * MFA, codes de récupération compris. C'est une **panne franche** — bruyante, immédiate, réparable
 * par une réinitialisation administrative — et non une faille silencieuse. La sauvegarde de cette
 * clé appartient à l'exploitation, au même titre que celle de `AUTH_SESSION_SECRET`.
 *
 * **Pas de rotation ici**, contrairement au cookie de session : elle exigerait de re-chiffrer chaque
 * secret et de re-hacher des codes de récupération qu'on ne connaît plus (ils ne sont jamais
 * réaffichés — invariant b). Une rotation réelle est donc une réinitialisation du second facteur,
 * pas un changement de clé — d'où le préfixe de version dans l'enveloppe, qui laisse la porte
 * ouverte le jour où ce travail sera fait.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/** Longueur minimale de `AUTH_MFA_SECRET`. Même exigence que les autres secrets du BFF. */
const MINIMUM_SECRET_LENGTH = 32

/** AES-256 : trente-deux octets de clé, douze octets de vecteur — la taille native de GCM. */
const KEY_BYTES = 32
const IV_BYTES = 12

/**
 * Sel de dérivation. Constant, et c'est correct ici : HKDF n'exige un sel aléatoire que lorsque le
 * matériel initial est de faible entropie. `AUTH_MFA_SECRET` est un secret long tiré au hasard —
 * c'est l'étiquette d'usage (`info`) qui fait le travail de séparation.
 */
const HKDF_SALT = 'gwbo-mfa-v1'

/** Marqueur de format. Une enveloppe d'une autre version se refuse plutôt que de se deviner. */
const ENVELOPE_VERSION = 'v1'

export type MfaKeys = {
  /** Clé AES-256-GCM du secret TOTP. */
  readonly encryption: Buffer
  /** Poivre HMAC des codes de récupération — voir `mfa-recovery.ts`. */
  readonly recoveryPepper: Buffer
}

/**
 * Lit `AUTH_MFA_SECRET` et en dérive les deux clés.
 *
 * Aucune valeur par défaut : une clé de repli codée en dur serait publique, et le chiffrement
 * deviendrait décoratif — la base seule suffirait à produire des codes valides.
 */
export function readMfaKeys(env: NodeJS.ProcessEnv): MfaKeys {
  const secret = env.AUTH_MFA_SECRET
  if (!secret || secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `AUTH_MFA_SECRET est requise et doit faire au moins ${MINIMUM_SECRET_LENGTH} caractères : elle chiffre les secrets TOTP.`,
    )
  }

  return {
    encryption: derive(secret, 'totp-secret-encryption'),
    recoveryPepper: derive(secret, 'recovery-code-pepper'),
  }
}

function derive(secret: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, HKDF_SALT, info, KEY_BYTES))
}

/**
 * Ce que le sceau couvre sans le chiffrer : la version du format **et** l'opérateur.
 *
 * La version y entre au même titre que l'identifiant. Le jour où un format `v2` existera, réécrire
 * le marqueur d'une enveloppe pour la faire relire sous les règles de l'autre — un déclassement —
 * échouera au sceau, et pas seulement à un `if` qu'une relecture distraite pourrait déplacer.
 */
function associatedData(operatorId: string): Buffer {
  return Buffer.from(`${ENVELOPE_VERSION}:${operatorId}`, 'utf8')
}

/**
 * Scelle un secret TOTP pour un opérateur donné.
 *
 * `<version>.<vecteur>.<sceau>.<chiffré>`, chaque partie en base64url. Le vecteur est tiré à chaque
 * appel : le réutiliser sous la même clé briserait GCM entièrement, pas seulement la confidentialité.
 */
export function sealTotpSecret(secret: string, operatorId: string, keys: MfaKeys): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', keys.encryption, iv)
  cipher.setAAD(associatedData(operatorId))

  const sealed = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])

  return [
    ENVELOPE_VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    sealed.toString('base64url'),
  ].join('.')
}

/**
 * Rouvre une enveloppe, ou rend `undefined`.
 *
 * **Jamais d'exception**, et c'est une décision de sécurité plutôt qu'un confort d'appel : une
 * enveloppe illisible — clé retirée, colonne bricolée, ligne recopiée d'un autre opérateur — doit se
 * lire comme « aucun second facteur exploitable », donc aboutir au **refus** du code présenté. Une
 * erreur 500 rendrait la panne d'exploitation indiscernable d'une tentative, et les deux se traitent
 * différemment.
 */
export function openTotpSecret(
  envelope: string,
  operatorId: string,
  keys: MfaKeys,
): string | undefined {
  const [version, iv, tag, sealed] = envelope.split('.')
  if (version !== ENVELOPE_VERSION || !iv || !tag || !sealed) return undefined

  try {
    const decipher = createDecipheriv('aes-256-gcm', keys.encryption, Buffer.from(iv, 'base64url'))
    decipher.setAAD(associatedData(operatorId))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))

    return Buffer.concat([
      decipher.update(Buffer.from(sealed, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return undefined
  }
}
