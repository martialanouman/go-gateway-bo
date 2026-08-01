import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: HomeScreen })

/**
 * L'état vide de §1.9 : la route existe, l'écran n'est pas encore livré, et la copie nomme le jalon
 * qui l'apportera. Jamais une page blanche, jamais un écran inventé.
 */
function HomeScreen() {
  return (
    <section className="empty">
      <h1 className="empty__title">Le cockpit d'exploitation se construit</h1>
      <p className="empty__body">
        Les écrans arrivent jalon par jalon. Le trafic en direct, les connecteurs et les sessions
        SMPP ouvrent le jalon M4 ; l'authentification et les rôles, le jalon M1.
      </p>
      <p className="empty__body">
        Cette page confirme que le client démarre et qu'il parle au BFF : la sonde de vivacité
        répond sur <code>/api/health</code>.
      </p>
    </section>
  )
}
