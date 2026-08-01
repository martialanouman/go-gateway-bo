import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { ATTRIBUT_DIFFEREE } from './src/lib/feuilles-differees'

const BFF = 'http://127.0.0.1:3001'

/**
 * Vite injecte la feuille de styles en `<link rel="stylesheet">` dans le `<head>`,
 * où elle **bloque le premier paint** — 31 ko de tokens et de polices. Le
 * squelette n'apparaissait donc qu'après un aller-retour réseau, ce qui le vide
 * de son sens : c'est le blanc que step-001 existe pour fermer, déplacé d'un
 * cran. Une revue l'a trouvé sur l'artefact ; la source, elle, n'a pas de
 * `<link>` du tout, et le test qui lisait la source ne pouvait pas le voir.
 *
 * La feuille est donc chargée en `media="print"` — récupérée sans bloquer — et
 * `main.tsx` la promeut en `all` avant de monter React. Aucun `onload` inline :
 * step-186 posera un nonce CSP, et un attribut de gestionnaire d'événement y
 * échouerait.
 */
function feuilleNonBloquante(): Plugin {
  return {
    name: 'squelette/feuille-non-bloquante',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html.replace(
          /<link rel="stylesheet"([^>]*)>/g,
          `<link rel="stylesheet"$1 media="print" ${ATTRIBUT_DIFFEREE}>`,
        ),
    },
  }
}

export default defineConfig({
  plugins: [
    // Doit précéder le plugin React : il engendre `routeTree.gen.ts` que React
    // compile ensuite.
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      // Les tests vivent à côté de la route qu'ils couvrent. Sans ce motif, le
      // générateur les lit comme des routes, n'y trouve pas de `Route` exportée
      // et avertit à chaque build — un bruit qui finirait par masquer le même
      // avertissement émis pour un vrai oubli.
      routeFileIgnorePattern: '\\.(test|spec)\\.[jt]sx?$',
    }),
    viteReact(),
    feuilleNonBloquante(),
  ],

  resolve: { tsconfigPaths: true },

  server: {
    port: 3000,
    // Échec bruyant plutôt que repli silencieux : sans cela Vite glisse sur le
    // port suivant quand 3000 est pris — et le port suivant est celui du BFF.
    // On l'a vu, et le symptôme était un proxy qui se parlait à lui-même.
    strictPort: true,
    // Le développement emprunte le **même chemin** que la production : le
    // navigateur appelle `/api` en relatif, et c'est le proxy — puis, en
    // production, le binaire — qui décide où ça atterrit. Aucun code client ne
    // connaît l'adresse du BFF, ce qui est aussi la moitié client de
    // l'invariant (d).
    proxy: {
      '/api': BFF,
      '/ws': { target: BFF.replace('http', 'ws'), ws: true },
    },
  },
})
