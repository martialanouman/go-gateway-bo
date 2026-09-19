// @vitest-environment node

/**
 * Trois preuves, parce qu'aucune ne suffit seule : la fonction pure décide correctement ; une
 * construction réelle échoue vraiment ; et le plugin est bien câblé dans `vite.config.ts`, chargée
 * comme Vite la charge. La troisième porte la leçon de la recette `check-routes` — un générateur
 * retiré de la configuration passait la porte.
 */

import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, loadConfigFromFile } from 'vite'
import { describe, expect, it } from 'vitest'
import { declaredTokens, undeclaredTokens } from './vite-plugin-tokens'

describe('les tokens qu’une source consomme sans les déclarer', () => {
  it('nomme ceux qu’aucune source ne déclare', () => {
    const css =
      '.refus { border: 1px solid var(--danger-border); background: var(--danger-surface); }'

    expect(undeclaredTokens([css])).toEqual(['--danger-border', '--danger-surface'])
  })

  it('accepte un token déclaré par une autre source que celle qui le consomme', () => {
    // C'est le cas réel du dépôt : le document déclare la géométrie du squelette, la feuille la
    // consomme. Juger chaque fichier isolément rejetterait la coquille elle-même.
    const document = ':root { --shell-rail-width: 236px; }'
    const stylesheet = '.shell { grid-template-columns: var(--shell-rail-width) 1fr; }'

    expect(undeclaredTokens([document, stylesheet])).toEqual([])
  })

  it('ne compte pas un token cité dans un commentaire', () => {
    // Sans cette précaution, ce fichier-ci se ferait rejeter : son en-tête cite `--danger-border`.
    const css = '/* remplace var(--ancien-nom) */ .x { color: var(--text-primary); }'

    expect(undeclaredTokens([css, ':root { --text-primary: #e6edf3; }'])).toEqual([])
  })

  it('refuse un token inconnu même muni d’un repli', () => {
    // `var(--x, #fff)` n'échoue pas visiblement : il rend le repli. C'est exactement la dégradation
    // silencieuse que ce plugin existe pour interdire, et le dépôt n'emploie aucun repli.
    expect(undeclaredTokens(['.x { color: var(--inconnu, #ffffff); }'])).toEqual(['--inconnu'])
  })

  it('rend une liste triée et sans doublon, pour que le message soit lisible', () => {
    const css =
      '.a { color: var(--zeta); } .b { color: var(--alpha); } .c { border-color: var(--zeta); }'

    expect(undeclaredTokens([css])).toEqual(['--alpha', '--zeta'])
  })
})

describe('la construction', () => {
  it('échoue quand une feuille consomme un token que rien ne déclare', async () => {
    // realpath : sur macOS `/var` est un lien vers `/private/var`, et Vite compare les chemins
    // résolus — sans ça, `vite:build-html` reçoit un chemin relatif remontant et rejette.
    const root = await realpath(await mkdtemp(join(tmpdir(), 'tokens-')))
    await writeFile(
      join(root, 'index.html'),
      '<html><body><script type="module" src="/x.js"></script></body></html>',
    )
    await writeFile(join(root, 'x.js'), "import './x.css'\n")
    await writeFile(join(root, 'x.css'), '.x { color: var(--token-inexistant); }')

    await expect(
      build({ root, logLevel: 'silent', plugins: [declaredTokens()], build: { outDir: 'dist' } }),
    ).rejects.toThrow(/--token-inexistant/)
  }, 60_000)

  it('est câblée dans la configuration, faute de quoi rien de ce qui précède ne protège', async () => {
    // La configuration exécutée, et non son texte : `// declaredTokens(),` contient la chaîne.
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
    )
    const names = ((loaded?.config.plugins ?? []) as unknown[])
      .flat(Number.POSITIVE_INFINITY)
      .map((plugin) =>
        plugin && typeof plugin === 'object' && 'name' in plugin ? plugin.name : '',
      )

    expect(names).toContain(declaredTokens().name)
  })
})
