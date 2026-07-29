// @vitest-environment node

/**
 * Invariant (d), en test bloquant.
 *
 * La règle Biome `noRestrictedImports` refuse déjà l'import direct de `~/server/...` depuis le code
 * client. Elle a deux angles morts qu'un linter ne peut pas couvrir :
 *
 * 1. **La chaîne transitive.** `src/components/Foo.tsx` importe `~/lib/utils`, qui importe
 *    `~/server/gateway`. Chaque import pris isolément est innocent ; le bundle navigateur reçoit
 *    quand même le client Admin.
 * 2. **Le désarmement.** Un `// biome-ignore` sur une ligne suffit à ouvrir la porte, et personne
 *    ne le remarque à la revue.
 *
 * Ce test suit les imports internes de proche en proche depuis chaque fichier client et échoue si
 * l'un d'eux atteint `src/server/`. Il montre le chemin complet, parce que « ce fichier importe du
 * serveur » sans dire par où est une énigme plutôt qu'un diagnostic.
 */

import { type Dirent, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Le code qui part dans le navigateur. `src/test/` est un harnais, il ne se déploie pas. */
const CLIENT_DIRECTORIES = ['routes', 'components', 'lib', 'styles']

const SOURCE_EXTENSIONS = ['.ts', '.tsx']

/**
 * Les *server routes* de TanStack Start (`src/routes/api/`).
 *
 * Elles doivent vivre sous `src/routes/` — c'est le routage par fichiers qui leur donne leur URL —
 * mais elles sont du code serveur : leurs handlers sont retirés du bundle client, et elles ont
 * légitimement besoin du BFF. La règle Biome les exclut donc, et ce fichier aussi.
 *
 * L'exception ouvre une porte : un composant React glissé dans ce dossier ferait entrer les imports
 * serveur dans le bundle sans que rien ne le signale. Le `describe` du bas la referme.
 */
const SERVER_ROUTES = join(SRC, 'routes', 'api') + sep

describe('frontière client / serveur', () => {
  it("aucun fichier client n'atteint src/server/, même indirectement", () => {
    const offenders = CLIENT_DIRECTORIES.flatMap((directory) =>
      sourceFilesIn(join(SRC, directory))
        .filter((file) => !file.startsWith(SERVER_ROUTES))
        .flatMap((file) => {
          const path = pathToServer(file)
          return path ? [path.map((step) => relative(SRC, step)).join('\n     → ')] : []
        }),
    )

    expect(offenders).toEqual([])
  })

  it('détecte bien une chaîne transitive — le test se prouve lui-même', () => {
    // Sans cette vérification, un `pathToServer` cassé rendrait le test précédent vert à jamais.
    const chain = new Map<string, string[]>([
      ['/src/components/Foo.tsx', ['/src/lib/utils.ts']],
      ['/src/lib/utils.ts', ['/src/server/gateway/index.ts']],
    ])

    expect(walk('/src/components/Foo.tsx', (file) => chain.get(file) ?? [])).toEqual([
      '/src/components/Foo.tsx',
      '/src/lib/utils.ts',
      '/src/server/gateway/index.ts',
    ])
  })
})

/** Rend le chemin d'import complet jusqu'à `src/server/`, ou `undefined` s'il n'y en a pas. */
function pathToServer(file: string): string[] | undefined {
  return walk(file, internalImportsOf)
}

function walk(start: string, importsOf: (file: string) => string[]): string[] | undefined {
  const seen = new Set<string>()
  const queue: string[][] = [[start]]

  while (queue.length > 0) {
    const trail = queue.shift()
    const current = trail?.at(-1)
    if (!trail || !current || seen.has(current)) continue
    seen.add(current)

    for (const next of importsOf(current)) {
      if (isUnderServer(next)) return [...trail, next]
      queue.push([...trail, next])
    }
  }

  return undefined
}

function isUnderServer(file: string): boolean {
  return file.replaceAll('\\', '/').includes('/src/server/')
}

/**
 * Les imports que ce dépôt possède : l'alias `~/...` et les chemins relatifs. Un paquet npm n'est
 * pas suivi — il ne peut pas, lui, remonter jusqu'à `src/server/`.
 */
function internalImportsOf(file: string): string[] {
  let source: string
  try {
    source = readFileSync(file, 'utf8')
  } catch {
    return []
  }

  const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1] ?? match[2])
    .filter((specifier): specifier is string => specifier !== undefined)

  return specifiers.flatMap((specifier) => {
    const base = specifier.startsWith('~/')
      ? join(SRC, specifier.slice(2))
      : specifier.startsWith('.')
        ? resolve(dirname(file), specifier)
        : undefined

    if (!base) return []

    // **La traversée s'arrête aux routes serveur**, et cela demande justification :
    // `routeTree.gen.ts` référence *toutes* les routes, server routes comprises, si bien que
    // n'importe quel écran atteindrait `src/server/` par ce chemin. C'est un artefact de l'arbre
    // généré, pas une fuite — le bundler retire les handlers serveur du bundle client.
    //
    // Couper ici n'est sûr que parce que le `describe('routes serveur')` plus bas garantit que ce
    // dossier ne contient **que** des handlers, aucun composant. Les deux gardes ne valent
    // qu'ensemble : retirer l'une rend l'autre trompeuse.
    return resolveSource(base).filter((resolved) => !resolved.startsWith(SERVER_ROUTES))
  })
}

/** Un import n'écrit pas son extension : `~/lib/utils` peut être `.ts`, `.tsx` ou un dossier. */
function resolveSource(base: string): string[] {
  const candidates = [
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ]

  return candidates.filter(exists).slice(0, 1)
}

function exists(path: string): boolean {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

function sourceFilesIn(directory: string): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }

  return entries.flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFilesIn(path)
    return SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension)) ? [path] : []
  })
}

/**
 * La contrepartie de l'exception accordée à `src/routes/api/`.
 *
 * Une exception sans garde est une porte de service. Ces trois vérifications tiennent lieu de
 * serrure, et elles vivent **hors de la configuration du linter** : une garde qui dépend du réglage
 * qu'elle protège ne protège rien.
 */
describe('routes serveur', () => {
  const files = sourceFilesIn(SERVER_ROUTES)

  it('en déclare au moins une, sinon rien n’est gardé ici', () => {
    // Un parcours de dossier vide passe toujours. Le dire évite que cette garde devienne muette le
    // jour où le dossier serait renommé.
    expect(files.length).toBeGreaterThan(0)
  })

  it("ne contient aucun composant : ce dossier n'atteint jamais le navigateur", () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8')
      return (
        /from ['"]react['"]/.test(source) || /\bcomponent\s*:/.test(source) || file.endsWith('.tsx')
      )
    })

    expect(offenders.map((file) => relative(SRC, file))).toEqual([])
  })

  it('ne déclare que des handlers de méthode HTTP', () => {
    // Le corollaire positif : un fichier de ce dossier qui n'a pas de `server.handlers` n'est pas
    // une route serveur, et n'a donc rien à faire sous cette exception.
    const offenders = files.filter((file) => !readFileSync(file, 'utf8').includes('handlers'))

    expect(offenders.map((file) => relative(SRC, file))).toEqual([])
  })
})
