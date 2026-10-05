import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { waitFor } from '@testing-library/react'
import type { Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubSession } from '../test/session'

/**
 * Le montage lui-même n'était traversé par aucun test : remplacer `#app` par un identifiant inexistant
 * laissait la suite entièrement verte, le typage et le bundle compris — pendant qu'un opérateur serait
 * resté devant un squelette pulsant indéfiniment. Le squelette rend même cet échec muet : sans lui, un
 * blanc aurait au moins signalé la panne.
 *
 * Le test importe donc `main.tsx` — le vrai module d'entrée, avec sa configuration de routeur et son
 * StrictMode — dans un document qui porte le squelette d'`index.html`, et vérifie que l'application
 * l'a bien remplacé.
 */
const mounted = vi.hoisted((): Root[] => [])

// Le vrai `createRoot`, dont on garde la racine : `main.tsx` ne la démonte jamais, puisqu'en production
// elle vit autant que l'onglet. Ici, une racine vivante continue de commiter (réponses, trames) après le
// test, et le rappel que React planifie alors lit `window` une fois jsdom détruit.
vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>()

  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args)
      mounted.push(root)
      return root
    },
  }
})

async function loadServedDocument() {
  // `import.meta.url` n'est pas un chemin de fichier sous jsdom : le document servi se lit depuis la
  // racine du projet, celle où Vitest s'exécute.
  const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8')
  const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))

  // Le script est retiré : c'est l'import du module qui joue son rôle, sous le contrôle du test.
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '')
}

describe('the application entry point', () => {
  afterEach(async () => {
    for (const root of mounted.splice(0)) root.unmount()
    // Un rappel déjà confié au scheduler s'exécute encore tant que `window` existe.
    await new Promise((resolve) => setTimeout(resolve, 0))
    document.body.innerHTML = ''
    vi.resetModules()
  })

  it('replaces the painted skeleton with the document', async () => {
    await loadServedDocument()
    expect(document.querySelector('[data-skeleton="rail"]')).not.toBeNull()

    stubSession({ permissions: [] })
    await import('./main')

    // Le rendu de React 19 n'est pas synchrone : sans attente, le squelette est encore là et le test
    // accuserait le montage d'un défaut qui n'est qu'un ordonnancement.
    await waitFor(() => {
      expect(document.querySelector('#app')?.textContent).toContain(
        "Le cockpit d'exploitation se construit",
      )
    })
    expect(document.querySelector('[data-skeleton="rail"]')).toBeNull()
    // Sans racine captée, l'`afterEach` ne démonterait rien et la course reviendrait sans un mot.
    expect(mounted).toHaveLength(1)
  })

  it('fails loudly if the mount point has vanished from the document', async () => {
    document.body.innerHTML = '<div id="autre-chose"></div>'

    await expect(import('./main')).rejects.toThrow(/#app/)
  })
})
