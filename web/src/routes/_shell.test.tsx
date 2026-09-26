import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetChallenge, rememberChallenge } from '~/lib/session'
import { createAppRouter } from '~/router'
import { CHALLENGE, type SessionOutcome, stubSession } from '../../test/session'

// Le challenge vit dans un module, donc il survit à un test : sans ce nettoyage, l'ordre des tests
// déciderait de leur résultat.
beforeEach(forgetChallenge)
afterEach(forgetChallenge)

/**
 * La garde de session, exercée **par une visite d'URL** et jamais en appelant son `beforeLoad` à la
 * main : c'est le défaut de la v1.0 que ces tests existent pour voir — trois tests la déclaraient
 * verte pendant qu'elle ne s'exécutait jamais sur une adresse collée. Un appel direct le
 * reproduirait à l'identique.
 *
 * Ce qu'ils ne peuvent pas voir : le chargement **à froid** du binaire sur cette même adresse, où le
 * document est servi avant que le routeur n'existe. C'est le parcours de bout en bout qui le tient.
 */
async function visit(path: string, outcome: SessionOutcome) {
  stubSession(outcome)
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))

  render(<RouterProvider router={router} />)
  await screen.findByRole('heading', { level: 1 })

  return router
}

describe('the shell session guard', () => {
  it('redirects a deep link opened without a session to sign-in, and keeps the destination', async () => {
    const router = await visit('/billing', { status: 401 })

    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toEqual({ redirect: '/billing' })
  })

  it('redirects a session that has not passed the second factor to it', async () => {
    // Le challenge est ce qu'un opérateur a en main à ce moment-là : il vient de franchir le premier
    // facteur, et tape une adresse profonde avant de présenter son code.
    rememberChallenge(CHALLENGE)

    const router = await visit('/billing', { permissions: [], elevated: false })

    // Et non à la connexion : le mot de passe vient d'être présenté, le redemander serait la boucle
    // que la v1.0 a livrée.
    expect(router.state.location.pathname).toBe('/mfa')
    expect(router.state.location.search).toEqual({ redirect: '/billing' })
  })

  it('redirects a non-elevated session whose challenge is lost to sign-in', async () => {
    // Sans challenge, le formulaire du second facteur essuierait un refus à chaque envoi. C'est ce
    // que produit un rechargement : reprendre la connexion est la seule issue, et elle ne se
    // découvre pas sur un refus.
    const router = await visit('/billing', { permissions: [], elevated: false })

    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toEqual({ redirect: '/billing' })
  })

  it('opens the requested screen when the session is elevated', async () => {
    const router = await visit('/billing', { permissions: [] })

    expect(router.state.location.pathname).toBe('/billing')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Soldes & crédits')
  })

  it('redirects nowhere when the BFF is down: the failure degrades, it does not sign out', async () => {
    // Un 500 lu comme « aucune session » enverrait l'opérateur se reconnecter pendant que son
    // cookie est intact, et la connexion échouerait sur la même panne. Invariant (e).
    const router = await visit('/billing', { status: 500 })

    expect(router.state.location.pathname).toBe('/billing')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Impossible de vérifier la session',
    )
  })
})

describe('« Réessayer » after a session failure', () => {
  it('replays the guard, and does not paint the shell for a non-elevated session', async () => {
    // La garde a laissé passer parce que le BFF ne répondait pas — une panne dégrade, elle ne
    // déconnecte pas. Quand il répond de nouveau, la session s'avère **non élevée** : relire la
    // seule requête peindrait le rail et la barre, et chaque appel gardé rendrait alors 403. C'est
    // mot pour mot le « cockpit qui paraît ouvert et ne répond à rien » que la garde refuse.
    rememberChallenge(CHALLENGE)
    let enPanne = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const { pathname } = new URL(request.url)
        if (pathname !== '/api/auth/me') throw new Error(`appel non déclaré : ${pathname}`)
        if (enPanne) {
          return Response.json({ code: 'test', message: 'Panne.' }, { status: 503 })
        }

        return Response.json({
          operator: {
            id: '01960000-0000-7000-8000-000000000001',
            email: 'a@b.test',
            displayName: 'Awa',
          },
          permissions: [],
          elevated: false,
          secondFactors: { totp: true, recoveryCodesRemaining: 10, passkeys: 0 },
          absoluteExpiresAt: '2026-09-17T20:00:00Z',
        })
      }),
    )

    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/billing'] }))
    render(<RouterProvider router={router} />)

    const alerte = await screen.findByRole('alert')
    expect(alerte).toHaveTextContent('GET /api/auth/me · 503')

    enPanne = false
    await userEvent.setup().click(within(alerte).getByRole('button', { name: 'Réessayer' }))

    await screen.findByRole('heading', { level: 1, name: /Second facteur/ })
    expect(router.state.location.pathname).toBe('/mfa')
    expect(screen.queryByRole('navigation', { name: 'Navigation principale' })).toBeNull()
  })
})
