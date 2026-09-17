// Les assertions sur le DOM (`toBeInTheDocument`, `toBeVisible`…) viennent de jest-dom ; sans cet
// import, elles échouent en « not a function » plutôt qu'en assertion rouge.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// Testing Library n'installe son nettoyage automatique que lorsque les globales de test existent, et
// la configuration les refuse (`globals: false`, pour que chaque fichier déclare ce qu'il utilise).
// Sans cette ligne, chaque rendu s'ajoute au précédent : un `getByText` finit par trouver deux
// éléments, et le test accuse le composant d'un défaut qui appartient au harnais.
afterEach(cleanup)

// jsdom n'implémente pas `scrollTo`, que la restauration de défilement du routeur appelle à chaque
// navigation : sans ce talon, 41 erreurs « Not implemented » noient la sortie où se lisent les vraies.
globalThis.scrollTo = () => {}

// Un appel réseau qu'aucun test n'a déclaré rougit au lieu de partir : jsdom n'a pas de BFF, et un
// `fetch` réel échouerait plus loin, sur un message qui ne nomme pas l'appel.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      throw new Error(`appel réseau non déclaré : ${request.method} ${request.url}`)
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})
