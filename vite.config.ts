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
    tanstackStart({
      router: {
        // Les tests vivent à côté de la route qu'ils couvrent. Sans ce motif, le générateur les lit
        // comme des routes, n'y trouve pas de `Route` exportée et avertit à chaque build — un bruit
        // qui finirait par masquer le même avertissement émis pour un vrai oubli.
        routeFileIgnorePattern: '\\.(test|spec)\\.[jt]sx?$',
      },
    }),
    // Sans plugin d'hébergement, `vite build` ne produit qu'un handler fetch : rien n'écoute.
    // Nitro l'emballe en serveur Node autonome (`.output/server/index.mjs`).
    //
    // Nitro v2 et non v3 : `nitro@3` n'existe qu'en beta, et la spec §1.3 impose une cible Node
    // auto-hébergée tenant des WebSockets longue durée (step-043) derrière une cible de 99,9 %
    // (§1.2). On ne fonde pas ce socle sur une préversion.
    nitroV2Plugin({
      preset: 'node-server',
      // Fige le jeu de comportements par défaut de Nitro. Sans cette date, Nitro retombe sur
      // 2024-04-03 : le build d'aujourd'hui et celui d'après le prochain bump ne suivraient pas
      // forcément les mêmes défauts, sans qu'aucun diff ne le montre.
      compatibilityDate: '2026-07-28',
      // Les routes HTTP du BFF sont déclarées ici plutôt que posées sous `src/routes/`.
      // Une server route TanStack devrait y vivre — c'est le routage par fichiers qui lui donne son
      // URL — et devrait donc importer `src/server/` depuis `src/routes/`, ce que la règle de lint
      // de l'invariant (d) interdit. Nitro enregistre un handler depuis n'importe quel chemin : le
      // fichier reste sous `src/server/`, et la règle n'a besoin d'aucune exception.
      handlers: [
        {
          route: '/api/auth/login',
          handler: './src/server/auth/http/login.ts',
          method: 'post',
        },
        { route: '/api/auth/me', handler: './src/server/auth/http/me.ts', method: 'get' },
        // Deux phases sur un même point d'entrée : sans code, l'opérateur demande un QR code ; avec
        // un code, il confirme l'enrôlement. C'est ce que décrit le §6.9 de la spécification.
        {
          route: '/api/auth/mfa/enroll',
          handler: './src/server/auth/http/mfa-enroll.ts',
          method: 'post',
        },
        {
          route: '/api/auth/mfa/verify',
          handler: './src/server/auth/http/mfa-verify.ts',
          method: 'post',
        },
        // `post` et non `get` : une déconnexion est une mutation, et un `get` se déclenche depuis
        // une image ou un lien préchargé — un tiers déconnecterait un opérateur à son insu.
        { route: '/api/auth/logout', handler: './src/server/auth/http/logout.ts', method: 'post' },
      ],
    }),
    // Le plugin React doit venir APRÈS celui de Start.
    viteReact(),
  ],
})
