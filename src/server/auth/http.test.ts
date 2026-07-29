// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { SESSION_COOKIE_NAME } from './cookie'
import {
  ALREADY_ENROLLED_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  INVALID_MFA_CODE_MESSAGE,
  loginResponse,
  logoutResponse,
  MFA_RATE_LIMITED_MESSAGE,
  meResponse,
  mfaEnrollResponse,
  mfaVerifyResponse,
  NO_PENDING_ENROLLMENT_MESSAGE,
  parseCredentials,
  parseEnrollmentBody,
  parseMfaCode,
  SESSION_ABSENT_MESSAGE,
} from './http'
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

describe('réponse de /auth/me', () => {
  const OPERATRICE = {
    id: '01890a5d-ac96-774b-bcce-000000000001',
    email: 'auditrice@example.test',
    displayName: 'Auditrice',
    permissions: ['audit:read'],
    mfaCompleted: true,
  } as const

  it('rend l opérateur courant, hors de tout cache', async () => {
    // Cette réponse porte l'identité et les permissions du moment : gardée par un intermédiaire,
    // elle donnerait à quelqu'un d'autre la vue d'un opérateur.
    const response = meResponse(OPERATRICE)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(OPERATRICE)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('rend un 401 qui ne dit pas pourquoi', async () => {
    // Cookie absent, signature invalide, session révoquée, échue, ou opérateur désactivé : une
    // seule réponse. Le client n'a qu'une conduite à tenir — aller au login.
    const response = meResponse(undefined)

    expect(response.status).toBe(401)
    // Un seul corps, constant : la cause n'atteint même pas cette fonction, qui ne reçoit qu'un
    // `undefined`. Ce que le message ne doit pas faire, c'est nommer l'un des cas.
    expect(await response.json()).toEqual({ error: SESSION_ABSENT_MESSAGE })
    expect(SESSION_ABSENT_MESSAGE).not.toMatch(/révoqu|désactiv|inconnu|signature|verrouill/i)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('réponse de déconnexion', () => {
  it('efface le cookie et ne dit pas s il y avait une session', () => {
    // **Toujours 204, toujours le cookie effacé**, même sans session : répondre différemment
    // indiquerait à l'appelant s'il en détenait une. Et effacer inconditionnellement évite qu'un
    // cookie périmé reste collé au navigateur après une révocation côté serveur.
    const response = logoutResponse()

    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie')).toContain(`${SESSION_COOKIE_NAME}=;`)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(response.headers.get('cache-control')).toBe('no-store')
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

describe("lecture du corps d'enrôlement", () => {
  it('sans champ `code`, démarre un enrôlement', () => {
    // Le corps vide est le cas normal du premier appel : l'opérateur demande un QR code, il n'a rien
    // à présenter encore.
    for (const body of [undefined, null, {}, 'une chaîne', 42]) {
      expect(parseEnrollmentBody(body), JSON.stringify(body) ?? 'undefined').toEqual({
        phase: 'start',
      })
    }
  })

  it('avec un code, passe à la confirmation', () => {
    expect(parseEnrollmentBody({ code: ' 123456 ' })).toEqual({ phase: 'confirm', code: '123456' })
  })

  it('refuse un champ `code` présent mais inexploitable', () => {
    // **Sans retomber sur `start`** : un corps bricolé écraserait alors le secret d'un enrôlement en
    // cours, et l'opérateur qui vient de scanner son QR code se verrait refusé sans comprendre.
    for (const body of [{ code: 42 }, { code: null }, { code: '' }, { code: 'x'.repeat(200) }]) {
      expect(parseEnrollmentBody(body), JSON.stringify(body)).toEqual({ phase: 'invalid' })
    }
  })
})

describe('lecture du code présenté', () => {
  it('accepte un code et le débarrasse de ses espaces', () => {
    expect(parseMfaCode({ code: ' ABCDE-FGHJK ' })).toEqual({ ok: true, code: 'ABCDE-FGHJK' })
  })

  it('refuse tout corps malformé sans distinguer les cas', () => {
    for (const body of [
      undefined,
      null,
      {},
      { code: 42 },
      { code: '' },
      { code: 'x'.repeat(200) },
    ]) {
      expect(parseMfaCode(body), JSON.stringify(body) ?? 'undefined').toEqual({ ok: false })
    }
  })
})

describe("réponse d'enrôlement", () => {
  it("rend le secret et l'URI — la seule fois où ils sortent", async () => {
    const response = mfaEnrollResponse({
      outcome: 'started',
      secret: 'JBSWY3DPEHPK3PXP',
      uri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauth_uri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP',
    })
  })

  it('rend les codes de récupération à la confirmation, et les explique', async () => {
    const response = mfaEnrollResponse({ outcome: 'activated', recoveryCodes: ['ABCDE-FGHJK'] })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      mfa_completed: true,
      recovery_codes: ['ABCDE-FGHJK'],
    })
  })

  it("refuse un réenrôlement en disant à qui s'adresser", async () => {
    const response = mfaEnrollResponse({ outcome: 'already_enrolled' })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: ALREADY_ENROLLED_MESSAGE })
  })

  it('renvoie au démarrage quand il n’y a rien à confirmer', async () => {
    const response = mfaEnrollResponse({ outcome: 'no_pending_enrollment' })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: NO_PENDING_ENROLLMENT_MESSAGE })
  })

  it('refuse un code faux avec le même message que la vérification', async () => {
    const response = mfaEnrollResponse({ outcome: 'invalid_code' })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: INVALID_MFA_CODE_MESSAGE })
  })

  it('annonce le délai quand le compteur a fermé la porte', async () => {
    const response = mfaEnrollResponse({ outcome: 'rate_limited', retryAfterSeconds: 42 })

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('42')
  })
})

describe('réponse de vérification', () => {
  it('annonce le second facteur passé', async () => {
    const response = mfaVerifyResponse({ outcome: 'completed' })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ mfa_completed: true })
  })

  it('dit combien de codes de récupération restent quand l’un a servi', async () => {
    // « Il vous en reste trois » est ce qui pousse à régénérer un lot avant d'arriver à zéro, moment
    // où seule une intervention administrative remet l'opérateur dans la console.
    const response = mfaVerifyResponse({ outcome: 'completed', recovery: { remaining: 3 } })

    expect(await response.json()).toEqual({ mfa_completed: true, recovery_codes_remaining: 3 })
  })

  it('ne distingue pas un code faux d’un code rejoué', async () => {
    // Faux, hors fenêtre, rejoué, déjà consommé, ou aucun facteur actif : le même 401. Distinguer
    // renseignerait sur l'état du compte et sur ce qui a déjà servi.
    const response = mfaVerifyResponse({ outcome: 'invalid_code' })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: INVALID_MFA_CODE_MESSAGE })
  })

  it('annonce le délai quand le compteur a fermé la porte', async () => {
    const response = mfaVerifyResponse({ outcome: 'rate_limited', retryAfterSeconds: 900 })

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('900')
    expect(await response.json()).toEqual({ error: MFA_RATE_LIMITED_MESSAGE })
  })
})
