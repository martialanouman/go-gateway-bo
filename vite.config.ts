import { fileURLToPath } from 'node:url'
import { nitroV2Plugin } from '@tanstack/nitro-v2-vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { BFF_ROUTES } from './src/server/bff-routes'

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
      // La liste vit dans `src/server/bff-routes.ts` et non ici : le test d'énumération de
      // l'invariant (c) doit pouvoir la lire comme une **valeur**, pas en regexper le texte de ce
      // fichier. Voir l'en-tête de ce module pour ce que la lecture textuelle ratait.
      handlers: [...BFF_ROUTES],
      // **Le bundle de Nitro ne connaît pas les chemins de `tsconfig.json`.** Il ne l'a pas montré
      // jusqu'ici par chance : les seuls `~/lib/...` atteignables depuis un handler étaient des
      // `import type`, effacés à la compilation. La première valeur importée ainsi — le catalogue de
      // permissions, dans les parseurs de l'annuaire — a fait échouer le build sur un
      // `/lib/permissions` cherché à la racine du dépôt.
      //
      // Déclaré ici plutôt que corrigé en imports relatifs : la règle « `~/` désigne `src/` » vaut
      // dans tout le dépôt, et une moitié qui l'appliquerait sans l'autre se serait payée au
      // prochain import de valeur, sur un build et non sur un test.
      alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
    }),
    // Le plugin React doit venir APRÈS celui de Start.
    viteReact(),
  ],
})
