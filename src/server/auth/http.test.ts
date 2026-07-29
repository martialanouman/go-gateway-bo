// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { SESSION_COOKIE_NAME } from './cookie'
import { INVALID_CREDENTIALS_MESSAGE, loginResponse, parseCredentials } from './http'
import { ABSOLUTE_LIFETIME_MS } from './session'

const SECRETS = { current: 'une-cle-de-session-de-test-assez-longue' }
const SESSION_ID = '01890a5d-ac96-774b-bcce-b302099a8057'

describe('réponse de connexion', () => {
  it('ne met ni identifiant d opérateur ni identifiant de session dans le corps', async () => {
    // Les rendre au navigateur les sortirait du `HttpOnly`, donc les mettrait à portée d'un script
    // injecté. Tout le lien avec le second facteur passe par le cookie.
    const response = loginResponse(
      { outcome: 'mfa_required', operatorId: 'un-uuid-interne', sessionId: SESSION_ID },
      SECRETS,
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ mfa_required: true })
    expect(JSON.stringify(body)).not.toContain('un-uuid-interne')
    expect(JSON.stringify(body)).not.toContain(SESSION_ID)
  })

  it('pose un cookie de session signé, protégé', async () => {
    const cookie = loginResponse(
      { outcome: 'mfa_required', operatorId: 'x', sessionId: SESSION_ID },
      SECRETS,
    ).headers.get('set-cookie')

    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=${SESSION_ID}.`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
  })

  it('ne fait pas vivre le cookie plus longtemps que la session qu il désigne', () => {
    // Deux durées écrites séparément finissent par dire deux choses, et c'est le porteur qui
    // survivrait. La base resterait l'autorité — mais l'interface, elle, croirait qu'il reste une
    // session à reprendre, et n'irait au login qu'après un aller-retour pour rien.
    const cookie = loginResponse(
      { outcome: 'mfa_required', operatorId: 'x', sessionId: SESSION_ID },
      SECRETS,
    ).headers.get('set-cookie')

    const maxAge = Number(cookie?.match(/Max-Age=(\d+)/)?.[1])
    expect(maxAge).toBeGreaterThan(0)
    expect(maxAge).toBeLessThanOrEqual(ABSOLUTE_LIFETIME_MS / 1000)
  })

  it('ne pose aucun cookie sur un échec ni sur une limitation', () => {
    // Un cookie posé sur un échec donnerait une session à qui n'a rien prouvé.
    for (const outcome of [
      { outcome: 'invalid_credentials' },
      { outcome: 'rate_limited', retryAfterSeconds: 5 },
    ] as const) {
      expect(loginResponse(outcome, SECRETS).headers.get('set-cookie')).toBeNull()
    }
  })

  it('rend le même 401 et le même texte pour tous les échecs', async () => {
    const response = loginResponse({ outcome: 'invalid_credentials' }, SECRETS)

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
    const response = loginResponse({ outcome: 'rate_limited', retryAfterSeconds: 90 }, SECRETS)

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('90')
  })

  it('interdit la mise en cache de toute réponse d authentification', () => {
    // Un intermédiaire qui garderait une de ces réponses la servirait à quelqu'un d'autre.
    for (const outcome of [
      { outcome: 'mfa_required', operatorId: 'x', sessionId: SESSION_ID },
      { outcome: 'invalid_credentials' },
      { outcome: 'rate_limited', retryAfterSeconds: 5 },
    ] as const) {
      expect(loginResponse(outcome, SECRETS).headers.get('cache-control')).toBe('no-store')
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
