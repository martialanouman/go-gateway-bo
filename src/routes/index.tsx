import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

/**
 * Page d'accueil provisoire. Elle disparaît en step-040, quand l'AppShell prend la racine et que
 * chaque route déclarée rend son état explicite (§1.9 du plan d'exécution).
 */
function Home() {
  return (
    <main>
      <h1>Tableau de bord — Passerelle SMS</h1>
      <p>Fondations posées. Les écrans arrivent à partir du jalon M2.</p>
    </main>
  )
}
