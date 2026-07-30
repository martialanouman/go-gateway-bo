// @vitest-environment node

/**
 * Invariant (c), en test bloquant : **aucune route de mutation du BFF sans garde ni audit**.
 *
 * ## Pourquoi ce test existe, et pourquoi il est bloquant
 *
 * Le jeton machine du BFF porte `content:read` en permanence (§1.3 du plan d'exécution). Une seule
 * route de mutation posée sans `requirePermission` suffit donc à ouvrir à tout opérateur ce que le
 * catalogue réserve à quelques-uns — et une route oubliée ne ressemble à rien : elle marche.
 *
 * La revue humaine n'attrape pas cet oubli, parce qu'il n'y a rien à voir. Une énumération, si.
 *
 * ## La source de vérité est `vite.config.ts`
 *
 * Les routes HTTP du BFF y sont déclarées (`nitroV2Plugin({ handlers })`) plutôt que posées sous
 * `src/routes/` — voir le commentaire sur place, c'est ce qui évite une exception de lint à
 * l'invariant (d). C'est donc là, et nulle part ailleurs, qu'on sait quelles routes existent. Lire
 * le répertoire des handlers ne suffirait pas : un fichier non déclaré n'est pas une route, et une
 * route peut être déclarée vers n'importe quel chemin.
 *
 * ## Ce que « gardée » veut dire ici, et ce que cela ne prouve pas
 *
 * Le test suit les imports internes du handler et cherche `requirePermission` ou `mutate` dans la
 * fermeture. Il établit donc qu'une garde est **atteignable** depuis cette route, pas qu'elle est
 * appelée sur tous les chemins. C'est la limite d'une analyse statique de cette taille, et elle est
 * du côté permissif : le test attrape l'oubli complet — le cas réel — pas la garde contournée par
 * une branche. Le second cas reste au ressort des tests de la route elle-même.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Les méthodes qui changent l'état. `get` et `head` n'ont rien à auditer. */
const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete'])

/** Ce qui, dans la fermeture d'imports d'un handler, atteste d'une garde puis d'un audit. */
const PERMISSION_MARKERS = ['requirePermission', 'mutate(']
const AUDIT_MARKERS = ['recordAudit', 'mutate(']

/**
 * Les routes de mutation qui n'ont **pas** de permission, et pourquoi.
 *
 * Ce sont les points d'entrée de l'authentification elle-même : ils s'adressent à quelqu'un qui
 * n'est pas encore autorisé, et exiger une permission pour se connecter serait circulaire. Chacune
 * porte sa propre garde, décrite ici — l'exemption dit ce qui protège, jamais « rien ».
 *
 * **Ajouter une entrée ici est une décision de sécurité.** Le fait qu'elle doive être écrite, avec
 * sa raison, est tout l'intérêt : c'est ce qui empêche l'exemption d'être le chemin de moindre
 * résistance quand une route protégée devient gênante à garder.
 */
const UNGUARDED_BY_DESIGN: Readonly<Record<string, string>> = {
  '/api/auth/login':
    'Point d’entrée d’authentification : gardé par le mot de passe et l’anti-brute-force (step-021), pas par une permission.',
  '/api/auth/logout':
    'Ferme la session de l’appelant et rien d’autre. Toujours 204, y compris sans session : il n’y a rien à autoriser.',
  '/api/auth/mfa/enroll':
    'Enrôlement du second facteur depuis une session partielle — l’état que `requirePermission` refuse par construction.',
  '/api/auth/mfa/verify':
    'Vérification du second facteur : c’est l’acte qui rend une session complète, il ne peut pas en exiger une.',
  '/api/auth/mfa/passkey/register':
    'Même cérémonie que l’enrôlement TOTP, gardée par la session et par la signature de l’authentificateur.',
  '/api/auth/mfa/passkey/verify':
    'Même acte que la vérification TOTP : il promeut la session, il ne peut pas la présupposer complète.',
  '/api/auth/mfa/passkeys/manage':
    'Gestion de ses propres facteurs, exigeant une session complète (`session.status !== "active"` refusé dans le handler) et gardée par la règle du dernier facteur.',
}

type Handler = {
  readonly route: string
  readonly handler: string
  readonly method: string
}

