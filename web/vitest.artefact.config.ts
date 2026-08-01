import { defineConfig } from 'vitest/config'

/**
 * Séparée de `vitest.config.ts` parce que ces tests lisent `dist/` : ils exigent
 * un build préalable, et les mêler à la suite unitaire ferait échouer celle-ci
 * sur un poste qui n'a jamais construit. `make verify-squelette` enchaîne les
 * deux dans le bon ordre.
 *
 * La distinction n'est pas cosmétique : une revue a montré que le test du
 * chargement à froid lisait la **source**, où l'invariant tient trivialement,
 * pendant que l'artefact livré le violait.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/test/artefact/**/*.test.ts'],
  },
})
