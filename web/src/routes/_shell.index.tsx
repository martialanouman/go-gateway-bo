import { createFileRoute } from '@tanstack/react-router'
import { EmptyState } from '~/components/ui'

export const Route = createFileRoute('/_shell/')({ component: HomeScreen })

/**
 * L'état vide de §1.9 : la route existe, l'écran n'est pas encore livré, et la copie nomme le jalon
 * qui l'apportera. Jamais une page blanche, jamais un écran inventé.
 *
 * `titleAs="h1"` parce que cet état **est** l'écran : il en porte le titre. Le défaut du composant
 * est `p`, qui convient à un état vide posé dans une carte au milieu d'un écran déjà titré.
 */
function HomeScreen() {
  return (
    <EmptyState
      description={
        <>
          <p>
            Les écrans arrivent jalon par jalon. Le trafic en direct, les connecteurs et les
            sessions SMPP ouvrent le jalon M4 ; l'authentification et les rôles, le jalon M1.
          </p>
          <p>
            Chaque écran arrive avec sa route, son état vide et le jalon qui le porte : aucun lien
            ne mène nulle part.
          </p>
        </>
      }
      title="Le cockpit d'exploitation se construit"
      titleAs="h1"
    />
  )
}
