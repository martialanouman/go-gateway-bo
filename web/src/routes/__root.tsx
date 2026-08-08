import { createRootRoute } from '@tanstack/react-router'
import { AdresseInconnue } from '~/components/adresse-inconnue'

/**
 * La racine ne rend plus la coquille : elle laisse passer ses enfants — sans `component`, TanStack
 * rend `<Outlet />` par défaut.
 *
 * C'est `_shell` qui l'enveloppe désormais, une mise en page **sans chemin**. Ce déplacement, fait en
 * step-008, a un objet précis : donner à `/_design` un moyen d'exister *hors* de la coquille, en
 * frère de `_shell` plutôt qu'en enfant. Et il prépare M1, dont la garde de session ira sur `_shell` :
 * ce qui n'est pas un écran du produit n'aura pas à s'en exempter au cas par cas.
 */
export const Route = createRootRoute({ notFoundComponent: AdresseInconnue })
