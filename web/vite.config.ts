import { fileURLToPath } from 'node:url'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { declaredTokens } from './vite-plugin-tokens'

/**
 * Port du BFF Go. `make dev` exporte `.env` avant de lancer Vite, donc `DASHBOARD_ADDR` est là quand
 * il est configuré ; le repli vaut celui de `.env.example`. Un repli est admis ici — contrairement au
 * serveur, où §1.8 l'interdit — parce qu'une erreur se voit immédiatement et bruyamment : le proxy
 * refuse la connexion dans le terminal du développeur, il ne dégrade rien en production.
 */
const bffPort = Number(process.env.DASHBOARD_ADDR?.split(':').pop()) || 3001

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
    declaredTokens(),
  ],

  resolve: {
    // Vite ne lit pas les `paths` du tsconfig, qui déclare le même `~/*` : sans cet alias, un import
    // en `~/…` passerait `tsc` et échouerait au bundle. `main.tsx` s'en sert, donc le build le vérifie.
    alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
  },

  // Déclaré plutôt que laissé au défaut : step-002 embarque ce répertoire dans le binaire, et une
  // seule ligne change alors de place.
  build: { outDir: 'dist' },

  server: {
    port: 3000,
    // Sans lui, Vite bascule sur le port suivant quand le sien est pris — il le journalise, mais le
    // suivant est précisément celui du BFF, et le proxy se parlerait alors à lui-même. §1.8 : un
    // repli qu'on n'a pas demandé n'est pas un service rendu.
    strictPort: true,
    proxy: {
      // Le chemin n'est pas réécrit : le BFF sert `/api/...` tel quel, et le développement emprunte
      // ainsi exactement le chemin de la production.
      '/api': { target: `http://localhost:${bffPort}` },
      '/ws': { target: `ws://localhost:${bffPort}`, ws: true },
    },
  },
})
