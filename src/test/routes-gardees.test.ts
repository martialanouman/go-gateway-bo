// @vitest-environment node

/**
 * Invariant (c), en test bloquant : **aucune route de mutation du BFF sans garde ni audit**.
 *
 * ## Pourquoi ce test existe
 *
 * Le jeton machine du BFF porte `content:read` en permanence (§1.3 du plan d'exécution). Une seule
 * route de mutation posée sans `requirePermission` suffit donc à ouvrir à tout opérateur ce que le
 * catalogue réserve à quelques-uns — et une route oubliée ne ressemble à rien : elle marche. La
 * revue humaine n'attrape pas cet oubli, parce qu'il n'y a rien à voir. Une énumération, si.
 *
 * ## La détection porte sur les imports, pas sur le texte
 *
 * La première version cherchait les chaînes `requirePermission` et `mutate(` dans le texte des
 * fichiers atteints. Elle ne bloquait **rien** : le mot `requirePermission` figure dans les
 * doc-comments de `guard.ts`, `me.ts` et `resolve.ts`, et `webauthn-credentials.ts` porte une
 * fonction privée nommée `mutate`. Comme tout handler importe `resolveSession` depuis `guard.ts`,
 * `logout.ts` — qui ne contient pas une ligne d'autorisation — était déclaré gardé **et** audité.
 * Le filet était troué avant d'avoir servi.
 *
 * La version actuelle résout les `import` du **handler lui-même** jusqu'au fichier visé, et regarde
 * si c'est un module d'`src/server/authz/` et quel symbole en est tiré. Un commentaire ne peut plus
 * compter, un homonyme local non plus, et un `import type` est écarté : un type ne garde rien.
 *
 * ## Pas de transitivité, et c'est une convention assumée
 *
 * Suivre la fermeture d'imports refermait le trou du texte et rouvrait le même un cran plus loin :
 * un handler qui importe un module de service — lequel utilise `mutate` pour d'autres fonctions —
 * était crédité sans appeler la moindre garde. Le détecteur exige donc l'import **dans la fonction
 * serveur**, ce que `CLAUDE.md` demande déjà (« `requirePermission()` dans la fonction serveur »).
 * Un handler qui délègue sa garde est signalé ; le remède est de remonter l'appel d'un cran.
 *
 * ## Ce que cela ne prouve toujours pas
 *
 * Qu'une garde importée soit **appelée**. Un handler qui appelle `requirePermission` et jette le
 * résultat passe — le refus est une valeur, pas une exception. Fermer ce cas demanderait un graphe
 * d'appels, donc l'AST de TypeScript. Le test attrape l'oubli complet, qui est le cas réel.
 *
 * ## Deux angles morts à porter
 *
 * 1. Seules les **routes HTTP** sont énumérées. Les fonctions serveur TanStack (`createServerFn`,
 *    zéro occurrence à ce jour) et les commandes du hub WebSocket (step-043) obtiennent leur point
 *    d'entrée autrement. À couvrir quand la première apparaîtra.
 * 2. **Le filet travaille depuis la step-027.** Il a été écrit au-dessus d'un sol vide — les sept
 *    routes de mutation d'alors étaient les sept exemptions de l'authentification, et les deux
 *    assertions centrales portaient sur une liste vide. Les six routes de l'annuaire sont les
 *    premières qu'il éprouve réellement : retirer l'import de `mutate` d'un seul de leurs handlers
 *    le fait rougir, ce qui a été vérifié plutôt que supposé.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BFF_ROUTES, type BffRoute } from '~/server/bff-routes'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = join(ROOT, 'src')

/** Les méthodes qui changent l'état. `get` et `head` n'ont rien à auditer. */
const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete'])

/**
 * Les symboles d'`src/server/authz/` qui attestent d'une garde, puis d'un audit.
 *
 * `mutate` figure dans les deux : c'est le combinateur qui vérifie la permission **et** écrit la
 * ligne d'audit dans la même transaction, donc il satisfait les deux exigences à lui seul.
 */
const PERMISSION_SYMBOLS = new Set(['requirePermission', 'mutate'])
const AUDIT_SYMBOLS = new Set(['recordAudit', 'mutate'])

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
type Exemption = {
  /** Ce qui protège la route à la place d'une permission. Jamais « rien ». */
  readonly reason: string
  /** Le symbole dont l'import atteste cette garde : `<module>` sous `src/server/auth/`. */
  readonly guardedBy: { readonly module: string; readonly symbol: string }
}

