// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'

const CLE = 'une-cle-de-session-de-test-assez-longue'

afterEach(() => {
  vi.unstubAllEnvs()
  // Le cache vit dans le module : sans réinitialisation, le second test lirait la clé du premier.
  vi.resetModules()
})

describe('clés de session du process', () => {
  it('ne lit l environnement qu une fois', async () => {
    vi.stubEnv('AUTH_SESSION_SECRET', CLE)
    const { getSessionSecrets } = await import('./secrets')

    const premier = getSessionSecrets()
    vi.stubEnv('AUTH_SESSION_SECRET', 'une-tout-autre-cle-de-session-assez-longue')

    // Le même objet, pas seulement la même valeur : c'est ce qui prouve qu'il n'y a pas eu de
    // seconde lecture. Une clé qui changerait sous les pieds d'un process en vol invaliderait les
    // cookies déjà émis sans que personne ne l'ait demandé.
    expect(getSessionSecrets()).toBe(premier)
    expect(premier.current).toBe(CLE)
  })

  it('refuse de servir une clé absente plutôt que d en inventer une', async () => {
    vi.stubEnv('AUTH_SESSION_SECRET', '')
    const { getSessionSecrets } = await import('./secrets')

    // La validation vit dans `cookie.ts` ; ce qui se vérifie ici, c'est que le cache ne la
    // court-circuite pas — une clé de repli serait publique, donc signable par n'importe qui.
    expect(() => getSessionSecrets()).toThrow(/AUTH_SESSION_SECRET/)
  })
})
