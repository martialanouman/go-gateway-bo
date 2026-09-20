import { createFileRoute, redirect } from '@tanstack/react-router'
import { readSession, safeDestination } from '~/lib/session'

/**
 * Le premier facteur — **hors de la coquille** : un opérateur non connecté n'a ni rail ni barre
 * supérieure, puisqu'aucune de leurs entrées ne mènerait ailleurs qu'à un refus.
 *
 * La route est sœur de `_shell` et non son enfant, comme `/_design` : la garde de session vit sur la
 * coquille, donc ce qui doit rester atteignable sans session n'a rien à s'exempter.
 */
export const Route = createFileRoute('/login')({
  // Le paramètre est réduit avant d'atteindre le moindre composant : ce qui en sort est une adresse
  // de ce tableau de bord, ou rien.
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safeDestination(search.redirect),
  }),

  beforeLoad: async ({ context, search }) => {
    const session = await readSession(context.queryClient)

    // Une session déjà élevée n'a rien à faire ici : la laisser sur le formulaire ferait d'un retour
    // en arrière un cul-de-sac. Une session **non élevée**, en revanche, reste servie — se
    // reconnecter est la seule remédiation d'un cookie qu'on croit compromis (`closePresentedSession`,
    // `internal/bff/auth.go`).
    if (session.kind === 'open' && session.me.elevated) {
      throw redirect({ to: search.redirect ?? '/' })
    }
  },

  component: LoginScreen,
})

function LoginScreen() {
  return <h1>Connexion</h1>
}
