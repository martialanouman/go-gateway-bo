import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Séparée de `vite.config.ts` : les tests n'ont pas besoin du plugin de routage,
// et le charger rendrait chaque run plus lent pour rien.
//
// Un seul projet, là où la v1.0 en avait deux. Le projet `db` exerçait les
// migrations sur un vrai PostgreSQL ; cette moitié-là est passée en Go, avec
// testcontainers (step-005). Le client ne teste plus que du client.
export default defineConfig({
  plugins: [viteReact()],
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
