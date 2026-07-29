// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  checkTotpCode,
  generateTotpSecret,
  TOTP_PERIOD_SECONDS,
  totpEnrollmentUri,
} from './mfa-totp'

/**
 * Le secret de la RFC 6238 — les vingt octets ASCII `12345678901234567890`, en base32.
 *
 * Les vecteurs qui l'accompagnent valent mieux qu'une vérification de la bibliothèque contre
 * elle-même : ils prouvent que ce module produit bien du TOTP standard — SHA-1, pas de trente
 * secondes, six chiffres — donc qu'une application authenticator du commerce s'accordera avec lui.
 */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

/** Instant → code attendu, tirés de la table de la RFC 6238 tronquée à six chiffres. */
const RFC_VECTORS = [
  { epoch: 59, code: '287082' },
  { epoch: 1_111_111_109, code: '081804' },
  { epoch: 1_234_567_890, code: '005924' },
] as const

const at = (epoch: number) => new Date(epoch * 1000)

describe('génération du secret TOTP', () => {
  it('rend un secret en base32, assez long pour la recommandation de la RFC 4226', () => {
    const secret = generateTotpSecret()

    // Vingt octets, soit trente-deux caractères de base32 : le minimum recommandé est de cent
    // soixante bits, et un secret plus court affaiblirait le facteur sans que rien ne le signale.
    expect(secret).toMatch(/^[A-Z2-7]{32,}$/)
  })

  it('ne rend jamais deux fois le même secret', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret())
  })
})

describe("URI d'enrôlement", () => {
  const uri = totpEnrollmentUri(RFC_SECRET, 'operatrice@example.test')

  it("porte tout ce qu'une application authenticator doit lire", () => {
    expect(uri.startsWith('otpauth://totp/')).toBe(true)
    expect(uri).toContain(`secret=${RFC_SECRET}`)
  })

  it('laisse implicites les paramètres qui valent déjà le défaut du format', () => {
    // `algorithm`, `digits` et `period` sont omis parce qu'ils valent SHA-1, six et trente — les
    // défauts de la *Key Uri Format*. Les écrire n'ajouterait rien et allongerait un QR code dont la
    // densité décide de la facilité à le scanner.
    expect(uri).not.toContain('period=')
    expect(uri).not.toContain('digits=')
    expect(uri).not.toContain('algorithm=')
  })

  it("nomme l'opérateur et l'émetteur, pour distinguer deux comptes dans la même application", () => {
    expect(decodeURIComponent(uri)).toContain('operatrice@example.test')
    expect(uri).toContain('issuer=')
  })
})

describe('vérification du code', () => {
  it.each(RFC_VECTORS)('accepte le code $code de la RFC à l’instant $epoch', async (vector) => {
    const result = await checkTotpCode(RFC_SECRET, vector.code, at(vector.epoch))

    expect(result.valid).toBe(true)
  })

  it('rend le pas de temps consommé — ce dont dépend tout l’anti-rejeu', async () => {
    const result = await checkTotpCode(RFC_SECRET, '287082', at(59))

    expect(result).toEqual({ valid: true, timeStep: Math.floor(59 / TOTP_PERIOD_SECONDS) })
  })

  it('tolère une horloge en retard d’un pas', async () => {
    // Une application authenticator dont l'horloge dérive de quelques secondes reste utilisable :
    // sans cette tolérance, la moitié des tentatives légitimes échoueraient au changement de pas.
    const result = await checkTotpCode(RFC_SECRET, '287082', at(59 + TOTP_PERIOD_SECONDS))

    expect(result.valid).toBe(true)
  })

  it('refuse un code au pas suivant celui qu’elle tolère', async () => {
    // La borne exacte, pas un instant lointain : c'est elle qui décide combien de temps un code
    // intercepté vaut encore quelque chose, et c'est elle qu'un élargissement de fenêtre déplacerait
    // sans qu'un test à quatre pas ne le voie.
    const result = await checkTotpCode(RFC_SECRET, '287082', at(59 + 2 * TOTP_PERIOD_SECONDS))

    expect(result.valid).toBe(false)
  })

  it('refuse un code faux', async () => {
    expect((await checkTotpCode(RFC_SECRET, '000000', at(59))).valid).toBe(false)
  })

  it('refuse une saisie qui n’est pas un code, sans lever', async () => {
    // La saisie vient du réseau. Une exception ici ferait remonter un 500 là où un refus est la
    // seule réponse correcte — et rendrait la sonde distinguable de l'échec ordinaire.
    for (const input of ['', 'abcdef', '12345', '1234567', '  ']) {
      expect((await checkTotpCode(RFC_SECRET, input, at(59))).valid).toBe(false)
    }
  })

  it('refuse tout code si le secret est illisible, sans lever', async () => {
    // Le secret arrive d'une enveloppe déchiffrée : une colonne bricolée ne doit pas faire tomber
    // le point d'entrée, elle doit faire échouer la vérification.
    expect((await checkTotpCode('pas-du-base32-!', '287082', at(59))).valid).toBe(false)
  })
})
