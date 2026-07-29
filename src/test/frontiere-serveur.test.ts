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
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Le code qui part dans le navigateur. `src/test/` est un harnais, il ne se déploie pas. */
const CLIENT_DIRECTORIES = ['routes', 'components', 'lib', 'styles']

const SOURCE_EXTENSIONS = ['.ts', '.tsx']

describe('frontière client / serveur', () => {
  it("aucun fichier client n'atteint src/server/, même indirectement", () => {
    const offenders = CLIENT_DIRECTORIES.flatMap((directory) =>
      sourceFilesIn(join(SRC, directory)).flatMap((file) => {
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

    return base ? resolveSource(base) : []
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
 * Les coquilles HTTP du BFF sont exclues de la mesure de couverture (`vitest.config.ts`) au motif
 * qu'elles ne décident rien. Une exclusion sans garde est une porte de service : ce bloc en tient
 * lieu, et il vit **hors** de la configuration qu'il protège.
 */
describe('coquilles HTTP du BFF', () => {
  const HTTP_HANDLERS = join(SRC, 'server', 'auth', 'http')
  const files = sourceFilesIn(HTTP_HANDLERS)

  it('en déclare au moins une, sinon rien n’est gardé ici', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('ne lit jamais un en-tête qui laisserait l’appelant choisir son adresse', () => {
    // `x-real-ip` est fourni par le client au même titre que `x-forwarded-for`. Le lire rendrait le
    // compteur par adresse inutile — l'attaquant changerait de clé à chaque requête. C'est le trou
    // qu'une revue a trouvé dans la première version de ce handler ; cette garde le referme, et elle
    // porte sur le seul endroit où la décision se prend.
    const offenders = files.filter((file) => /x-real-ip/i.test(readFileSync(file, 'utf8')))

    expect(offenders.map((file) => relative(SRC, file))).toEqual([])
  })

  it('n’exporte qu’un handler par défaut, sans logique d’authentification', () => {
    // Le corollaire de l'exclusion : ces fichiers appellent, ils ne décident pas. Un `export` nommé
    // y signalerait de la logique réutilisable — donc à tester, donc à sortir de l'exclusion.
    const offenders = files.filter((file) =>
      /^export (const|function|type|class) /m.test(readFileSync(file, 'utf8')),
    )

    expect(offenders.map((file) => relative(SRC, file))).toEqual([])
  })
})
