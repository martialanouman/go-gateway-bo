import { nitroV2Plugin } from '@tanstack/nitro-v2-vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tanstackStart(),
    // Sans plugin d'hébergement, `vite build` ne produit qu'un handler fetch : rien n'écoute.
    // Nitro l'emballe en serveur Node autonome (`.output/server/index.mjs`).
    //
    // Nitro v2 et non v3 : `nitro@3` n'existe qu'en beta, et la spec §1.3 impose une cible Node
    // auto-hébergée tenant des WebSockets longue durée (step-043) derrière une cible de 99,9 %
    // (§1.2). On ne fonde pas ce socle sur une préversion.
    nitroV2Plugin({ preset: 'node-server' }),
    // Le plugin React doit venir APRÈS celui de Start.
    viteReact(),
  ],
})
