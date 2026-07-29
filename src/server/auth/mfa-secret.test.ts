// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { openTotpSecret, readMfaKeys, sealTotpSecret } from './mfa-secret'

const SECRET = 'une-cle-mfa-de-test-suffisamment-longue-pour-passer'
const OTHER_SECRET = 'une-autre-cle-mfa-de-test-tout-aussi-longue-quelle'

const KEYS = readMfaKeys({ AUTH_MFA_SECRET: SECRET })
const OTHER_KEYS = readMfaKeys({ AUTH_MFA_SECRET: OTHER_SECRET })

const OPERATOR_ID = '01890a5d-ac96-774b-bcce-b302099a8057'
const OTHER_OPERATOR_ID = '01890a5d-ac96-774b-bcce-b302099a8058'
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP'

describe('lecture de la clé MFA', () => {
  it('nomme la variable absente plutôt que « configuration incomplète »', () => {
    expect(() => readMfaKeys({})).toThrow(/AUTH_MFA_SECRET/)
  })

  it('refuse une clé trop courte', () => {
    expect(() => readMfaKeys({ AUTH_MFA_SECRET: 'trop-courte' })).toThrow(/AUTH_MFA_SECRET/)
  })

  it('dérive deux clés distinctes de trente-deux octets', () => {
    // Le poivre des codes de récupération ne doit pas être la clé de chiffrement : une seule et même
    // valeur ferait qu'une fuite de l'une compromettrait l'autre usage.
    expect(KEYS.encryption).toHaveLength(32)
    expect(KEYS.recoveryPepper).toHaveLength(32)
    expect(KEYS.encryption.equals(KEYS.recoveryPepper)).toBe(false)
  })

  it('dérive les mêmes clés à chaque lecture', () => {
    // Le poivre sert à retrouver un code de récupération par égalité : une dérivation qui varierait
    // rendrait tous les codes déjà stockés introuvables.
    const reread = readMfaKeys({ AUTH_MFA_SECRET: SECRET })

    expect(reread.encryption.equals(KEYS.encryption)).toBe(true)
    expect(reread.recoveryPepper.equals(KEYS.recoveryPepper)).toBe(true)
  })
})

describe('chiffrement du secret TOTP', () => {
  it('scelle puis rouvre son propre secret', () => {
    const envelope = sealTotpSecret(TOTP_SECRET, OPERATOR_ID, KEYS)

    expect(openTotpSecret(envelope, OPERATOR_ID, KEYS)).toBe(TOTP_SECRET)
  })

  it('ne laisse pas le secret lisible dans son enveloppe', () => {
    const envelope = sealTotpSecret(TOTP_SECRET, OPERATOR_ID, KEYS)

    expect(envelope).not.toContain(TOTP_SECRET)
    expect(Buffer.from(envelope, 'utf8').includes(TOTP_SECRET)).toBe(false)
  })

  it('produit deux enveloppes différentes pour le même secret', () => {
    // Un vecteur d'initialisation réutilisé en GCM détruit la confidentialité **et** l'authenticité :
    // deux enveloppes identiques diraient déjà que deux opérateurs partagent le même secret.
    expect(sealTotpSecret(TOTP_SECRET, OPERATOR_ID, KEYS)).not.toBe(
      sealTotpSecret(TOTP_SECRET, OPERATOR_ID, KEYS),
    )
  })

  it("refuse l'enveloppe d'un autre opérateur", () => {
    // L'identifiant scelle l'enveloppe : recopier une ligne d'opérateur vers une autre ne transporte
    // pas le second facteur avec elle.
    const envelope = sealTotpSecret(TOTP_SECRET, OPERATOR_ID, KEYS)

    expect(openTotpSecret(envelope, OTHER_OPERATOR_ID, KEYS)).toBeUndefined()
  })

  it('refuse une enveloppe scellée sous une autre clé', () => {
    const envelope = sealTotpSecret(TOTP_SECRET, OPERATOR_ID, OTHER_KEYS)

    expect(openTotpSecret(envelope, OPERATOR_ID, KEYS)).toBeUndefined()
  })

  it('refuse une enveloppe altérée', () => {
    const [version, iv, tag, ciphertext] = sealTotpSecret(TOTP_SECRET, OPERATOR_ID, KEYS).split('.')

    // Un octet retourné, pas un caractère de base64url : les derniers bits d'un encodage base64url
    // ne portent parfois rien, et un test qui les modifierait verrait passer une enveloppe pourtant
    // intacte — donc ne prouverait rien du sceau.
    const bytes = Buffer.from(ciphertext ?? '', 'base64url')
    bytes[0] = (bytes[0] ?? 0) ^ 0xff

    expect(
      openTotpSecret(`${version}.${iv}.${tag}.${bytes.toString('base64url')}`, OPERATOR_ID, KEYS),
    ).toBeUndefined()
  })

  it("refuse un sceau qui n'est pas celui de l'enveloppe", () => {
    const [version, iv, , ciphertext] = sealTotpSecret(TOTP_SECRET, OPERATOR_ID, KEYS).split('.')
    const [, , otherTag] = sealTotpSecret(TOTP_SECRET, OPERATOR_ID, KEYS).split('.')

    expect(
      openTotpSecret(`${version}.${iv}.${otherTag}.${ciphertext}`, OPERATOR_ID, KEYS),
    ).toBeUndefined()
  })

  it('refuse une enveloppe dont la version a été réécrite', () => {
    // La version entre dans les données authentifiées : le jour où un format `v2` existera, réécrire
    // le marqueur pour faire relire une enveloppe sous les règles de l'autre ne passera pas.
    const envelope = sealTotpSecret(TOTP_SECRET, OPERATOR_ID, KEYS)

    expect(openTotpSecret(envelope.replace(/^v1/, 'v2'), OPERATOR_ID, KEYS)).toBeUndefined()
  })

  it('refuse une enveloppe illisible sans lever', () => {
    // Une enveloppe illisible est un cas d'exploitation — clé retirée, colonne bricolée — et doit se
    // lire comme « aucun second facteur exploitable », donc un refus, jamais comme une erreur 500
    // qui rendrait la panne indiscernable d'une attaque.
    for (const envelope of ['', 'nimporte-quoi', 'v1.', 'v2.a.b.c', 'v1.a.b', 'v1.@.@.@']) {
      expect(openTotpSecret(envelope, OPERATOR_ID, KEYS)).toBeUndefined()
    }
  })
})
