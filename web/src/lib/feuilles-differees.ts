/**
 * Le contrat entre `vite.config.ts`, qui marque la feuille de styles, et
 * l'entrée client, qui la promeut.
 *
 * Il vit ici parce qu'il vivait dans deux fichiers sans que rien ne les relie :
 * renommer l'attribut d'un seul côté laissait toutes les portes vertes et
 * livrait une console dont l'unique feuille restait en `media="print"` — donc
 * entièrement non stylée. Un mode de défaillance pire que celui que le report
 * de la feuille corrige.
 */
export const ATTRIBUT_DIFFEREE = 'data-differee'

/**
 * Rend applicables les feuilles chargées en `media="print"`.
 *
 * Le report existe pour que la feuille ne bloque pas le premier paint du
 * squelette. La promotion a lieu avant le montage de React : la console n'est
 * jamais peinte non stylée.
 *
 * Rend le nombre de feuilles promues — nul en développement, où Vite injecte
 * les styles par JavaScript et n'émet aucun `<link>`.
 */
export function promouvoirFeuillesDifferees(racine: Document): number {
  const feuilles = racine.querySelectorAll<HTMLLinkElement>(`link[${ATTRIBUT_DIFFEREE}]`)

  for (const feuille of feuilles) {
    feuille.media = 'all'
  }

  return feuilles.length
}
