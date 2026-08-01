/**
 * Les deux formes de retour de l'annuaire côté navigateur, et pourquoi elles diffèrent.
 *
 * Une lecture lève avec son statut — c'est tout ce que la charte autorise à peindre. Une écriture
 * rend une issue et ne lève **jamais** : un refus de règle est une réponse, pas une panne, et le
 * premier écran qui l'oublierait resterait figé sur « Enregistrement en cours ».
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AdminRequestError,
  createOperator,
  deleteRole,
  impactQueryOptions,
  operatorsQueryOptions,
  UNREACHABLE_MESSAGE,
  updateOperator,
} from './api'

function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('les lectures', () => {
  it('rendent le corps quand le serveur répond', async () => {
    respondWith({ operators: [], roles: [] })

    await expect(operatorsQueryOptions().queryFn()).resolves.toEqual({ operators: [], roles: [] })
  })

  it('lèvent avec le statut, et sans le texte du serveur', async () => {
    respondWith({ error: 'La valeur « 0700000000 » est refusée.' }, 403)

    const failure = await operatorsQueryOptions()
      .queryFn()
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AdminRequestError)
    expect((failure as AdminRequestError).status).toBe(403)
    // Un message distant cite volontiers ce qu'il refuse : le conserver le ferait entrer dans la
    // première capture d'écran collée dans un ticket (invariant a).
    expect((failure as AdminRequestError).message).not.toContain('0700000000')
  })

  it('rendent le statut 0 quand la requête n’aboutit pas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const failure = await operatorsQueryOptions()
      .queryFn()
      .catch((error: unknown) => error)

    // `ErrorState` distingue 0 des autres : « la passerelle n'a pas répondu » n'est pas un refus.
    expect((failure as AdminRequestError).status).toBe(0)
  })

  it('donnent à l’aperçu une clé de cache qui dépend du paquet demandé', () => {
    const first = impactQueryOptions('role-1', ['audit:read', 'alerts:read'])
    const second = impactQueryOptions('role-1', ['audit:read'])

    // Sans cette dépendance, l'écran annoncerait le coût d'un changement que l'administrateur vient
    // de modifier — c'est-à-dire le mauvais chiffre au moment de décider.
    expect(first.queryKey).not.toEqual(second.queryKey)
  })
})

describe('les écritures', () => {
  it('rendent le message du serveur, verbatim', async () => {
    respondWith(
      { error: 'Changement refusé : plus aucun compte actif ne porterait super_admin.' },
      409,
    )

    const outcome = await updateOperator({ operatorId: 'un-identifiant', status: 'disabled' })

    expect(outcome).toEqual({
      ok: false,
      message: 'Changement refusé : plus aucun compte actif ne porterait super_admin.',
    })
  })

  it('ne prennent pas une panne pour un refus', async () => {
    respondWith({ error: 'Internal Server Error' }, 502)

    const outcome = await deleteRole('un-identifiant')

    // Peindre « action refusée » pendant une panne du BFF fait conclure à un droit manquant, et
    // chercher un contournement qui n'existe pas.
    expect(outcome).toEqual({ ok: false, message: UNREACHABLE_MESSAGE })
  })

  it('ne lèvent jamais, même sans réseau', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    await expect(
      createOperator({ email: 'a@b.test', displayName: 'A', roleIds: [] }),
    ).resolves.toEqual({ ok: false, message: UNREACHABLE_MESSAGE })
  })

  it('rendent le mot de passe initial tel que le serveur l’a tiré', async () => {
    respondWith({ operatorId: 'un-identifiant', temporaryPassword: 'ABCDEFGHJKMN23456789' })

    const outcome = await createOperator({ email: 'a@b.test', displayName: 'A', roleIds: [] })

    expect(outcome).toEqual({
      ok: true,
      data: { operatorId: 'un-identifiant', temporaryPassword: 'ABCDEFGHJKMN23456789' },
    })
  })
})
