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
    /**
     * `pnpm coverage` exécute **les deux projets en une passe**, et c'est la seule mesure qui
     * reflète la réalité : le code du BFF qui touche la base est exercé par le projet `db`, et une
     * couverture mesurée sur `unit` seul le déclarerait mort. Deux îlots séparés auraient poussé
     * soit à exclure ce qui manque, soit à écrire des tests unitaires redondants pour regagner des
     * points — deux façons de dégrader la suite pour flatter un chiffre.
     */
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/routeTree.gen.ts', // généré par le build, vérifié par la CI
        'src/test/**', // le harnais lui-même
        'src/**/*.{test,spec}.{ts,tsx}',
        // Déclarations Drizzle pures : des appels `pgTable(...)`, aucune branche. Les couvrir ne
        // dirait rien de ce qui compte — qu'une cascade `onDelete` fasse ce qu'elle annonce se
        // prouve par un test de comportement dans le projet `db`, jamais par un pourcentage.
        // Corollaire à tenir : **aucune fonction dans ce répertoire**. Le jour où une valeur par
        // défaut calculée ou un type de colonne sur mesure y apparaît, cette logique sort de la
        // mesure sans que personne ne le voie — elle doit vivre à côté, pas dans le schéma.
        'src/server/db/schema/**',
        // Point d'entrée d'exploitation (`pnpm db:seed`, `pnpm auth:bootstrap`). Il ne décide rien :
        // il lit `process.argv`, appelle des fonctions testées ailleurs, choisit un code de sortie.
        // Le couvrir exigerait de lancer un processus par cas pour n'exercer que de la plomberie.
        // Corollaire à tenir, identique à celui du répertoire de schéma : **aucune règle métier ici**.
        // Le jour où ce fichier décide quelque chose — un ordre d'appel conditionnel, une validation —
        // cette logique sort de la mesure sans que personne ne le voie et doit vivre à côté.
        'src/server/auth/cli.ts',
      ],
      thresholds: {
        /**
         * **`perFile`, et c'est tout l'intérêt.** Un seuil agrégé est une moyenne, et une moyenne
         * masque exactement ce qu'on veut voir : un nouveau module de permissions à 40 % passerait
         * derrière un client Admin à 96 %, alors que ses lignes non couvertes seraient les chemins
         * de refus et les échecs d'écriture d'audit — ce que les invariants (a) et (c) exigent de
         * garder. Un seuil par glob n'aurait pas suffi : il est agrégé par défaut, et la doc de
         * Vitest annonce bien un `perFile` déclarable à l'intérieur d'un glob — mais le typage de
         * la version installée (4.1.10) le refuse. `perFile` global est donc le seul chemin
         * praticable aujourd'hui ; à revoir si une version ultérieure aligne le typage sur la doc,
         * car un plancher différencié sous `src/server/**` serait plus juste.
         *
         * Les valeurs sont le plancher de **chaque** fichier mesuré. Elles montent avec les steps ;
         * elles ne redescendent pas. Un fichier qui ne peut honnêtement pas les tenir se justifie
         * par un `v8 ignore` commenté, jamais en abaissant le seuil pour tout le monde.
         */
        perFile: true,
        lines: 88,
        branches: 78,
        functions: 85,
        statements: 88,
      },
    },
  },
})
