/**
 * Poser le focus sur le titre d'un écran qui vient de remplacer le précédent.
 *
 * ## Pourquoi seulement ici
 *
 * Sous la coquille, une navigation remplace le contenu mais laisse la barre, le rail et le lien
 * d'évitement en place : le focus survit, et un lecteur d'écran garde ses repères. Les écrans
 * d'authentification sont le seul endroit du produit où **l'arbre entier** est remplacé — login vers
 * second facteur, second facteur vers console, garde vers login. Le focus retombe alors sur `body`,
 * sans un mot : l'opérateur au lecteur d'écran entend le silence et doit re-tabuler à l'aveugle pour
 * découvrir qu'il est ailleurs (WCAG 2.4.3).
 *
 * Le titre porte `tabIndex={-1}` : atteignable par le code, jamais inséré dans le parcours de
 * tabulation, où il ferait un arrêt de plus sans rien apprendre.
 */

import { useEffect, useRef } from 'react'

export function useFocusHeading<T extends HTMLElement>() {
  const heading = useRef<T>(null)

  useEffect(() => {
    heading.current?.focus()
  }, [])

  return heading
}
