// @vitest-environment node

/**
 * **Aucun écran orphelin** — une route sous `_shell` qu'aucune entrée du rail n'atteint.
 *
 * `src/routes/ecrans-declares.test.tsx` couvre le sens direct : une entrée de navigation sans route
 * fait rougir son `it.each`. Le sens inverse ne l'était pas — l'écran existe, il est inatteignable
 * au clic, et rien ne le signale. Une version précédente de ce test asserait
 * `NAV_ENTRIES.length > 0`, ce qui ne couvrait rien tout en revendiquant cette couverture.
 *
 * Il vit ici et non dans `src/routes/` : il lit le disque, et la règle de lint de l'invariant (d)
 * refuse — à raison — un import de `node:fs` depuis le répertoire du code client. C'est elle qui a
 * signalé le mauvais emplacement.
 */

import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { NAV_ENTRIES } from '~/components/shell'

const ROUTES = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'routes')

describe('écrans sous la coquille', () => {
  it('sont tous atteignables depuis le rail', () => {
    const screens = readdirSync(ROUTES)
      // `_shell.tsx` est la mise en page, pas un écran : sans cette exclusion, elle se présentait
      // comme une route `/` orpheline.
      .filter((name) => name.startsWith('_shell.') && name.endsWith('.tsx'))
      .filter((name) => name !== '_shell.tsx')
      .map((name) => `/${name.slice('_shell.'.length, -'.tsx'.length)}`)

    const reachable = new Set(NAV_ENTRIES.map((entry) => entry.to))

    expect(screens.filter((screen) => !reachable.has(screen))).toEqual([])
  })

  it('en trouve, sinon ce test ne garde rien', () => {
    const screens = readdirSync(ROUTES).filter(
      (name) => name.startsWith('_shell.') && name !== '_shell.tsx',
    )

    expect(screens.length).toBeGreaterThan(0)
  })
})