describe('routes du BFF', () => {
  const handlers = declaredHandlers()

  it('en déclare, sinon ce test ne garde rien', () => {
    // Sans cette vérification, un `vite.config.ts` restructuré ferait rendre un tableau vide à
    // l'analyse, et toutes les assertions suivantes passeraient sur zéro route.
    expect(handlers.length).toBeGreaterThan(0)
  })

  it('les lit toutes — un motif non reconnu vaudrait une route invisible', () => {
    // Une entrée écrite autrement que les autres serait silencieusement sautée par l'extraction,
    // donc jamais vérifiée. On compare donc au nombre d'occurrences de `handler:` dans le bloc.
    const occurrences = handlersBlock().match(/\bhandler:/g)?.length ?? 0

    expect(handlers.length).toBe(occurrences)
  })

  it('toute route de mutation est gardée par une permission, ou exemptée avec sa raison', () => {
    expect(offenders(handlers, PERMISSION_MARKERS)).toEqual([])
  })

  it('toute route de mutation gardée écrit au journal d’audit', () => {
    expect(offenders(handlers, AUDIT_MARKERS)).toEqual([])
  })
})

describe('exemptions', () => {
  const handlers = declaredHandlers()

  it('ne survivent pas à la route qu’elles couvraient', () => {
    // Une exemption orpheline est un piège à retardement : la route disparaît, l'entrée reste, et
    // le jour où le même chemin renaît — protégé, cette fois — elle le dispense en silence.
    const declared = new Set(handlers.map((entry) => entry.route))
    const orphans = Object.keys(UNGUARDED_BY_DESIGN).filter((route) => !declared.has(route))

    expect(orphans).toEqual([])
  })

  it('restent cantonnées à l’authentification', () => {
    // La seule famille de routes qui puisse légitimement se passer de permission est celle qui
    // s'adresse à un appelant pas encore autorisé. Poser cette frontière ici évite qu'une route
    // métier rejoigne la liste au milieu de quinze autres sans que cela saute aux yeux.
    const outsiders = Object.keys(UNGUARDED_BY_DESIGN).filter(
      (route) => !route.startsWith('/api/auth/'),
    )

    expect(outsiders).toEqual([])
  })

  it('portent toutes une justification, et pas un mot', () => {
    const thin = Object.entries(UNGUARDED_BY_DESIGN)
      .filter(([, reason]) => reason.trim().length < 40)
      .map(([route]) => route)

    expect(thin).toEqual([])
  })
})

describe('le détecteur se prouve lui-même', () => {
  // Sans ces deux cas, une extraction cassée ou un `reaches` toujours vrai rendraient les
  // assertions précédentes vertes à jamais — le pire des modes d'échec pour un test bloquant.

  it('extrait route, handler et méthode d’une déclaration fabriquée', () => {
    const source = `nitroV2Plugin({ handlers: [
      { route: '/api/customers', handler: './src/server/customers/http/create.ts', method: 'post' },
    ] })`

    expect(parseHandlers(source)).toEqual([
      {
        route: '/api/customers',
        handler: './src/server/customers/http/create.ts',
        method: 'post',
      },
    ])
  })

  it('signale une route de mutation non gardée déclarée pour de bon', () => {
    // **Le cas que la step demande explicitement**, joué de bout en bout : une déclaration de route
    // complète, passée par l'extraction puis par la détection, exactement comme celles de
    // `vite.config.ts`. Les deux cas précédents éprouvent les pièces séparément ; celui-ci éprouve
    // la chaîne — une extraction correcte branchée sur une détection correcte peut encore ne rien
    // signaler si le filtrage entre les deux est faux.
    const source = `handlers: [
      { route: '/api/customers', handler: './src/test/fixtures/route-nue.ts', method: 'post' },
      { route: '/api/customers/list', handler: './src/test/fixtures/route-gardee.ts', method: 'get' },
    ]`

    const fabricated = parseHandlers(source)
    expect(fabricated).toHaveLength(2)

    // La route gardée est en `get` : elle ne mute pas, donc elle n'a rien à prouver. Seule la
    // mutation nue doit remonter — sur la permission comme sur l'audit.
    expect(offenders(fabricated, PERMISSION_MARKERS)).toEqual([
      'POST /api/customers → ./src/test/fixtures/route-nue.ts',
    ])
    expect(offenders(fabricated, AUDIT_MARKERS)).toEqual([
      'POST /api/customers → ./src/test/fixtures/route-nue.ts',
    ])
  })

  it('ne signale pas une route de mutation correctement gardée', () => {
    // Le pendant du cas précédent : un détecteur qui crierait sur tout serait tout aussi inutile,
    // et se ferait désarmer à la première route légitime.
    const source = `handlers: [
      { route: '/api/customers', handler: './src/test/fixtures/route-gardee.ts', method: 'post' },
    ]`

    expect(offenders(parseHandlers(source), PERMISSION_MARKERS)).toEqual([])
    expect(offenders(parseHandlers(source), AUDIT_MARKERS)).toEqual([])
  })

  it('voit une garde atteinte par un import indirect, et son absence', () => {
    const guarded = join(ROOT, 'src', 'test', 'fixtures', 'route-gardee.ts')
    const bare = join(ROOT, 'src', 'test', 'fixtures', 'route-nue.ts')

    expect(reaches(guarded, PERMISSION_MARKERS)).toBe(true)
    expect(reaches(guarded, AUDIT_MARKERS)).toBe(true)
    // Le cas fabriqué que la step demande : une route de mutation qui ne garde rien.
    expect(reaches(bare, PERMISSION_MARKERS)).toBe(false)
    expect(reaches(bare, AUDIT_MARKERS)).toBe(false)
  })
})

