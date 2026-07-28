// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { getRouter } from './router'

/**
 * Le câblage du routeur.
 *
 * Trois lignes de configuration, mais chacune est une décision de produit qu'aucun autre test ne
 * regarde — et que le build ne vérifie pas, puisqu'il se contente de les transmettre.
 */
describe('getRouter', () => {
  it('construit un routeur sur l’arbre de routes généré', () => {
    const router = getRouter()

    expect(router.routeTree).toBeDefined()
    // `/` et `/_design` existent aujourd'hui ; le test ne les énumère pas, ce serait redire
    // `routeTree.gen.ts`. Il vérifie que l'arbre est bien celui qui a été généré.
    expect(Object.keys(router.routesById)).toContain('/')
  })

  it('précharge à l’intention de navigation', () => {
    // L'outil est dense et desktop-first : précharger au survol supprime l'attente perçue, et le
    // réseau interne rend le coût négligeable. Un changement de ce réglage se verrait ici.
    expect(getRouter().options.defaultPreload).toBe('intent')
  })

  it('restaure la position de défilement', () => {
    // Un opérateur qui revient d'une fiche vers une table de mille lignes doit retrouver sa place ;
    // sans cela, il perd le contexte de ce qu'il était en train d'examiner.
    expect(getRouter().options.scrollRestoration).toBe(true)
  })
})
