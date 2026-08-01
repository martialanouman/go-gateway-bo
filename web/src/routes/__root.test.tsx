import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderRoute } from '~/test/render-route'

/**
 * Le retrait du squelette est la ligne la plus risquée de step-001 et la seule
 * qui n'avait aucun filet : le supprimer laissait 461 tests verts pendant qu'en
 * production le squelette — grille opaque en `min-height: 100vh`, placée avant
 * `#root` — restait peint pour toujours, l'application se montant sous la ligne
 * de flottaison.
 */
describe('le squelette de chargement à froid', () => {
  beforeEach(() => {
    const squelette = window.document.createElement('div')
    squelette.id = 'squelette'
    window.document.body.prepend(squelette)
  })

  it("disparaît une fois l'application montée", async () => {
    await renderRoute('/connexion')

    await waitFor(() => {
      expect(window.document.getElementById('squelette')).toBeNull()
    })
  })

  it("ne laisse rien derrière lui quand il n'y en avait pas", async () => {
    window.document.getElementById('squelette')?.remove()

    await expect(renderRoute('/connexion')).resolves.toBeDefined()
  })
})
