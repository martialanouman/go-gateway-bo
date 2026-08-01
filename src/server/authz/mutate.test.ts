// @vitest-environment node

/**
 * Le **câblage** de `mutate` : quel querier reçoit l'écriture d'audit, et ce qui compose l'entrée.
 *
 * ## Pourquoi ce fichier existe, alors qu'un test contre PostgreSQL existe déjà
 *
 * Parce que le test de base ne peut pas voir ce qui compte ici, et qu'il prétendait le contraire.
 * `authz.db.test.ts` observe qu'un payload interdit annule la mutation — un `ROLLBACK` réel, et
 * c'est un bon test. Mais il **passerait à l'identique si `recordAudit` recevait le pool** au lieu de
 * la transaction : `checkAuditPayload` lance avant toute insertion, l'exception s'échappe du
 * callback, la transaction est annulée, et `audit_log` est vide dans les deux cas. Vérifié en
 * mutant : les onze tests restaient verts.
 *
 * Le seul cas discriminant serait « l'audit inséré, puis la transaction annulée » — coûteux à mettre
 * en scène contre une vraie base, et fragile. L'identité du querier, elle, se lit directement.
 *
 * ## Pourquoi des doublures ici, alors que le dépôt s'en méfie
 *
 * `webauthn-authenticator.ts` explique pourquoi on ne double pas une vérification de signature :
 * remplacer la sécurité par une fonction qui rend `true` teste le câblage et appelle cela de la
 * sécurité. Ici, le câblage **est** l'objet du test — et le comportement, lui, est éprouvé contre
 * une vraie base à côté. Les deux fichiers se complètent au lieu de se remplacer.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database, Transaction } from '../db/index'

const { recordAuditSpy, requirePermissionSpy } = vi.hoisted(() => ({
  recordAuditSpy: vi.fn(),
  requirePermissionSpy: vi.fn(),
}))

// Les deux vérifications restent **les vraies** : ce fichier ne double que ce qu'il observe. Les
// neutraliser laisserait passer un `action` mal formé sans que rien ne le dise, et ce test
// deviendrait le seul endroit du dépôt où la garde n'existe pas.
vi.mock('./audit', async () => ({
  ...(await vi.importActual<typeof import('./audit')>('./audit')),
  recordAudit: recordAuditSpy,
}))
// Même motif que pour `./audit` : remplacement partiel. Un remplacement total casserait ce fichier
// avec un `undefined is not a function` opaque le jour où `mutate.ts` importerait `authorize` ou
// `AUTHZ_CODES` de ce module — dans un test qui ne parle pas de permissions.
vi.mock('./permission', async () => ({
  ...(await vi.importActual<typeof import('./permission')>('./permission')),
  requirePermission: requirePermissionSpy,
}))

const { mutate } = await import('./mutate')

const OPERATOR_ID = 'operateur-decide-par-la-garde'

/** Une transaction reconnaissable : ce test ne vérifie que son identité. */
const TRANSACTION = { marker: 'la-transaction' } as unknown as Transaction

function databaseHandingOut(tx: Transaction) {
  const transaction = vi.fn(async (run: (value: Transaction) => Promise<unknown>) => run(tx))
  return { transaction } as unknown as Database & { transaction: typeof transaction }
}

function granted() {
  requirePermissionSpy.mockResolvedValue({
    granted: true,
    operatorId: OPERATOR_ID,
    sessionId: 'session',
  })
}

const REQUEST = {
  session: { status: 'active', operatorId: OPERATOR_ID, sessionId: 'session' },
  permission: 'operators:manage',
  action: 'operator.rename',
} as const

beforeEach(() => {
  vi.clearAllMocks()
})

