import { fileURLToPath } from 'node:url'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** Port du BFF Go, celui que `.env.example` donne à `DASHBOARD_ADDR`. Changer l'un impose l'autre. */
const bffPort = 3001

export default defineConfig({
  plugins: [
    // Avant le plugin React : c'est lui qui engendre `routeTree.gen.ts` à partir de `src/routes/`,
    // et React doit transformer le fichier une fois écrit.
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      // Sans ce motif, un `écran.test.tsx` posé à côté de sa route deviendrait lui-même une route :
      // le générateur prend tout ce qu'il trouve sous `routes/`.
      routeFileIgnorePattern: '\\.test\\.tsx?$',
    }),
    react(),
  ],

  resolve: {
    // Vite ne lit pas les `paths` du tsconfig : sans cet alias, `~/…` compile sous `tsc` et échoue
    // au bundle.
    alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
  },

  server: {
    port: 3000,
    // Sans lui, Vite glisse en silence sur le port suivant quand le sien est pris — et le suivant
    // est celui du BFF. Le proxy se parlerait alors à lui-même. §1.8 : aucun repli silencieux.
    strictPort: true,
    proxy: {
      // Le chemin n'est pas réécrit : le BFF sert `/api/...` tel quel, et le développement emprunte
      // ainsi exactement le chemin de la production.
      '/api': { target: `http://localhost:${bffPort}` },
      '/ws': { target: `ws://localhost:${bffPort}`, ws: true },
    },
  },
})
