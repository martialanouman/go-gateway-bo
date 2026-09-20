import { createFileRoute, redirect } from '@tanstack/react-router'
import { peekChallenge, readSession, safeDestination } from '~/lib/session'

/**
 * Le second facteur — hors de la coquille pour la même raison que la connexion : la session existe,
 * mais elle n'ouvre encore rien.
 */
export const Route = createFileRoute('/mfa')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safeDestination(search.redirect),
  }),

  beforeLoad: async ({ context, search }) => {
    const session = await readSession(context.queryClient)

    if (session.kind === 'none') {
      throw redirect({ to: '/login', search: { redirect: search.redirect } })
    }

    if (session.kind === 'open' && session.me.elevated) {
      throw redirect({ to: search.redirect ?? '/' })
    }

    // Sans challenge, `POST /auth/mfa/verify` refuserait chaque envoi : le formulaire serait un
    // cul-de-sac qui ne dit pas pourquoi. Le cas n'est pas théorique — c'est ce que produit un
    // rechargement de cet écran, puisque le challenge ne vit qu'en mémoire.
    if (session.kind === 'open' && peekChallenge() === undefined) {
      throw redirect({ to: '/login', search: { redirect: search.redirect } })
    }
  },

  component: SecondFactorScreen,
})

function SecondFactorScreen() {
  return <h1>Second facteur</h1>
}