/**
 * Les routes de mutation qui n'atteignent pas les marqueurs, hors exemptions.
 *
 * Extraite en fonction pour être exerçable sur une déclaration fabriquée : la vérification qui
 * compte n'est pas « l'extraction marche » ni « la détection marche », mais que les deux, branchées
 * l'une sur l'autre, signalent bien une route nue. Le filtrage entre les deux est l'endroit où une
 * erreur rendrait le test vert à jamais.
 */
function offenders(entries: readonly Handler[], markers: readonly string[]): string[] {
  return entries
    .filter((entry) => MUTATING_METHODS.has(entry.method))
    .filter((entry) => !(entry.route in UNGUARDED_BY_DESIGN))
    .filter((entry) => !reaches(entry.handler, markers))
    .map((entry) => `${entry.method.toUpperCase()} ${entry.route} → ${entry.handler}`)
}

/** Le contenu du bloc `handlers: [ … ]` de `vite.config.ts`. */
function handlersBlock(): string {
  const source = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')
  const start = source.indexOf('handlers: [')
  if (start < 0) return ''

  const end = source.indexOf('\n      ],', start)
  return end < 0 ? source.slice(start) : source.slice(start, end)
}

function declaredHandlers(): Handler[] {
  return parseHandlers(handlersBlock())
}

/**
 * Extrait les déclarations d'un bloc.
 *
 * Chaque entrée est un objet plat sans accolade imbriquée, ce qui rend l'expression régulière
 * suffisante — et le test de comptage ci-dessus garantit qu'aucune entrée ne lui échappe.
 */
function parseHandlers(source: string): Handler[] {
  return [...source.matchAll(/\{[^{}]*\bhandler:[^{}]*\}/g)].flatMap((match) => {
    const entry = match[0]
    const route = field(entry, 'route')
    const handler = field(entry, 'handler')
    const method = field(entry, 'method')

    return route && handler && method ? [{ route, handler, method }] : []
  })
}

function field(entry: string, name: string): string | undefined {
  return new RegExp(`\\b${name}:\\s*'([^']+)'`).exec(entry)?.[1]
}

/**
 * Vrai si l'un des marqueurs apparaît dans le fichier ou dans sa fermeture d'imports internes.
 *
 * Même parcours que `frontiere-serveur.test.ts`, et pour la même raison : ce qui compte n'est pas ce
 * que le fichier écrit lui-même, mais ce que son code atteint.
 */
function reaches(entryPoint: string, markers: readonly string[]): boolean {
  const start = entryPoint.startsWith('.') ? resolve(ROOT, entryPoint) : entryPoint
  const seen = new Set<string>()
  const queue = [start]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || seen.has(current)) continue
    seen.add(current)

    const source = read(current)
    if (source === undefined) continue
    if (markers.some((marker) => source.includes(marker))) return true

    queue.push(...internalImportsOf(current, source))
  }

  return false
}

function internalImportsOf(file: string, source: string): string[] {
  const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1] ?? match[2])
    .filter((specifier): specifier is string => specifier !== undefined)

  return specifiers.flatMap((specifier) => {
    const base = specifier.startsWith('~/')
      ? join(ROOT, 'src', specifier.slice(2))
      : specifier.startsWith('.')
        ? resolve(dirname(file), specifier)
        : undefined

    return base ? resolveSource(base) : []
  })
}

function resolveSource(base: string): string[] {
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    base,
  ]

  return candidates.filter((candidate) => read(candidate) !== undefined).slice(0, 1)
}

function read(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}
