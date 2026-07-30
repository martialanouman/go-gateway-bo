// @vitest-environment node

/**
 * La décision d'autorisation, isolée de la base.
 *
 * `authorize` est **totale** : elle tranche les trois états de session et les deux issues, sans
 * jamais interroger quoi que ce soit. C'est ce qui permet de couvrir ici chaque chemin de refus —
 * et les chemins de refus sont précisément ce que l'invariant (c) exige de garder vert.
 */

import { describe, expect, it } from 'vitest'
import type { SessionState } from '../auth/session'
import { AUTHZ_CODES, authorize } from './permission'

const OPERATOR_ID = '018f4c1e-0000-7000-8000-000000000001'
const SESSION_ID = '018f4c1e-0000-7000-8000-000000000002'

const active: SessionState = { status: 'active', operatorId: OPERATOR_ID, sessionId: SESSION_ID }
const pending: SessionState = {
  status: 'pending_mfa',
  operatorId: OPERATOR_ID,
  sessionId: SESSION_ID,
}
const absent: SessionState = { status: 'none' }

describe('authorize', () => {
  it('accorde à une session complète qui détient la clé', () => {
    const decision = authorize(active, ['customers:read', 'customers:write'], 'customers:write')

    expect(decision).toEqual({ granted: true, operatorId: OPERATOR_ID, sessionId: SESSION_ID })
  })

  it('refuse une session complète qui ne détient pas la clé', () => {
    const decision = authorize(active, ['customers:read'], 'customers:write')

    expect(decision.granted).toBe(false)
    expect(decision.granted === false && decision.refusal.code).toBe(AUTHZ_CODES.denied)
  })

  it('nomme la permission manquante — un refus muet pousse à chercher un contournement', () => {
    const decision = authorize(active, [], 'credentials:rotate')

    expect(decision.granted === false && decision.refusal.message).toContain('credentials:rotate')
  })

  it('refuse quand il n’y a pas de session', () => {
    const decision = authorize(absent, [], 'customers:read')

    expect(decision.granted === false && decision.refusal.code).toBe(AUTHZ_CODES.sessionAbsent)
  })

  it('porte toujours `errors[]`, même vide — une seule forme d’erreur dans tout le produit (§1.4)', () => {
    for (const decision of [
      authorize(absent, [], 'customers:read'),
      authorize(pending, [], 'customers:read'),
      authorize(active, [], 'customers:read'),
    ]) {
      expect(decision.granted === false && decision.refusal.errors).toEqual([])
    }
  })
})

/**
 * Le second facteur, en tant que condition d'autorisation.
 *
 * La step-025 demande qu'une session sans MFA passée n'atteigne « aucune permission d'écriture ni
 * `content:read` / `gdpr:erase` ». La règle implémentée est **plus stricte** : elle n'atteint aucune
 * permission, quelle qu'elle soit. Les cas de la step sont donc vérifiés comme un sous-ensemble —
 * s'ils venaient à passer, c'est que la règle générale aurait été affaiblie.
 */
describe('MFA obligatoire', () => {
  it('refuse une session partielle, même quand l’opérateur détient la clé', () => {
    const decision = authorize(pending, ['customers:write'], 'customers:write')

    expect(decision.granted).toBe(false)
    expect(decision.granted === false && decision.refusal.code).toBe(AUTHZ_CODES.mfaRequired)
  })

  it('refuse une session partielle sur les clés que la step nomme', () => {
    const keys = ['customers:write', 'content:read', 'gdpr:erase'] as const

    for (const key of keys) {
      // L'opérateur détient la clé : c'est bien le second facteur, et lui seul, qui refuse.
      const decision = authorize(pending, [key], key)
      expect(decision.granted === false && decision.refusal.code).toBe(AUTHZ_CODES.mfaRequired)
    }
  })

  it('refuse une session partielle jusque sur une simple lecture — la règle est générale', () => {
    const decision = authorize(pending, ['audit:read'], 'audit:read')

    expect(decision.granted === false && decision.refusal.code).toBe(AUTHZ_CODES.mfaRequired)
  })

  it('distingue le second facteur manquant de la permission manquante', () => {
    // Deux conduites à tenir différentes : franchir son facteur, ou demander un rôle. Les
    // confondre enverrait l'opérateur au mauvais endroit.
    expect(AUTHZ_CODES.mfaRequired).not.toBe(AUTHZ_CODES.denied)
  })
})
