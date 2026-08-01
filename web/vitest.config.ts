import viteReact from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

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
    // `src/test/artefact/**` lit `dist/` : le ramasser ici ferait échouer la
    // suite unitaire sur un clone jamais construit. L'exclusion manquait, et
    // seul un `dist/` résiduel masquait le défaut en local.
    exclude: [...configDefaults.exclude, 'src/test/artefact/**'],

    /**
     * Les seuils avaient disparu au déménagement, sans un mot — une revue l'a
     * relevé. `perFile` et non agrégé : une moyenne masque exactement ce qu'on
     * veut voir, un module neuf à 40 % noyé dans une suite à 95 %.
     *
     * `include` explicite : sans lui, le fournisseur v8 ne rapporte que les
     * fichiers qu'un test a chargés, et un module que personne n'importe est
     * **absent** du rapport au lieu d'y figurer à zéro.
     */
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/routeTree.gen.ts',
        'src/test/**',
        // Câblage du navigateur : monté par aucun test par nature, couvert par
        // le parcours de bout en bout de step-007.
        'src/main.tsx',
        '**/*.{test,spec}.{ts,tsx}',
      ],
      thresholds: { perFile: true, lines: 88, branches: 78, functions: 85, statements: 88 },
    },
  },
})
