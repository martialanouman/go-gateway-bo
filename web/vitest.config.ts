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
        // ce qu'aucun test ne doit couvrir : ce qui est engendré par `make generate`, et les
        // assertions de type, qu'aucun runner n'exécute — c'est `tsc --noEmit` qui les juge.
        exclude: ['src/**/*.gen.ts', 'src/**/*.test-d.ts'],

        // `text` seul : la lecture se fait dans le terminal, et rien n'est écrit sur le disque.
        reporter: ['text'],

        // Des planchers anti-régression, jamais une cible : chaque valeur est la mesure du jour la
        // plus basse, et monter l'une d'un point fait rougir la porte — vérifié. Les 25 % manquants
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
