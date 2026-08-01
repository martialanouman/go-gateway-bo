import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
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
// `import.meta.url` n'est pas un chemin de fichier sous jsdom : la racine du projet est celle où
// Vitest s'exécute.
const projectRoot = resolve(process.cwd())

describe('chargement à froid', () => {
  let outDir = ''
  let html = ''
  // Le document est aussi analysé comme un arbre : chercher une chaîne dans du texte ne dit ni où
  // l'élément se trouve, ni s'il porte quoi que ce soit, ni s'il est visible.
  let painted: HTMLElement

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'dashboard-build-'))

    // Le build passe par la **même commande que la production**, dans son propre process. Appeler
    // l'API de Vite depuis Vitest héritait de `NODE_ENV=test` : React s'y résolvait en développement
    // et l'artefact pesait 490 kB d'avertissements au lieu des 276 kB livrés — le test décrivait
    // alors quelque chose que personne ne sert. Par cette voie, l'octet produit est le même.
    await promisify(execFile)(
      'node_modules/.bin/vite',
      ['build', '--outDir', outDir, '--emptyOutDir'],
      {
        cwd: projectRoot,
        env: { ...process.env, NODE_ENV: 'production' },
      },
    )
    html = await readFile(join(outDir, 'index.html'), 'utf8')

    // Le document est **attaché** au DOM de test, et non simplement analysé : un arbre détaché n'a
    // aucune feuille de style associée, et `getComputedStyle` y rend les valeurs par défaut. Une
    // première version de ce test lisait ainsi `display: block` sur tout et ne pouvait rien prouver.
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    document.documentElement.replaceWith(document.importNode(parsed.documentElement, true))
    painted = document.body
  }, 120_000)

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true })
  })

  it('peint la silhouette de la coquille : rail, barre supérieure et contenu', () => {
    // Les trois régions sont cherchées **sous le point de montage**, et non dans le texte du
    // document : un squelette placé à côté de `#app` survivrait au montage de React et resterait
    // peint par-dessus l'application.
    for (const region of ['rail', 'topbar', 'content']) {
      const element = painted.querySelector(`#app [data-skeleton="${region}"]`)

      expect(element, `région ${region}`).not.toBeNull()
      // Un marqueur `data-skeleton` sur un conteneur vide n'est pas une silhouette : sans cette
      // assertion, vider les trois régions laissait la suite verte.
      expect(
        element?.querySelectorAll('.skeleton__block').length,
        `blocs de ${region}`,
      ).toBeGreaterThan(0)
    }
  })

  it('rend cette silhouette visible', () => {
    // `display: none` laissait tout le reste vert : le document portait alors un squelette que
    // personne ne voyait, c'est-à-dire un blanc.
    const style = window.getComputedStyle(painted.querySelector('.skeleton') as Element)

    expect(style.display).toBe('grid')
    expect(style.visibility).not.toBe('hidden')
    expect(style.opacity).not.toBe('0')
    expect(style.minHeight).not.toMatch(/^0/)
  })

  it('lui donne un rail et une barre de dimensions non nulles', () => {
    // jsdom ne résout pas les `var()` : la géométrie se lit sur les custom properties elles-mêmes,
    // qui sont la source partagée avec `app.css`. Les replier sur zéro laissait la suite verte tout
    // en supprimant le rail et la barre — un squelette réduit à deux traits.
    const declared = (name: string) =>
      new RegExp(`--${name}:\\s*([^;]+);`).exec(html)?.[1]?.trim() ?? ''

    expect(declared('shell-rail-width')).toMatch(/^[1-9]/)
    expect(declared('shell-topbar-height')).toMatch(/^[1-9]/)
  })

  it("annonce le chargement aux technologies d'assistance", () => {
    expect(painted.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(painted.textContent).toContain('Chargement du tableau de bord')
  })

  it("n'attend aucun script pour être peint", () => {
    // Ce qui compte n'est pas la position mais le mode d'exécution : un `type="module"` est différé
    // par définition, un script classique bloque le parseur — donc la peinture — le temps de son
    // téléchargement et de son exécution. `async` n'est **pas** accepté : il s'exécute dès qu'il est
    // disponible et peut interrompre l'analyse avant la fin du corps.
    const scripts = html.match(/<script\b[^>]*>/g) ?? []

    expect(scripts.length).toBeGreaterThan(0)
    for (const tag of scripts) {
      expect(tag, tag).toMatch(/\btype="module"|\sdefer[\s>=]/)
      // Vérifié séparément : un `type="module" async` satisfaisait l'alternative ci-dessus tout en
      // reprenant le comportement que ce test refuse.
      expect(tag, tag).not.toMatch(/\basync[\s>=]/)
    }
  })

  it("n'emporte dans le bundle aucune adresse que le navigateur ne doit pas connaître", async () => {
    // **Invariant (d).** `internal/` met le jeton machine, le mTLS et la base hors de portée du
    // bundle par construction ; le risque résiduel est une adresse écrite en dur dans le client.
    // README.md et CLAUDE.md présentent ce test comme le dernier rempart — il n'existait pas, et
    // cette step produit le premier bundle.
    // Tout ce qui est servi, et pas seulement `assets/` : Vite recopie `public/` tel quel, et un
    // fichier de configuration déposé là échapperait à une lecture du seul répertoire des bundles.
    const emitted = await readdir(outDir, { recursive: true, withFileTypes: true })
    const sources = await Promise.all(
      emitted
        .filter((entry) => entry.isFile())
        .map((entry) => readFile(join(entry.parentPath, entry.name), 'utf8')),
    )
    const shipped = sources.join('\n')

    // Liste blanche et non liste noire : interdire `:3001` et `:4010` se périmerait le jour où
    // l'API Admin aura une vraie adresse, sans que personne ne s'en aperçoive. Ici, **toute** origine
    // absolue doit être justifiée — en production le client parle en relatif, à l'origine qui l'a
    // servi.
    // Les préfixes couvrent des familles d'URL documentaires ; `http://localhost` est autorisé **à
    // l'identique** et non en préfixe, sinon `http://localhost:3001` — le BFF en dur, exactement ce
    // que cette garde cherche — passerait par la porte qu'elle tient. Vérifié : il passait.
    // Seuls les préfixes qui correspondent à quelque chose de réellement livré : une entrée morte
    // élargit la surface sans que personne ne s'en aperçoive. Vérifié — le bundle n'émet que ces
    // deux familles, plus le `http://localhost` nu ci-dessous.
    const allowedPrefixes = [
      'http://www.w3.org/', // espaces de noms SVG et XML, émis par React
      'https://react.dev/errors/', // messages d'erreur de React en production
    ]
    const allowedExactly = ['http://localhost'] // repli d'origine de TanStack Router hors navigateur

    // `wss://` autant que `https://` : la console tient une WebSocket multiplexée, c'est le canal le
    // plus probable d'une adresse en dur.
    const origins = shipped.match(/(?:https?|wss?):\/\/[^"'`\s)\\]+/g) ?? []
    const unexpected = origins.filter(
      (url) =>
        !allowedExactly.includes(url) && !allowedPrefixes.some((prefix) => url.startsWith(prefix)),
    )

    expect(new Set(unexpected)).toEqual(new Set())
  })

  it("porte le style du squelette dans le document plutôt que dans la feuille de l'application", () => {
    // Ce que cela achète : la silhouette garde sa forme si la feuille échoue, et elle est peinte sans
    // attendre le CSS en développement, où Vite l'injecte par JavaScript.
    //
    // Ce que cela **n'**achète **pas**, contrairement à ce qui était écrit ici : Vite émet en
    // production un `<link rel="stylesheet">` dans le `<head>`, et une feuille liée bloque le rendu
    // du document entier — squelette compris. Mesuré sur le livré : 680 octets, 379 compressés, 0,6 à
    // 0,8 ms sur une boucle locale. Le remède (inliner au build) rendrait la feuille non cacheable
    // entre deux déploiements, ce qui coûte plus qu'il ne rapporte tant qu'elle est petite.
    // **À rouvrir en step-008**, qui y versera les tokens et les polices.
    const inlineStyle = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))

    expect(inlineStyle).toContain('.skeleton')
    expect(inlineStyle).toContain('grid-template-columns')
  })
})
