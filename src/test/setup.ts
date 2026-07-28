import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom n'implémente pas `scrollTo`, et la restauration de scroll du routeur l'appelle à chaque
// navigation. Sans ce stub, chaque test de route crache un « Not implemented » qui noie la sortie.
vi.stubGlobal('scrollTo', vi.fn())

// Sans ce démontage, un composant d'un test précédent reste dans le DOM et le test suivant peut
// passer pour de mauvaises raisons — ou échouer sur un « found multiple elements » opaque.
afterEach(() => {
  cleanup()
})
