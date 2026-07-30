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
import type { Querier } from '../db/index'
import { auditIpAddress, checkAuditPayload, checkAuditSubject, recordAudit } from './audit'

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

/**
 * L'inventaire réel du produit, et non la liste de l'implémentation.
 *
 * Un test qui reprend les fragments de `FORBIDDEN_FRAGMENTS` vérifie que le code fait ce qu'il fait.
 * Celui-ci part des noms de colonnes de `src/server/db/schema/`, des champs du contrat de l'API
 * Admin, et de ce que les steps à venir journaliseront — la régénération des codes de récupération
 * (step-027) a exactement un `after_json` pour lieu naturel de fuite.
 */
describe('inventaire des secrets du produit', () => {
  const REAL_SECRET_FIELDS = [
    // src/server/db/schema/auth.ts
    'mfa_totp_secret',
    'password_hash',
    'code_hash',
    'mfa_webauthn_credentials',
    // src/server/db/schema/session.ts
    'webauthn_challenge',
    // step-027 : régénérer les codes de récupération
    'recovery_codes',
    'recoveryCodes',
    // contrat de l'API Admin (§6.14, §6.15) : identifiants de bind, webhooks, fournisseurs
    'password',
    'secret',
    'api_key',
    'webhook_secret',
    'bind_password',
    'provider_api_key',
  ] as const

  for (const field of REAL_SECRET_FIELDS) {
    it(`refuse « ${field} »`, () => {
      expect(() => checkAuditPayload('after', { [field]: 'peu importe' })).toThrow(/nom réservé/)
    })
  }

  it('laisse passer les champs de contrôle voisins qu’il ne faut pas bloquer', () => {
    // Le pendant indispensable : une liste trop large se fait désarmer à la première gêne.
    // `permission_key` contient « key », `message_id` contient « message » — deux raisons de ne pas
    // avoir ajouté ces fragments-là.
    expect(() =>
      checkAuditPayload('after', {
        permission_key: 'routes:write',
        message_id: '018f4c1e',
        max_sessions: 4,
        balance_scope: 'shared',
      }),
    ).not.toThrow()
  })
})

describe('valeurs du payload', () => {
  it('refuse une entité sérialisée — le contournement le plus probable', () => {
    // `AuditValue` inclut `string` : ni le typage ni la liste de noms n'arrêtent un `JSON.stringify`.
    // Personne n'écrit `{ text: … }` volontairement ; tout le monde écrit ceci pour aller vite.
    const entity = JSON.stringify({ id: 'x', text: 'RDV demain 14h', api_key: 'sk-live-42' })

    expect(() => checkAuditPayload('after', { snapshot: entity })).toThrow(/sérialisée/)
  })

  it('refuse un tableau sérialisé', () => {
    expect(() => checkAuditPayload('after', { items: '["a","b"]' })).toThrow(/sérialisée/)
  })

  it('ne recopie pas l’entité refusée dans le message d’erreur', () => {
    const entity = JSON.stringify({ text: 'RDV demain 14h chez le docteur' })

    expect(() => checkAuditPayload('after', { snapshot: entity })).not.toThrow(/RDV demain/)
  })

  it('borne la longueur d’une valeur', () => {
    expect(() => checkAuditPayload('after', { name: 'x'.repeat(513) })).toThrow(/512/)
  })

  it('nomme le côté fautif, `before` ou `after`', () => {
    // Sans cette vérification, coder `where` en dur laisserait le message envoyer chercher le
    // défaut dans le mauvais payload.
    expect(() => checkAuditPayload('before', { secret: 'x' })).toThrow(/before_json/)
    expect(() => checkAuditPayload('after', { secret: 'x' })).toThrow(/after_json/)
  })
})

