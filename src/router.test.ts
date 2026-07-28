// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { getRouter } from './router'

/**
 * Le câblage du routeur.
 *
 * Un seul test, délibérément. Asserter que `defaultPreload` vaut `'intent'` ou que
 * `scrollRestoration` est vrai ne ferait que recopier `router.tsx` : ces assertions ne peuvent
 * échouer que si quelqu'un change le réglage exprès, et elles échoueraient alors sans dire si le
 * changement est bon. Ce qui mérite un test, c'est que la fabrique produise un routeur monté sur
 * l'arbre généré — le reste se vérifie en lisant le fichier.
 */
describe('getRouter', () => {
  it('construit un routeur sur l’arbre de routes généré', () => {
    const router = getRouter()

    expect(router.routeTree).toBeDefined()
    // `/` et `/_design` existent aujourd'hui ; le test ne les énumère pas, ce serait redire
    // `routeTree.gen.ts`. Il vérifie que l'arbre est bien celui qui a été généré.
    expect(Object.keys(router.routesById)).toContain('/')
  })
})
