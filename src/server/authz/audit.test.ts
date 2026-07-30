// @vitest-environment node

/**
 * Ce qu'un `before_json` / `after_json` a le droit de porter.
 *
 * Les invariants (a) et (b) se jouent ici : le journal d'audit est le seul endroit du BFF où l'on
 * écrit délibérément un morceau d'entité muté, et c'est donc le premier endroit où un corps de
 * message ou un secret finirait par se retrouver — durablement, dans une table faite pour être
 * relue.
 */

import { describe, expect, it } from 'vitest'
import { UNKNOWN_CLIENT_IP } from '../auth/client-ip'
import { auditIpAddress, checkAuditPayload } from './audit'

describe('checkAuditPayload', () => {
  it('laisse passer un diff d’entité de contrôle', () => {
    expect(() =>
      checkAuditPayload('after', { name: 'Acme', status: 'suspended', max_sessions: 4 }),
    ).not.toThrow()
  })

  it('laisse passer l’absence de payload — toute action n’a pas d’avant/après', () => {
    expect(() => checkAuditPayload('before', undefined)).not.toThrow()
  })

  it('refuse une clé qui nomme un corps de message (invariant a)', () => {
    for (const key of ['body', 'content', 'text', 'message_body', 'smsText']) {
      expect(() => checkAuditPayload('after', { [key]: 'peu importe' })).toThrow()
    }
  })

  it('refuse une clé qui nomme un secret (invariant b)', () => {
    for (const key of [
      'password',
      'passwordHash',
      'secret',
      'webhook_secret',
      'api_key',
      'token',
    ]) {
      expect(() => checkAuditPayload('after', { [key]: 'peu importe' })).toThrow()
    }
  })

  it('ne recopie jamais la valeur refusée dans le message d’erreur', () => {
    // Le point le plus facile à manquer : une erreur qui cite ce qu'elle refuse **publie** ce
    // qu'elle refuse, dans le premier log qui l'inspecte. Elle ne doit nommer que la clé.
    const body = 'RDV demain 14h chez le docteur'

    expect(() => checkAuditPayload('after', { body })).toThrow(/body/)
    expect(() => checkAuditPayload('after', { body })).not.toThrow(new RegExp(body))
  })

  it('refuse bruyamment plutôt que de filtrer en silence', () => {
    // Retirer la clé et poursuivre laisserait la mutation aboutir avec un audit amputé — un succès
    // silencieux, exactement ce que la step interdit. L'écriture doit échouer, donc l'action aussi.
    expect(() => checkAuditPayload('after', { secret: 'x', name: 'Acme' })).toThrow()
  })
})

describe('auditIpAddress', () => {
  it('rend l’adresse telle quelle', () => {
    expect(auditIpAddress('203.0.113.7')).toBe('203.0.113.7')
  })

  it('rend `null` pour une adresse indéterminée', () => {
    // `ip_address` est de type `inet` : y écrire le littéral « unknown » ferait échouer l'insertion,
    // donc la mutation. Une adresse qu'on n'a pas su déterminer s'écrit « absente », pas « unknown ».
    expect(auditIpAddress(UNKNOWN_CLIENT_IP)).toBeNull()
    expect(auditIpAddress(undefined)).toBeNull()
    expect(auditIpAddress('   ')).toBeNull()
  })
})