const UNGUARDED_BY_DESIGN: Readonly<Record<string, Exemption>> = {
  '/api/auth/login': {
    reason:
      'Point d’entrée d’authentification : gardé par le mot de passe et l’anti-brute-force (step-021), pas par une permission. Il ne résout aucune session — il en ouvre une.',
    guardedBy: { module: 'login', symbol: 'createLoginService' },
  },
  '/api/auth/logout': {
    reason:
      'Ferme la session de l’appelant et rien d’autre. Toujours 204, y compris sans session : il n’y a rien à autoriser.',
    guardedBy: { module: 'guard', symbol: 'resolveSession' },
  },
  '/api/auth/mfa/enroll': {
    reason:
      'Enrôlement du second facteur : refuse une session absente, et refuse d’enrôler quand un facteur existe déjà sans avoir été franchi (`noOtherFactorFrom`). Il ne peut pas exiger la session complète qu’il sert à obtenir.',
    guardedBy: { module: 'guard', symbol: 'resolveSession' },
  },
  '/api/auth/mfa/verify': {
    reason:
      'Vérification du second facteur : n’accepte qu’une session partielle, et c’est l’acte qui la rend complète. Il ne peut pas en exiger une.',
    guardedBy: { module: 'guard', symbol: 'resolveSession' },
  },
  '/api/auth/mfa/passkey/register': {
    reason:
      'Enregistrement d’un appareil : refuse une session absente, refuse l’ajout quand un facteur existe sans avoir été franchi, et vérifie la signature de l’authentificateur à la phase finale.',
    guardedBy: { module: 'guard', symbol: 'resolveSession' },
  },
  '/api/auth/mfa/passkey/verify': {
    reason:
      'Même acte que la vérification TOTP : il promeut la session, il ne peut pas la présupposer complète. Gardé par la signature de l’authentificateur.',
    guardedBy: { module: 'guard', symbol: 'resolveSession' },
  },
  '/api/auth/mfa/passkeys/manage': {
    reason:
      'Gestion de ses propres facteurs, exigeant une session complète (`session.status !== "active"` refusé dans le handler) et gardée par la règle du dernier facteur.',
    guardedBy: { module: 'guard', symbol: 'resolveSession' },
  },
}

describe('routes du BFF', () => {
  it('en déclare, sinon ce test ne garde rien', () => {
    expect(BFF_ROUTES.length).toBeGreaterThan(0)
  })

  it('toute route de mutation est gardée par une permission, ou exemptée avec sa raison', () => {
    expect(offenders(BFF_ROUTES, PERMISSION_SYMBOLS)).toEqual([])
  })

  it('toute route de mutation gardée écrit au journal d’audit', () => {
    expect(offenders(BFF_ROUTES, AUDIT_SYMBOLS)).toEqual([])
  })

  it('désigne des handlers qui existent', () => {
    // Un chemin fautif ferait rendre `false` à la détection — donc un échec bruyant, pas un trou.
    // Mais le diagnostic serait « route non gardée » là où le défaut est « fichier absent ».
    const missing = BFF_ROUTES.filter((entry) => read(resolve(ROOT, entry.handler)) === undefined)

    expect(missing.map((entry) => entry.handler)).toEqual([])
  })
})

describe('exemptions', () => {
  it('ne survivent pas à la route qu’elles couvraient', () => {
    // Une exemption orpheline est un piège à retardement : la route disparaît, l'entrée reste, et
    // le jour où le même chemin renaît — protégé, cette fois — elle le dispense en silence.
    const declared = new Set<string>(BFF_ROUTES.map((entry) => entry.route))
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
      .filter(([, exemption]) => exemption.reason.trim().length < 40)
      .map(([route]) => route)

    expect(thin).toEqual([])
  })

  it('tiennent la garde qu’elles affirment tenir', () => {
    // Aucune de ces gardes n'est couverte par un test de comportement : les coquilles HTTP sont
    // hors mesure (`vitest.config.ts`), et rien n'exerce ces handlers. Une justification pouvait
    // donc décrire une protection retirée depuis longtemps.
    //
    // Ce test est structurel et l'assume : il vérifie que le handler **importe** le symbole nommé
    // par son exemption. C'est faible — un import ne prouve pas un appel — mais cela ferme le cas
    // qui compte : la garde supprimée. Écrire la garde attendue oblige en outre à la nommer, ce qui
    // a déjà servi : la première version supposait `resolveSession` pour les sept routes, alors que
    // `login` n'en résout aucune — il en ouvre une.
    const broken = BFF_ROUTES.filter((entry) => entry.route in UNGUARDED_BY_DESIGN)
      .filter((entry) => {
        const { module, symbol } = UNGUARDED_BY_DESIGN[entry.route]?.guardedBy ?? {
          module: '',
          symbol: '',
        }
        return !importsSymbol(entry.handler, module, symbol)
      })
      .map((entry) => entry.route)

    expect(broken).toEqual([])
  })
})

