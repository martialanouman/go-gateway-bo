import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
async function loadServedDocument() {
  // `import.meta.url` n'est pas un chemin de fichier sous jsdom : le document servi se lit depuis la
  // racine du projet, celle où Vitest s'exécute.
  const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8')
  const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))

  // Le script est retiré : c'est l'import du module qui joue son rôle, sous le contrôle du test.
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '')
}

describe("l'entrée de l'application", () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.resetModules()
  })

  it('remplace le squelette peint par le document', async () => {
    await loadServedDocument()
    expect(document.querySelector('[data-skeleton="rail"]')).not.toBeNull()

    await import('./main')

    // Le rendu de React 19 n'est pas synchrone : sans attente, le squelette est encore là et le test
    // accuserait le montage d'un défaut qui n'est qu'un ordonnancement.
    await waitFor(() => {
      expect(document.querySelector('#app')?.textContent).toContain(
        "Le cockpit d'exploitation se construit",
      )
    })
    expect(document.querySelector('[data-skeleton="rail"]')).toBeNull()
  })

  it('échoue bruyamment si le point de montage a disparu du document', async () => {
    document.body.innerHTML = '<div id="autre-chose"></div>'

    await expect(import('./main')).rejects.toThrow(/#app/)
  })
})
