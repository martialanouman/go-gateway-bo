// @vitest-environment node
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Coller une URL profonde dans un onglet neuf doit peindre la silhouette de la coquille — jamais un
 * blanc, que le contrat à cinq états n'autorise nulle part (§1.9).
 *
 * Le test interroge un vrai serveur et lit la réponse HTTP : c'est le document tel qu'il est servi,
 * avant que le moindre script ne s'exécute. Asserter après le montage de React ne prouverait rien,
 * puisque React remplace précisément ce squelette.
 *
 * Le pendant production — le même document servi par le binaire Go depuis `embed.FS` — appartient à
 * step-002, qui l'exercera sur le binaire.
 */
describe('chargement à froid', () => {
  let server: ViteDevServer
  let origin: string

  beforeAll(async () => {
    server = await createServer({
      root: fileURLToPath(new URL('.', import.meta.url)),
      // Le port de la configuration est fixe et `strictPort` interdit d'en changer : le test prend
      // un port libre pour ne pas dépendre de ce qui tourne sur la machine.
      server: { port: 0, strictPort: false },
      logLevel: 'error',
    })
    await server.listen()

    const address = server.httpServer?.address()
    if (address === null || address === undefined || typeof address === 'string') {
      throw new Error("le serveur de développement n'a pas d'adresse TCP")
    }
    origin = `http://localhost:${address.port}`
  })

  afterAll(async () => {
    await server.close()
  })

  it('peint la silhouette de la coquille sur une URL profonde', async () => {
    const response = await fetch(`${origin}/clients/01960000-0000-7000-8000-000000000000`)
    const document = await response.text()

    expect(response.status).toBe(200)
    expect(document).toContain('data-skeleton="rail"')
    expect(document).toContain('data-skeleton="topbar"')
    expect(document).toContain('data-skeleton="content"')
  })

  it('annonce le chargement aux technologies d\'assistance', async () => {
    const document = await (await fetch(`${origin}/`)).text()

    expect(document).toMatch(/aria-busy="true"/)
    expect(document).toContain('Chargement du tableau de bord')
  })
})
