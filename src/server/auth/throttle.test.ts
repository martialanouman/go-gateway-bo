// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { readThrottleSecret, subjectKey } from './throttle'

const SECRET = 'un-secret-de-throttle-de-test-assez-long'

describe('clé de throttle', () => {
  it('exige une clé et refuse d’en inventer une', () => {
    // Une valeur de repli codée en dur serait publique, et le HMAC redeviendrait un condensat nu :
    // c'est-à-dire la liste des identifiants tentés, cassable par dictionnaire en quelques secondes.
    expect(() => readThrottleSecret({})).toThrow(/AUTH_THROTTLE_SECRET/)
  })

  it('refuse une clé trop courte pour valoir quelque chose', () => {
    expect(() => readThrottleSecret({ AUTH_THROTTLE_SECRET: 'court' })).toThrow(/32/)
  })

  it('accepte une clé suffisante', () => {
    expect(readThrottleSecret({ AUTH_THROTTLE_SECRET: SECRET })).toBe(SECRET)
  })
})

describe('clé de sujet', () => {
  it('rend une adresse IP telle quelle', () => {
    // L'exploitant doit pouvoir lire quelles adresses sont bloquées, et `audit_log.ip_address`
    // conserve déjà la même donnée.
    expect(subjectKey('ip', '203.0.113.7', SECRET)).toBe('203.0.113.7')
  })

  it('ne laisse jamais un identifiant apparaître en clair', () => {
    const identifiant = 'operateur@example.test'

    expect(subjectKey('operator', identifiant, SECRET)).not.toContain(identifiant)
    expect(subjectKey('operator', identifiant, SECRET)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('normalise casse et espaces comme l’unicité des opérateurs', () => {
    expect(subjectKey('operator', '  Operateur@Example.test ', SECRET)).toBe(
      subjectKey('operator', 'operateur@example.test', SECRET),
    )
  })

  it('dépend de la clé, ce qu’un condensat nu ne ferait pas', () => {
    expect(subjectKey('operator', 'a@b.test', SECRET)).not.toBe(
      subjectKey('operator', 'a@b.test', `${SECRET}-autre`),
    )
  })
})
