import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

/**
 * Point d'entrée du routeur, appelé par TanStack Start au rendu serveur comme au démarrage client.
 * Le nom `getRouter` est imposé par le plugin Vite : il l'importe pour typer le registre.
 */
export function getRouter() {
  return createRouter({
    routeTree,
    // L'outil est dense et desktop-first : précharger au survol évite l'attente perçue en
    // navigation, sans coût mesurable sur un réseau interne.
    defaultPreload: 'intent',
    scrollRestoration: true,
  })
}
