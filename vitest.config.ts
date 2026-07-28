import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Config volontairement séparée de `vite.config.ts` : les tests n'ont besoin ni du plugin Start ni
// de Nitro (ils ne construisent pas de serveur), et les charger rendrait chaque run plus lent et
// plus fragile pour rien.
export default defineConfig({
  plugins: [viteReact()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // jsdom pour les composants ; les tests du BFF déclareront `// @vitest-environment node`.
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/routeTree.gen.ts', 'src/test/**', 'src/**/*.{test,spec}.{ts,tsx}'],
    },
  },
})