describe('câblage de la transaction', () => {
  it('écrit l’audit sur le querier reçu par le bloc, pas sur le pool', async () => {
    granted()
    const db = databaseHandingOut(TRANSACTION)

    let handedToRun: unknown
    await mutate(db, REQUEST, async (tx) => {
      handedToRun = tx
      return { result: 'peu importe' }
    })

    // **L'assertion qui porte tout le fichier.** Le bloc et l'audit doivent recevoir le *même*
    // objet : c'est ce qui fait qu'ils valident ou échouent ensemble.
    expect(handedToRun).toBe(TRANSACTION)
    expect(recordAuditSpy).toHaveBeenCalledTimes(1)
    expect(recordAuditSpy.mock.calls[0]?.[0]).toBe(TRANSACTION)
  })

  it('passe au bloc l’opérateur que la garde a reconnu, pas celui que la requête annonce', async () => {
    granted()
    const db = databaseHandingOut(TRANSACTION)

    let actor: unknown
    await mutate(
      // Une session qui prétend être quelqu'un d'autre : c'est la décision de `requirePermission`
      // qui fait autorité, jamais le corps de la session reçue.
      db,
      { ...REQUEST, session: { ...REQUEST.session, operatorId: 'quelqu’un-d’autre' } },
      async (_tx, received) => {
        actor = received
        return { result: 'peu importe' }
      },
    )

    // La garde d'auto-verrouillage de l'annuaire (step-027) compare les permissions **de cet
    // identifiant** avant et après : le prendre ailleurs la ferait porter sur le mauvais compte.
    expect(actor).toEqual({ operatorId: OPERATOR_ID, sessionId: 'session' })
  })

  it('n’ouvre aucune transaction quand la permission est refusée', async () => {
    requirePermissionSpy.mockResolvedValue({
      granted: false,
      refusal: { code: 'permission_denied', message: 'refusé', errors: [] },
    })
    const db = databaseHandingOut(TRANSACTION)

    const outcome = await mutate(db, REQUEST, async () => ({ result: 'jamais atteint' }))

    expect(outcome.granted).toBe(false)
    // Un refus ne doit coûter ni verrou ni connexion : c'est ce qui l'empêche de devenir un moyen
    // de charger la base sans être autorisé.
    expect(db.transaction).not.toHaveBeenCalled()
    expect(recordAuditSpy).not.toHaveBeenCalled()
  })
})

describe('composition de l’entrée d’audit', () => {
  it('prend l’opérateur de la décision, jamais de la requête', async () => {
    granted()

    await mutate(
      databaseHandingOut(TRANSACTION),
      // La session prétend être quelqu'un d'autre : c'est la garde qui fait foi, pas l'appelant.
      { ...REQUEST, session: { status: 'active', operatorId: 'usurpateur', sessionId: 's' } },
      async () => ({ result: null }),
    )

    expect(recordAuditSpy.mock.calls[0]?.[1]).toMatchObject({ operatorId: OPERATOR_ID })
  })

  it('laisse le bloc primer sur la requête pour la cible', async () => {
    granted()

    await mutate(
      databaseHandingOut(TRANSACTION),
      { ...REQUEST, targetId: 'ce-que-l-appelant-croyait' },
      // Une création ne connaît son identifiant qu'ici : c'est le seul ordre de précédence correct.
      async () => ({ result: null, targetId: 'ce-que-le-bloc-a-appris' }),
    )

    expect(recordAuditSpy.mock.calls[0]?.[1]).toMatchObject({
      targetId: 'ce-que-le-bloc-a-appris',
    })
  })

  it('retombe sur la cible de la requête quand le bloc n’en nomme pas', async () => {
    granted()

    await mutate(
      databaseHandingOut(TRANSACTION),
      { ...REQUEST, targetId: 'connue-d-avance' },
      async () => ({ result: null }),
    )

    expect(recordAuditSpy.mock.calls[0]?.[1]).toMatchObject({ targetId: 'connue-d-avance' })
  })
})

/**
 * L'ordre : vérifier avant d'ouvrir la transaction.
 *
 * `mutate` documente longuement pourquoi `checkAuditSubject` et `before` sont vérifiés **avant**
 * `db.transaction` — un refus purement local ne doit pas survenir après un appel distant réussi,
 * sinon la passerelle a muté et il ne reste aucune trace. Cette propriété n'était tenue par rien :
 * la déplacer à l'intérieur du bloc produit exactement les mêmes observables en base, puisque le
 * `ROLLBACK` annule tout de la même façon.
 */
describe('ordre de vérification', () => {
  it('refuse une action mal formée sans ouvrir de transaction', async () => {
    granted()
    const db = databaseHandingOut(TRANSACTION)

    await expect(
      mutate(db, { ...REQUEST, action: 'Pas Un Verbe' }, async () => ({ result: null })),
    ).rejects.toThrow(/forme attendue/)

    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('refuse un `before` interdit sans ouvrir de transaction', async () => {
    granted()
    const db = databaseHandingOut(TRANSACTION)

    await expect(
      mutate(db, { ...REQUEST, before: { api_key: 'sk-live-42' } }, async () => ({ result: null })),
    ).rejects.toThrow(/nom réservé/)

    expect(db.transaction).not.toHaveBeenCalled()
  })
})

describe('la garde reçoit ce que l’appelant a demandé', () => {
  it('transmet la session et la clé exigée', async () => {
    granted()

    await mutate(databaseHandingOut(TRANSACTION), REQUEST, async () => ({ result: null }))

    // Sans cette assertion, coder la clé en dur dans `mutate` ne rougirait nulle part.
    expect(requirePermissionSpy).toHaveBeenCalledWith(
      expect.anything(),
      REQUEST.session,
      'operators:manage',
    )
  })
})