describe('le détecteur se prouve lui-même', () => {
  // Sans ces cas, un `reaches` toujours vrai — ce qu'il était — rendrait les assertions précédentes
  // vertes à jamais. C'est le pire des modes d'échec pour un test bloquant.

  const bare: BffRoute = {
    route: '/api/customers',
    handler: './src/test/fixtures/route-nue.ts',
    method: 'post',
  }
  const guarded: BffRoute = {
    route: '/api/customers',
    handler: './src/test/fixtures/route-gardee.ts',
    method: 'post',
  }

  it('signale une route qui résout la session mais ne garde rien — le trou d’avant', () => {
    // Exactement le handler que l'ancienne version déclarait « gardé et audité » : il importe
    // `guard.ts`, dont la prose contient le mot `requirePermission`. C'est le scénario de la
    // step-06x, et il doit remonter.
    const realistic = {
      route: '/api/customers',
      handler: './src/test/fixtures/route-realiste.ts',
      method: 'post',
    } as const
    expect(offenders([realistic], PERMISSION_SYMBOLS)).toHaveLength(1)
    expect(offenders([realistic], AUDIT_SYMBOLS)).toHaveLength(1)
  })

  it('signale une route de mutation qui ne garde rien', () => {
    expect(offenders([bare], PERMISSION_SYMBOLS)).toEqual([
      'POST /api/customers → ./src/test/fixtures/route-nue.ts',
    ])
    expect(offenders([bare], AUDIT_SYMBOLS)).toEqual([
      'POST /api/customers → ./src/test/fixtures/route-nue.ts',
    ])
  })

  it('ne signale pas une route qui appelle la garde elle-même', () => {
    expect(offenders([guarded], PERMISSION_SYMBOLS)).toEqual([])
    expect(offenders([guarded], AUDIT_SYMBOLS)).toEqual([])
  })

  it('signale une route qui délègue sa garde à un service — la convention l’interdit', () => {
    // Le faux positif que la transitivité rouvrait : un module de service exporte des lectures ET
    // des mutations, le handler n'en importe qu'une lecture, et l'import suffisait à le créditer.
    // `route-deleguee.ts` n'importe que `renameFixture`, dont le module utilise `mutate`.
    const delegating = {
      route: '/api/customers',
      handler: './src/test/fixtures/route-deleguee.ts',
      method: 'post',
    } as const

    expect(offenders([delegating], PERMISSION_SYMBOLS)).toHaveLength(1)
    expect(offenders([delegating], AUDIT_SYMBOLS)).toHaveLength(1)
  })

  it('ne signale pas une route qui ne mute pas', () => {
    expect(offenders([{ ...bare, method: 'get' }], PERMISSION_SYMBOLS)).toEqual([])
  })

  it('ne prend pas un commentaire pour une garde', () => {
    // Le défaut exact de la première version : `guard.ts` mentionne `requirePermission` dans sa
    // prose, et tout handler importe `guard.ts`. Ce cas fige la correction.
    const fromGuard = join(SRC, 'server', 'auth', 'guard.ts')
    expect(read(fromGuard)).toContain('requirePermission')
    expect(authzSymbolsImportedBy(fromGuard)).toEqual(new Set())
  })

  it('ne prend pas une fonction privée homonyme pour le combinateur', () => {
    // L'autre moitié du défaut : `webauthn-credentials.ts` déclare `async function mutate(`, sans
    // aucun rapport avec l'authz, et il est atteint depuis tous les handlers de passkey.
    const homonym = join(SRC, 'server', 'auth', 'webauthn-credentials.ts')
    expect(read(homonym)).toContain('function mutate(')
    expect(authzSymbolsImportedBy(homonym)).toEqual(new Set())
  })

  it('écarte un import de type — un type ne garde rien', () => {
    const source = "import type { Refusal } from '~/server/authz/permission'"
    expect(importsIn(source, SRC)).toEqual([])
  })

  it('écarte un import mis en commentaire', () => {
    const source = "// import { mutate } from '~/server/authz/mutate'\nconst x = 1"
    expect(importsIn(source, SRC)).toEqual([])
  })

  it('ne confond pas `//` d’une URL avec un commentaire', () => {
    // Le piège du dépouillement naïf : `https://` couperait la ligne en deux et ferait disparaître
    // des imports qui suivent, ce qui rendrait des routes invisibles — donc jamais vérifiées.
    const source =
      "/** voir https://example.test/doc */\nimport { mutate } from '~/server/authz/mutate'"
    expect(importsIn(source, SRC)).toEqual([
      { path: join(SRC, 'server', 'authz', 'mutate.ts'), symbols: ['mutate'] },
    ])
  })
})

