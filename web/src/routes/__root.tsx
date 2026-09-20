import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext } from '@tanstack/react-router'
import { UnknownAddress } from '~/components/unknown-address'

/**
 * Ce que les gardes de route reçoivent. Le `QueryClient` y passe parce qu'un `beforeLoad` n'est pas
 * un composant : il s'exécute avant tout rendu, donc hors de portée des hooks. Sans lui, la garde
 * aurait son propre chemin vers le BFF, et la session serait lue deux fois — une pour décider, une
 * pour peindre — avec deux réponses possibles.
 */
export type RouterContext = { readonly queryClient: QueryClient }

/**
 * La racine ne rend pas la coquille : elle laisse passer ses enfants — sans `component`, TanStack
 * rend `<Outlet />` par défaut.
 *
 * C'est `_shell`, une mise en page **sans chemin**, qui l'enveloppe. L'objet est précis : donner à
 * `/_design` un moyen d'exister *hors* de la coquille, en frère de `_shell` plutôt qu'en enfant, et
 * poser la garde de session sur `_shell` — ce qui n'est pas un écran du produit n'a donc pas à s'en
 * exempter au cas par cas.
 */
export const Route = createRootRouteWithContext<RouterContext>()({
  notFoundComponent: UnknownAddress,
})
