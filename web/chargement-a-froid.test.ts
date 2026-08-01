// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Coller une URL profonde dans un onglet neuf doit peindre la silhouette de la coquille — jamais un
 * blanc, que le contrat à cinq états n'autorise nulle part (§1.9).
 *
 * Le test porte sur le **document construit**, celui que le binaire servira depuis `embed.FS` quelle
 * que soit l'URL demandée. C'est lui que reçoit un opérateur, avant qu'aucun script ne s'exécute ;
 * asserter après le montage de React ne prouverait rien, puisque React remplace ce squelette.
 *
 * Le serveur de développement n'est volontairement pas le sujet : il n'est pas le chemin de
 * production, et le fallback SPA qui associe une URL profonde à ce document appartient au Go — c'est
 * step-002 qui l'exercera, sur le binaire.
 */
describe('chargement à froid', () => {
  let outDir = ''
  let document = ''

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'dashboard-build-'))
    await build({
      root: fileURLToPath(new URL('.', import.meta.url)),
      logLevel: 'error',
      build: { outDir, emptyOutDir: true },
    })
    document = await readFile(join(outDir, 'index.html'), 'utf8')
  }, 120_000)

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true })
  })

  it('peint la silhouette de la coquille : rail, barre supérieure et contenu', () => {
    expect(document).toContain('data-skeleton="rail"')
    expect(document).toContain('data-skeleton="topbar"')
    expect(document).toContain('data-skeleton="content"')
  })

  it("annonce le chargement aux technologies d'assistance", () => {
    expect(document).toMatch(/aria-busy="true"/)
    expect(document).toContain('Chargement du tableau de bord')
  })

  it("n'attend aucun script pour être peint", () => {
    // La position dans le document ne dit rien : ce qui compte est que chaque script soit différé.
    // Un `type="module"` l'est par définition, un script classique bloquerait le parseur — donc la
    // peinture — le temps de son téléchargement et de son exécution.
    const scripts = document.match(/<script\b[^>]*>/g) ?? []

    expect(scripts.length).toBeGreaterThan(0)
    for (const tag of scripts) {
      expect(tag).toMatch(/type="module"|\bdefer\b|\basync\b/)
    }
  })

  it('porte le style du squelette dans le document, et non dans une feuille liée', () => {
    // La feuille de l'application, elle, est liée — et une feuille liée bloque le rendu. Le squelette
    // ne doit donc rien lui demander : sans ces règles inline, il s'afficherait sans forme, ce qui
    // est un autre blanc.
    const inlineStyle = document.slice(document.indexOf('<style>'), document.indexOf('</style>'))

    expect(inlineStyle).toContain('.skeleton')
    expect(inlineStyle).toContain('grid-template-columns')
  })
})
