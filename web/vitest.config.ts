import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// La configuration de test hérite de celle du bundle : les tests de composant traversent les mêmes
// alias et les mêmes plugins que le code livré. Un harnais qui résout autrement testerait autre chose.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // jsdom par défaut, pour les composants. Les tests qui décrivent le document servi déclarent
      // `// @vitest-environment node` en tête de fichier.
      environment: 'jsdom',
      globals: false,
      setupFiles: ['./src/test-setup.ts'],
      include: ['**/*.test.{ts,tsx}'],
      exclude: ['node_modules/**', 'dist/**'],

      coverage: {
        // Activée dans la configuration plutôt que par un drapeau : le job `test-web` lance
        // `vitest run`, et une porte de couverture qu'il faut penser à demander ne garde rien.
        enabled: true,

        // Le point de la porte. Sans `include`, `getUntestedFiles` rend `[]` — vérifié dans
        // vitest@4.1.10 — et le fournisseur v8 ne rapporte que ce qu'un test a chargé : un module que
        // personne n'importe serait absent du rapport, pas à zéro. Mesuré sur un module orphelin :
        // absent sans cette ligne, à 0 % avec elle.
        include: ['src/**/*.{ts,tsx}'],

        // `test-setup.ts`, les fichiers de `test.include` et les fichiers de configuration sont
        // ajoutés par Vitest à cette liste, purement additive. Ne restent à écrire que le code
        // **engendré** et les assertions de type, qu'aucun runner n'exécute.
        //
        // `__root.tsx` est une exemption **de mesure**, pas de test : le fichier est exercé à 100 %
        // en lignes, en fonctions et en branches, mais son unique `createRootRoute({…})` compte deux
        // statements pour v8, dont un seul couvert — **50 %** quoi qu'on fasse. Abaisser le seuil pour
        // tout le monde était l'autre issue, que la DoD interdit nommément. **À retirer dès que ce
        // fichier reportera du code** — un `errorComponent`, un `beforeLoad` : il redeviendrait
        // mesurable, et l'exemption le couvrirait alors en silence.
        exclude: ['src/**/*.gen.ts', 'src/**/*.test-d.ts', 'src/routes/__root.tsx'],

        // Le **tableau** doit lister les mêmes fichiers quel que soit le lecteur. Vitest 4.1.10 force
        // `skipFull` sur le reporter `text` dès qu'il détecte un agent — `if (isAgent) { text[1] =
        // { skipFull: true, ...text[1] } }` dans `vitest/dist/chunks/coverage.*.js`, `isAgent` venant
        // de `std-env`, qui le déduit de `AI_AGENT` puis d'une table où figurent `CLAUDECODE` et
        // `CLAUDE_CODE`. L'option écrite ici est spreadée **après** le défaut, donc elle gagne.
        //
        // Sans elle, un lecteur agent voit un tableau amputé des fichiers à 100 %, et conclut que
        // `perFile` contraint moins de fichiers qu'il n'en contraint.
        reporter: [['text', { skipFull: false }]],

        // Des planchers anti-régression, jamais une cible : aucun n'a de marge, un point de plus
        // rougit. Ce qui manque n'est pas du code non exercé mais ce que la cartographie de v8
        // rattache à une accolade fermante ou à l'ouverture d'un bloc de commentaire. `perFile` parce
        // qu'un seuil global se laisse tenir par la moyenne : mesuré sur un module orphelin d'une
        // ligne, les quatre seuils globaux passaient.
        thresholds: {
          perFile: true,
          lines: 75,
          statements: 75,
          branches: 80,
          functions: 100,
        },
      },
    },
  }),
)