/** Les routes de mutation qui n'atteignent aucun des symboles attendus, hors exemptions. */
function offenders(entries: readonly BffRoute[], symbols: ReadonlySet<string>): string[] {
  return entries
    .filter((entry) => MUTATING_METHODS.has(entry.method))
    .filter((entry) => !(entry.route in UNGUARDED_BY_DESIGN))
    .filter((entry) => !intersects(authzSymbolsImportedBy(resolve(ROOT, entry.handler)), symbols))
    .map((entry) => `${entry.method.toUpperCase()} ${entry.route} → ${entry.handler}`)
}

function intersects(reached: ReadonlySet<string>, expected: ReadonlySet<string>): boolean {
  return [...expected].some((symbol) => reached.has(symbol))
}

/**
 * Les symboles d'`src/server/authz/` que **ce fichier** importe. Aucune transitivité.
 *
 * ## Pourquoi pas la fermeture d'imports
 *
 * La version précédente suivait tout le graphe. Elle refermait bien le trou du texte, mais rouvrait
 * la même classe de faux positif un cran plus loin, et le scénario n'a rien de tordu : dès la
 * step-061, un handler métier importera un module de service qui exporte à la fois des lectures et
 * des mutations. L'import est réellement utilisé — le linter ne dit rien — et il suffit à créditer
 * une route qui n'appelle ni `requirePermission` ni `mutate` :
 *
 * ```ts
 * import { listCustomers } from '~/server/customers/service'  // ce module utilise `mutate` ailleurs
 * export default defineEventHandler(async () => { await db.insert(notes).values(…) })
 * ```
 *
 * Vérifier que le *symbole importé* mène à la garde demanderait un vrai graphe d'appels, donc l'AST
 * de TypeScript. Exiger l'import dans le handler coûte une convention et referme le trou en entier.
 *
 * ## La convention que cela impose
 *
 * **La garde vit dans la fonction serveur**, comme le disent `CLAUDE.md` et la step : le handler
 * appelle `mutate()` ou `requirePermission()` lui-même, et délègue à l'intérieur du bloc. Un handler
 * qui déléguerait sa garde à un service est signalé — bruyamment, et c'est le bon sens de l'erreur :
 * le remède est de remonter l'appel d'un cran, pas d'élargir le détecteur.
 */
function authzSymbolsImportedBy(file: string): Set<string> {
  const source = read(file)
  if (source === undefined) return new Set()

  const found = new Set<string>()
  for (const entry of importsIn(source, dirname(file))) {
    if (isAuthzModule(entry.path)) for (const symbol of entry.symbols) found.add(symbol)
  }

  return found
}

/** Vrai si le handler tire ce symbole du module `src/server/auth/<moduleName>`. */
function importsSymbol(handler: string, moduleName: string, symbol: string): boolean {
  const absolute = resolve(ROOT, handler)
  const source = read(absolute)
  if (source === undefined) return false

  const target = join(SRC, 'server', 'auth', `${moduleName}.ts`)

  return importsIn(source, dirname(absolute)).some(
    (entry) => entry.path === target && entry.symbols.includes(symbol),
  )
}

function isAuthzModule(path: string): boolean {
  return path.replaceAll('\\', '/').includes('/src/server/authz/')
}

type ImportEntry = { readonly path: string; readonly symbols: readonly string[] }

/**
 * Les imports internes d'une source, résolus jusqu'au fichier, avec les symboles nommés.
 *
 * Les commentaires sont dépouillés d'abord : un `// import { mutate } …` ne garde rien, et c'est
 * exactement la forme qu'aurait une garde retirée à la hâte. `import type` est écarté pour la même
 * raison — un type ne s'exécute pas.
 */
function importsIn(source: string, from: string): ImportEntry[] {
  const code = stripComments(source)
  const pattern = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g

  return [...code.matchAll(pattern)].flatMap((match) => {
    const [, typeOnly, named, specifier] = match
    if (typeOnly || !named || !specifier) return []

    const resolved = resolveInternal(specifier, from)
    if (!resolved) return []

    const symbols = named
      .split(',')
      .map(
        (part) =>
          part
            .trim()
            .replace(/^type\s+/, '')
            .split(/\s+as\s+/)[0]
            ?.trim() ?? '',
      )
      .filter((symbol) => symbol.length > 0)

    return symbols.length > 0 ? [{ path: resolved, symbols }] : []
  })
}

/**
 * Retire les commentaires, sans casser les URL.
 *
 * `(^|[^:])` devant `//` évite de couper `https://…` en deux : une ligne tronquée ferait disparaître
 * les imports qui la suivent, donc rendrait une route invisible au lieu de la signaler.
 */
function stripComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function resolveInternal(specifier: string, from: string): string | undefined {
  const base = specifier.startsWith('~/')
    ? join(SRC, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(from, specifier)
      : undefined

  if (!base) return undefined

  const candidates = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]
  return candidates.find((candidate) => read(candidate) !== undefined)
}

function read(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}
