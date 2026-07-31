/**
 * Le rendu d'un **écran** de test — c'est-à-dire d'une route réelle du produit.
 *
 * Séparé de `renderComponent` parce que l'objet testé n'est pas le même : ici, on monte l'arbre de
 * routes généré, à une URL donnée, avec le client Query. C'est ce qui permet de vérifier qu'une
 * route existe vraiment, que son composant se monte, et que la navigation fonctionne — trois choses
 * qu'un composant monté nu ne dit pas.
 *
 * L'arbre vient de `routeTree.gen.ts`, donc du fichier commité. Un test ne verra jamais qu'une
 * route a été ajoutée sans régénérer l'arbre : c'est la porte `build` de la CI qui l'attrape, en
 * refusant un diff sur ce fichier.
 */

import type { QueryClient } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { routeTree } from '~/routeTree.gen'
import { type RenderResult, renderComponent } from './render'

/**
 * Monte le produit à l'URL demandée.
 *
 * **Asynchrone**, et ce n'est pas un détail : `RouterProvider` ne rend le composant d'une route
 * qu'après avoir résolu cette route. Un helper synchrone obligerait chaque test à commencer par un
 * `findBy…` — c'est-à-dire à connaître ce détail — alors que c'est précisément ce qu'un helper doit
 * absorber. `router.load()` attend la résolution ; le test peut ensuite interroger le DOM avec
 * `getBy…` comme sur n'importe quel rendu.
 *
 * Les contextes viennent de `renderComponent` plutôt que d'être remontés ici : un seul endroit
 * décide ce qui enveloppe un composant du produit.
 */
export async function renderRoute(
  path: string,
  options: { queryClient?: QueryClient } = {},
): Promise<RenderResult> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  await router.load()

  // Le client est **transmis** plutôt que recréé : depuis la step-040, les écrans vivent sous une
  // coquille dont le rail se peint à partir de `/auth/me`. Un test qui ne peut pas amorcer ce cache
  // ne peut vérifier ni la navigation par permission, ni ce qu'un opérateur donné voit.
  return renderComponent(<RouterProvider router={router} />, options)
}
