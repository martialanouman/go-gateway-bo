/**
 * Fait échouer la construction quand une source consomme un token que rien ne déclare.
 *
 * **Le défaut qu'il ferme est daté.** En v1.0, step-026 a livré un bandeau de refus sans bordure ni
 * fond : elle consommait `--danger-border`, `--danger-surface` et `--danger-text`, trois tokens
 * inventés. Toutes les portes étaient vertes, parce qu'un `var()` inconnu ne casse rien — le
 * navigateur applique la valeur héritée, et l'écran s'affiche *presque* juste. Rien dans cette pile
 * ne le voyait : le CSS est du CSS pur, sans PostCSS, sans typage, et Vite ne valide aucun `var()`.
 *
 * Le jugement porte sur l'**union** des sources, jamais fichier par fichier : le document déclare la
 * géométrie que le squelette peint, la feuille la consomme. Les juger séparément rejetterait la
 * coquille elle-même.
 *
 * ## Ce qu'il ne couvre pas — à savoir avant de s'y fier
 *
 * - **`apply: 'build'`** : `vite dev` ne le joue pas. `make check` construit, donc rien n'atteint une
 *   PR ; mais en développement, un token inventé reste silencieux jusqu'au premier build.
 * - **Les `var()` composés à l'exécution** — `` style={{ font: `var(${token})` }} `` — ne laissent
 *   aucun nom dans le CSS émis. C'est le motif même de `/_design`, et c'est `test/charte.test.ts`
 *   qui le garde, pas ce plugin.
 * - Il lit le CSS **émis**, donc après `@import` et minification. Un token qu'aucune règle atteinte
 *   ne consomme n'existe pas pour lui, ce qui est le bon comportement : on garde ce qui est servi.
 */

import type { Plugin } from 'vite'

/** Un `var(--nom)` ou `var(--nom, repli)`. Le repli ne dispense pas de déclarer le token. */
const CONSUMED = /var\(\s*(--[\w-]+)/g

/** Une déclaration `--nom:`, en tête de propriété. */
const DECLARED = /(--[\w-]+)\s*:/g

/** Un commentaire CSS ou une balise de commentaire HTML. */
const COMMENTS = /\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g

/**
 * Les tokens que `sources` consomme sans qu'aucune d'elles ne les déclare, triés et dédoublonnés.
 *
 * Les commentaires sortent d'abord : sans ça, le fichier de test de ce plugin — qui cite les trois
 * noms de l'incident de step-026 — se ferait rejeter par le plugin qu'il teste.
 */
export function undeclaredTokens(sources: readonly string[]): string[] {
  const text = sources.join('\n').replace(COMMENTS, '')

  const declared = new Set([...text.matchAll(DECLARED)].map(([, name]) => name as string))
  const consumed = new Set([...text.matchAll(CONSUMED)].map(([, name]) => name as string))

  return [...consumed].filter((name) => !declared.has(name)).sort()
}

/**
 * `writeBundle` plutôt que `generateBundle` : à ce moment tous les `generateBundle` ont tourné, donc
 * le document émis par `vite:build-html` est là sans dépendre d'un ordre entre plugins.
 */
export function declaredTokens(): Plugin {
  return {
    name: 'tokens-declares',
    apply: 'build',
    writeBundle(_options, bundle) {
      const sources = Object.values(bundle)
        .filter((asset) => asset.type === 'asset' && /\.(css|html)$/.test(asset.fileName))
        .map((asset) => String((asset as { source: string | Uint8Array }).source))

      const missing = undeclaredTokens(sources)
      if (missing.length === 0) return

      this.error(
        `${missing.length} token(s) consommé(s) sans être déclaré(s) : ${missing.join(', ')}.\n` +
          "Un `var()` inconnu ne casse rien à l'exécution — le navigateur hérite, et l'écran " +
          "s'affiche presque juste. C'est ainsi que la v1.0 a livré un bandeau de refus sans " +
          'bordure. Déclarer le token dans `src/styles/tokens/`, ou corriger le nom.',
      )
    },
  }
}
