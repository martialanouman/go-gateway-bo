/**
 * Fait échouer la construction quand une source consomme un token que rien ne déclare.
 *
 * Rien d'autre dans cette pile ne le voit : le CSS est du CSS pur, sans PostCSS, sans typage, et Vite
 * ne valide aucun `var()`. Or un `var()` inconnu ne casse rien — le navigateur applique la valeur
 * héritée et l'écran s'affiche *presque* juste, toutes portes vertes.
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
 * - **Il refuse les variables qu'un composant pose depuis JavaScript** — `--active-tab-left`,
 *   `--active-tab-width`, `--anchor-width`, qu'un `style.setProperty()` écrit à l'exécution. Elles
 *   sont déclarées avec une valeur de repli dans `components.css`, ce qui le satisfait sans
 *   exemption : une largeur d'onglet a une valeur au premier rendu, avant que le JavaScript ne mesure.
 */

import type { Plugin } from 'vite'

/** Un `var(--nom)` ou `var(--nom, repli)`. Le repli ne dispense pas de déclarer le token. */
const CONSUMED = /var\(\s*(--[\w-]+)/g

/** Une déclaration `--nom:`, en tête de propriété. */
const DECLARED = /(--[\w-]+)\s*:/g

/** Un commentaire CSS. */
const COMMENTS = /\/\*[\s\S]*?\*\//g

/** Le contenu d'un bloc `<style>`, seul endroit d'un document HTML où vivent des tokens. */
const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g

/**
 * Les tokens que `sources` — du **CSS** — consomme sans qu'aucune d'elles ne les déclare, triés et
 * dédoublonnés.
 *
 * Les commentaires sortent d'abord : un commentaire qui cite un nom de token le ferait compter comme
 * consommé.
 */
export function undeclaredTokens(sources: readonly string[]): string[] {
  const text = sources.join('\n').replace(COMMENTS, '')

  const declared = new Set([...text.matchAll(DECLARED)].map(([, name]) => name as string))
  const consumed = new Set([...text.matchAll(CONSUMED)].map(([, name]) => name as string))

  return [...consumed].filter((name) => !declared.has(name)).sort()
}

/**
 * Le CSS d'un asset émis : son contenu s'il est déjà du CSS, sinon les blocs `<style>` qu'il porte.
 *
 * **On n'assainit pas le HTML, on en extrait le CSS.** Retirer les commentaires HTML pour traiter le
 * document comme du CSS est ce que CodeQL signale en `js/incomplete-multi-character-sanitization` —
 * un remplacement unique de `<!--…-->` laisse passer une imbrication. Extraire les `<style>` est plus
 * précis : les commentaires HTML, qui citent des noms de tokens dans `index.html`, cessent d'être lus
 * du tout au lieu d'être nettoyés.
 */
function styleSheetsIn(fileName: string, source: string): string[] {
  if (fileName.endsWith('.css')) return [source]

  return [...source.matchAll(STYLE_BLOCK)].map(([, css]) => css as string)
}

/**
 * `writeBundle` plutôt que `generateBundle` : à ce moment tous les `generateBundle` ont tourné, donc
 * le document émis par `vite:build-html` est là sans dépendre d'un ordre entre plugins.
 */
export function declaredTokens(): Plugin {
  return {
    name: 'declared-tokens',
    apply: 'build',
    writeBundle(_options, bundle) {
      const sources = Object.values(bundle)
        .filter((asset) => asset.type === 'asset' && /\.(css|html)$/.test(asset.fileName))
        .flatMap((asset) =>
          styleSheetsIn(asset.fileName, String((asset as { source: string | Uint8Array }).source)),
        )

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
