// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { INVALID_CREDENTIALS_MESSAGE, loginResponse, parseCredentials } from './http'

describe('réponse de connexion', () => {
  it('ne rend ni session ni identifiant d opérateur au succès', async () => {
    // Rendre l'`operatorId` au navigateur transformerait la réussite du mot de passe en fuite
    // d'identifiant interne — et la session n'existe de toute façon qu'après le second facteur.
    const response = loginResponse({ outcome: 'mfa_required', operatorId: 'un-uuid-interne' })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ mfa_required: true })
    expect(JSON.stringify(body)).not.toContain('un-uuid-interne')
  })

  it('rend le même 401 et le même texte pour tous les échecs', async () => {
    const response = loginResponse({ outcome: 'invalid_credentials' })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: INVALID_CREDENTIALS_MESSAGE })
  })

  it('ne dit jamais ce qui a échoué', () => {
    // La distinction se glisse toujours par commodité de débogage, et elle énumère les comptes.
    expect(INVALID_CREDENTIALS_MESSAGE).not.toMatch(
      /inconnu|introuvable|verrouill|désactiv|existe/i,
    )
  })

  it('annonce le délai d attente d une adresse limitée', async () => {
    const response = loginResponse({ outcome: 'rate_limited', retryAfterSeconds: 90 })

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('90')
  })

  it('interdit la mise en cache de toute réponse d authentification', () => {
    // Un intermédiaire qui garderait une de ces réponses la servirait à quelqu'un d'autre.
    for (const outcome of [
      { outcome: 'mfa_required', operatorId: 'x' },
      { outcome: 'invalid_credentials' },
      { outcome: 'rate_limited', retryAfterSeconds: 5 },
    ] as const) {
      expect(loginResponse(outcome).headers.get('cache-control')).toBe('no-store')
    }
  })
})

describe('lecture des identifiants', () => {
  it('accepte une saisie bien formée', () => {
    expect(parseCredentials({ identifier: 'a@b.test', password: 'secret' })).toEqual({
      ok: true,
      identifier: 'a@b.test',
      password: 'secret',
    })
  })

  it('refuse tout corps malformé sans distinguer les cas', () => {
    // Traité **exactement** comme un échec d'authentification par l'appelant : un 400 sur saisie
    // invalide et un 401 sur saisie valide donneraient un chemin plus rapide que la vérification,
    // donc un oracle de plus.
    for (const body of [
      null,
      undefined,
      'une chaîne',
      42,
      {},
      { identifier: 'a@b.test' },
      { password: 'secret' },
      { identifier: 42, password: 'secret' },
      { identifier: 'a@b.test', password: null },
      { identifier: '', password: 'secret' },
      { identifier: 'a@b.test', password: '' },
    ]) {
      expect(parseCredentials(body), JSON.stringify(body) ?? 'undefined').toEqual({ ok: false })
    }
  })

  it('borne la taille de la saisie', () => {
    // Le mot de passe part dans scrypt : un mégaoctet consommerait une place de vérification pour
    // rien, ce qui suffit à saturer la file avec très peu de requêtes.
    expect(parseCredentials({ identifier: 'a'.repeat(400), password: 'secret' })).toEqual({
      ok: false,
    })
    expect(parseCredentials({ identifier: 'a@b.test', password: 'x'.repeat(2000) })).toEqual({
      ok: false,
    })
  })
})
