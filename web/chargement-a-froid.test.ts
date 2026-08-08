import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readTokens, resolveToken } from './test/tokens'

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
  // La feuille émise, pour confronter ce que la coquille React consomme à ce que le document déclare.
  let stylesheet = ''

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

    const emitted = (await readdir(outDir, { recursive: true, withFileTypes: true })).filter(
      (entry) => entry.isFile() && entry.name.endsWith('.css'),
    )
    stylesheet = (
      await Promise.all(
        emitted.map((entry) => readFile(join(entry.parentPath, entry.name), 'utf8')),
      )
    ).join('\n')

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
    // `toBeVisible` remonte la chaîne des ancêtres : n'inspecter que `.skeleton` laissait passer un
    // `#app { display: none }`, qui produit exactement le blanc que §1.9 interdit.
    expect(painted.querySelector('.skeleton')).toBeVisible()

    const style = window.getComputedStyle(painted.querySelector('.skeleton') as Element)
    expect(style.display).toBe('grid')
    expect(style.minHeight).not.toMatch(/^0/)
  })

  it('lui donne un rail et une barre de dimensions non nulles', () => {
    const style = window.getComputedStyle(painted.querySelector('.skeleton') as Element)

    // jsdom ne résout pas les `var()`, il les rend littéralement — c'est ce qui permet d'asserter sur
    // l'arbre plutôt que sur le texte source : une piste écrite en dur (`0 1fr`) ne référence plus la
    // propriété partagée, et un renommage de celle-ci non plus.
    expect(style.gridTemplateColumns).toContain('var(--shell-rail-width)')
    expect(style.gridTemplateRows).toContain('var(--shell-topbar-height)')

    // Et les valeurs, elles, se lisent à la déclaration : les replier sur zéro supprime le rail et la
    // barre sans toucher à la grille.
    const declared = (name: string) =>
      new RegExp(`--${name}:\\s*([^;]+);`).exec(html)?.[1]?.trim() ?? ''
    expect(declared('shell-rail-width')).toMatch(/^[1-9]/)
    expect(declared('shell-topbar-height')).toMatch(/^[1-9]/)
  })

  it('donne à ses blocs une hauteur, faute de quoi la silhouette est un cadre vide', () => {
    // Compter les blocs ne suffisait pas : à hauteur nulle, le squelette redevient le « blanc décoré »
    // que la step refuse en propres termes.
    const blocks = painted.querySelectorAll('#app .skeleton__block')

    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) {
      expect(window.getComputedStyle(block).height, block.className).not.toMatch(/^0/)
    }
  })

  it("masque son texte d'assistance sans le retirer du document", () => {
    // La règle remplace un attribut `style=`, que la CSP à nonce de step-186 ferait tomber. Sans
    // elle, « Chargement du tableau de bord » s'affiche en clair au milieu du squelette.
    const style = window.getComputedStyle(painted.querySelector('.skeleton__sr-only') as Element)

    expect(style.position).toBe('absolute')
    expect(style.width).toBe('1px')
    expect(style.overflow).toBe('hidden')
  })

  it('recopie fidèlement, dans le document, les tokens que la coquille consomme', () => {
    // **Ce test a changé de sens en step-008, et son remplaçant est plus fort.** Il exigeait avant
    // que *tout* `var()` de la feuille soit déclaré dans `index.html` — écrit pour quatre variables
    // de géométrie, il tombait au premier `var(--text-primary)` parmi 236 tokens. Ce contrôle
    // d'existence vit désormais dans le build (`vite-plugin-tokens`), où il juge l'**union** du
    // document et du CSS émis : il couvre les 236 tokens au lieu de quatre, et il fait échouer
    // `vite build` plutôt qu'un test.
    //
    // Ce qui reste ici est ce que le build ne peut pas voir : le `<style>` inline **duplique** quatre
    // tokens de la charte, parce que la première peinture n'a aucune feuille à sa disposition. La
    // duplication est imposée ; ce qui se teste, c'est qu'elle soit fidèle. Non alignées, ces valeurs
    // font sauter le rail de 4 px et changent la luminance du canvas au montage de React.
    const tokens = readTokens()

    const copies = [
      ['--shell-rail-width', '--nav-width'],
      ['--shell-topbar-height', '--topbar-height'],
      ['--skeleton-surface', '--surface-page'],
      ['--skeleton-shape', '--border-subtle'],
    ] as const

    for (const [inDocument, inCharter] of copies) {
      const declared = new RegExp(`${inDocument}:\\s*([^;]+);`).exec(html)?.[1]?.trim()
      const token = resolveToken(tokens, inCharter)

      expect(token, `${inCharter} a disparu de la charte`).toBeDefined()
      expect(declared, `${inDocument} ne recopie plus ${inCharter}`).toBe(token)
    }

    // Et la coquille consomme bien les tokens de la charte, non la copie : sinon le document
    // pourrait recopier fidèlement des tokens que plus personne n'utilise.
    const consumed = new Set(
      stylesheet.match(/var\((--[\w-]+)\)/g)?.map((reference) => reference.slice(4, -1)) ?? [],
    )
    expect(consumed).toContain('--nav-width')
    expect(consumed).toContain('--topbar-height')
  })

  it("garde la feuille d'entrée assez petite pour que l'aller-retour reste le seul coût", async () => {
    // step-001 mesurait 680 octets et concluait « négligeable tant que la feuille est petite ».
    // C'était une hypothèse ; ce plafond en fait une condition. Remesuré le 08/08/2026 sur la sortie
    // livrée, tokens, polices et feuille de `/_design` versés : **12 635 octets bruts, 3 420
    // compressés** — la marge sous le plafond est de 3,7 Ko, pas celle de `components.css` (1 568
    // lignes en v1.0, qui arrive en step-041).
    //
    // *(Le chiffre a d'abord été écrit à 10 723 : c'était la mesure d'avant `/_design`, prise au
    // commit précédent et jamais refaite. Une revue l'a relevée. C'est le critère 2 — l'affirmation se
    // confronte à la sortie, pas à l'intention du diff.)*
    const entry = /<link rel="stylesheet"[^>]*href="([^"]+)"/.exec(html)?.[1]
    expect(entry, "le document ne lie plus de feuille d'entrée").toBeDefined()

    const bytes = (await readFile(join(outDir, (entry as string).replace(/^\//, '')))).byteLength

    expect(bytes).toBeLessThan(16_384)
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
    // Les binaires sont exclus **par extension** plutôt que lus en `utf8` : depuis que step-008
    // auto-héberge les polices, sept `.woff2` (144 Ko) transiteraient sinon par cette regex, décodés
    // en UTF-8 avec des `U+FFFD` partout. Un octet mal placé y produirait une fausse origine, sur du
    // contenu qui ne peut de toute façon pas porter d'URL.
    const TEXTUAL = /\.(js|mjs|cjs|css|html|json|svg|txt|map|webmanifest)$/
    const emitted = await readdir(outDir, { recursive: true, withFileTypes: true })
    const sources = await Promise.all(
      emitted
        .filter((entry) => entry.isFile() && TEXTUAL.test(entry.name))
        .map((entry) => readFile(join(entry.parentPath, entry.name), 'utf8')),
    )
    const shipped = sources.join('\n')

    // Sans ce plancher, le filtre ci-dessus pourrait tout exclure et laisser la garde verte et vide.
    expect(sources.length).toBeGreaterThanOrEqual(3)

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
