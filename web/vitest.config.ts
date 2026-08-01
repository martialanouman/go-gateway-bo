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
    },
  }),
)
