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
        // vitest@4.1.10 — et le fournisseur v8 ne rapporte que ce qu'un test a chargé : un module
        // que personne n'importe serait absent du rapport, pas à zéro. Mesuré le 03/08/2026 sur un
        // module orphelin temporaire : absent sans cette ligne, à 0 % avec elle.
        include: ['src/**/*.{ts,tsx}'],

        // `test-setup.ts`, les fichiers de `test.include` et les fichiers de configuration sont
        // ajoutés par Vitest à cette liste, qui est purement additive. Ne restent donc à écrire que
        // ce qu'aucun test ne doit couvrir : le code **engendré**, et les assertions de type,
        // qu'aucun runner n'exécute — c'est `tsc --noEmit` qui les juge. Le motif `*.gen.ts` couvre
        // deux origines et deux portes, ce qui est voulu : `api.gen.ts` et `permissions.gen.ts`
        // viennent de `make generate` et sont tenus par `check-generated` ; `routeTree.gen.ts` vient
        // du plugin TanStack pendant `build-web` et est tenu par `check-routes`.
        exclude: ['src/**/*.gen.ts', 'src/**/*.test-d.ts'],

        // Le **tableau** doit lister les mêmes fichiers quel que soit le lecteur. Vitest 4.1.10 force
        // `skipFull` sur le reporter `text` dès qu'il détecte un agent — `if (isAgent) { text[1] =
        // { skipFull: true, ...text[1] } }` dans `vitest/dist/chunks/coverage.*.js`, `isAgent` venant
        // de `std-env`, qui le déduit de `AI_AGENT` puis d'une table où figurent `CLAUDECODE` et
        // `CLAUDE_CODE`. L'option écrite ici est spreadée **après** le défaut, donc elle gagne.
        //
        // Ce que ça évite, mesuré le 03/08/2026 en retirant cette ligne : lu par un agent, le tableau
        // perd `main.tsx` et `router.ts`, tous deux à 100 %, et n'en montre plus que deux. Un
        // relecteur en a conclu que `perFile` ne contraignait que deux fichiers ; il en contraint
        // quatre — même date, `src/main.test.tsx` écarté du run, les `ERROR` tombent aussi sur
        // `src/main.tsx` et `src/router.ts`.
        //
        // Rien ne **survit** au run, ce qui n'est pas dire que rien n'est écrit : le fournisseur v8
        // dépose `coverage/.tmp/coverage-N.json` pendant l'exécution — observés, `coverage-0` à
        // `coverage-3` — et les supprime en sortant.
        reporter: [['text', { skipFull: false }]],

        // Des planchers anti-régression, jamais une cible : chaque valeur est la mesure du jour, et
        // aucune n'a de marge — vérifié le 03/08/2026, un point de plus rougit partout où il reste un
        // point à prendre (`lines=76` et `statements=76` sur `__root.tsx` et `index.tsx`,
        // `branches=81` sur `index.tsx`), et `functions` est déjà au plafond de 100. Les 25 % manquants
        // de `__root.tsx` et `index.tsx` ne sont pas du code non exercé mais ce que la cartographie
        // de v8 y rattache : l'accolade fermante du composant pour l'un, l'ouverture d'un bloc de
        // commentaire pour l'autre. `perFile` parce qu'un seuil global se laisse tenir par la
        // moyenne : mesuré sur un module orphelin d'une ligne, les quatre seuils globaux passaient.
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
