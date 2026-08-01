import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const BFF = 'http://127.0.0.1:3001'

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