describe('checkAuditSubject', () => {
  it('accepte un verbe de la forme documentée', () => {
    expect(() =>
      checkAuditSubject({ action: 'route.update', targetType: 'route', targetId: '018f4c1e-00' }),
    ).not.toThrow()
  })

  it('refuse un verbe qui ne se grep pas', () => {
    for (const action of ['Route Update', 'update', 'route..update', '']) {
      expect(() => checkAuditSubject({ action })).toThrow(/forme attendue/)
    }
  })

  it('refuse un corps de message glissé dans `target_id`', () => {
    // Le trou que le reste du module laissait ouvert : `target_id` est un `text` libre, inséré brut,
    // et c'est le champ qu'un appelant remplit avec une valeur venue de la requête.
    expect(() =>
      checkAuditSubject({ action: 'content.read', targetId: 'RDV demain 14h chez le docteur' }),
    ).toThrow(/identifiant/)
  })

  it('ne recopie pas la cible refusée dans le message d’erreur', () => {
    const body = 'RDV demain 14h chez le docteur'

    expect(() => checkAuditSubject({ action: 'content.read', targetId: body })).not.toThrow(
      new RegExp(body),
    )
  })

  it('laisse passer les identifiants réels du produit', () => {
    for (const targetId of [
      '018f4c1e-0000-7000-8000-000000000001',
      '+2250700000000',
      'acme-corp',
      'route_42',
    ]) {
      expect(() => checkAuditSubject({ action: 'customer.update', targetId })).not.toThrow()
    }
  })
})

describe('auditIpAddress', () => {
  it('rend l’adresse telle quelle', () => {
    expect(auditIpAddress('203.0.113.7')).toBe('203.0.113.7')
  })

  it('accepte une adresse IPv6', () => {
    expect(auditIpAddress('2001:db8::1')).toBe('2001:db8::1')
  })

  it('rend `null` pour tout ce qui n’est pas une adresse', () => {
    // **Pas seulement le littéral `unknown`.** Dès que `AUTH_TRUSTED_PROXIES` vaut au moins 1,
    // `readClientIp` rend un maillon de `x-forwarded-for` — un en-tête fourni par l'appelant. Le
    // laisser passer ferait échouer l'insertion en `22P02`, donc la transaction, donc la mutation :
    // un en-tête forgé deviendrait un interrupteur d'arrêt sur les écritures d'autrui.
    for (const forged of ['pas-une-ip', '999.999.999.999', '10.0.0.1; DROP', '<script>']) {
      expect(auditIpAddress(forged)).toBeNull()
    }
  })

  it('rend `null` pour une adresse indéterminée', () => {
    // `ip_address` est de type `inet` : y écrire le littéral « unknown » ferait échouer l'insertion,
    // donc la mutation. Une adresse qu'on n'a pas su déterminer s'écrit « absente », pas « unknown ».
    expect(auditIpAddress(UNKNOWN_CLIENT_IP)).toBeNull()
    expect(auditIpAddress(undefined)).toBeNull()
    expect(auditIpAddress('   ')).toBeNull()
  })
})

/**
 * `recordAudit` revérifie pour son propre compte.
 *
 * `mutate` vérifie déjà avant d'ouvrir sa transaction, si bien que retirer la vérification d'ici
 * laissait toute la suite verte. Mais `recordAudit` est publique et sera appelée directement pour
 * les actions qui ne mutent rien — une lecture de corps (`content.read`) en est une, et c'est
 * précisément celle dont la cible risque le plus de porter un corps de message.
 */
describe('recordAudit vérifie sans dépendre de son appelant', () => {
  /** Un querier qui échouerait bruyamment si l'insertion était atteinte. */
  const refusingQuerier = {
    insert: () => {
      throw new Error("L'insertion ne doit pas être atteinte : la vérification a laissé passer.")
    },
  } as unknown as Querier

  it('refuse une action mal formée avant d’insérer', async () => {
    await expect(
      recordAudit(refusingQuerier, { operatorId: null, action: 'Pas Un Verbe' }),
    ).rejects.toThrow(/forme attendue/)
  })

  it('refuse un corps glissé dans `target_id` avant d’insérer', async () => {
    await expect(
      recordAudit(refusingQuerier, {
        operatorId: null,
        action: 'content.read',
        targetId: 'RDV demain 14h chez le docteur',
      }),
    ).rejects.toThrow(/identifiant/)
  })

  it('refuse un secret dans `before` avant d’insérer', async () => {
    await expect(
      recordAudit(refusingQuerier, {
        operatorId: null,
        action: 'operator.rename',
        before: { api_key: 'sk-live-42' },
      }),
    ).rejects.toThrow(/nom réservé/)
  })
})
