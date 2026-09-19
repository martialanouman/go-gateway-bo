import { createRootRoute } from '@tanstack/react-router'
import { UnknownAddress } from '~/components/unknown-address'

/**
 * La racine ne rend pas la coquille : elle laisse passer ses enfants — sans `component`, TanStack
 * rend `<Outlet />` par défaut.
 *
 * C'est `_shell`, une mise en page **sans chemin**, qui l'enveloppe. L'objet est précis : donner à
 * `/_design` un moyen d'exister *hors* de la coquille, en frère de `_shell` plutôt qu'en enfant, et
 * poser la garde de session sur `_shell` — ce qui n'est pas un écran du produit n'a donc pas à s'en
 * exempter au cas par cas.
 */
export const Route = createRootRoute({ notFoundComponent: UnknownAddress })
