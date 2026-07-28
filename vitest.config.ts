import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Config volontairement séparée de `vite.config.ts` : les tests n'ont besoin ni du plugin Start ni
// de Nitro (ils ne construisent pas de serveur), et les charger rendrait chaque run plus lent et
// plus fragile pour rien.
//
// Deux projets, parce qu'ils n'ont pas le même prix :
//
// - `unit` — la boucle de travail. Quelques centaines de millisecondes, aucune dépendance externe.
//   C'est ce que lance `pnpm test`, et ce qu'on garde en watch.
// - `db` — les tests qui appliquent les migrations sur un vrai PostgreSQL 18 démarré par
//   Testcontainers. Quelques secondes, et Docker requis.
//
// `db` est hors de `pnpm test` mais **dans `pnpm check`**, qui est la porte de la Definition of
// Done : la suite tourne donc à chaque PR par construction, et « check vert en local prédit une CI
// verte » reste vrai. Ce qu'il ne faut surtout pas faire, c'est la sauter quand Docker manque — une
// suite qui se saute en silence se lit comme une suite qui passe.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [viteReact()],
        resolve: { tsconfigPaths: true },
        test: {
          name: 'unit',
          globals: true,
          setupFiles: ['./src/test/setup.ts'],
          // jsdom pour les composants ; les tests du BFF déclarent `// @vitest-environment node`.
          environment: 'jsdom',
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          exclude: ['src/**/*.db.{test,spec}.ts'],
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: 'db',
          environment: 'node',
          include: ['src/**/*.db.{test,spec}.ts'],
          // Localise le démon Docker avant que Testcontainers ne le cherche au mauvais endroit.
          globalSetup: ['./src/test/docker-host.ts'],
          // Démarrer PostgreSQL prend quelques secondes ; le premier run télécharge l'image.
          testTimeout: 60_000,
          hookTimeout: 180_000,
          // Une seule suite à la fois : deux fichiers concurrents appliqueraient les mêmes
          // migrations sur la même base.
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/routeTree.gen.ts', 'src/test/**', 'src/**/*.{test,spec}.{ts,tsx}'],
    },
  },
})
