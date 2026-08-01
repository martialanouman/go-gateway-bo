// @vitest-environment node

/**
 * Ce que `pnpm dev` doit servir — et ce qu'il ne servait pas.
 *
 * `nitroV2Plugin` sort dès la première ligne de son hook `config` quand la commande n'est pas
 * `build` : sous `vite dev`, aucune des routes de `BFF_ROUTES` n'existait, et `/api/auth/me`
 * répondait le 404 HTML du routeur applicatif. La console s'ouvrait alors sur « la passerelle n'a pas
 * répondu » — la garde de session lit un échec de lecture comme une session indécidable — pendant
 * que le bout en bout restait vert, puisque Playwright lance `pnpm start`, donc le build.
 *
 * ## Ce que ce harnais rejoue, et ce qu'il ne rejoue pas
 *
 * Il monte un **vrai** serveur Vite : les middlewares, l'ordre des hooks et la politique CORS sont
 * ceux de Vite, pas des doublures. Deux choses lui manquent, et il faut les savoir. `configFile:
 * false` écarte `tanstackStart`, donc le catch-all qui produisait le 404 HTML : l'ordre de montage
 * n'est éprouvé que contre une sentinelle. Et les routes sont les siennes, parce que chaque route
 * réelle appelle `getDatabase()` avant toute autre chose — le dernier `describe` répare ce que ce
 * choix laisse ouvert, en interrogeant la vraie liste.
 *
 * `envDir` pointe vers un répertoire temporaire dans les suites qui n'éprouvent pas le versement :
 * sinon le hook déverserait le `.env` du poste — `DATABASE_URL`, les trois secrets,
 * `BOOTSTRAP_ADMIN_PASSWORD` — dans le `process.env` du worker. L'isolation de Vitest le contient au
 * fichier, mais un `.env` présent en local et absent en CI est exactement l'écart que « `pnpm check`
 * vert prédit une CI verte » interdit.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Plugin } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BFF_ROUTES, type BffRoute } from './bff-routes'
import { applyDotEnv, bffDevPlugin, matchBffRoute } from './dev-bff-plugin'

const ROUTES = [
  { route: '/api/dev/read', handler: './src/test/fixtures/route-dev.ts', method: 'get' },
  { route: '/api/dev/write', handler: './src/test/fixtures/route-dev.ts', method: 'post' },
] as const satisfies readonly BffRoute[]

/**
 * Répond à tout ce qui n'a pas été capté avant elle.
 *
 * Sans cette sentinelle, « le plugin laisse passer le reste » se vérifierait sur le 404 de Vite —
 * indiscernable du 404 que rend une app h3 sans route correspondante. Ici, un 418 ne peut venir que
 * d'un `next()`.
 */
function sentinelle(): Plugin {
  return {
    name: 'sentinelle-de-test',
    configureServer(server) {
      server.middlewares.use((_request, response) => {
        response.statusCode = 418
        response.end('passé au suivant')
      })
    },
  }
}

/** Un serveur Vite écoutant pour de bon, avec les plugins donnés. */
async function servir(
  plugins: Plugin[],
  envDir: string | false,
): Promise<{ origine: string; fermer: () => Promise<void> }> {
  const vite = await createServer({
    // Sans cela, Vite relirait `vite.config.ts` — donc le plugin Start et Nitro, pour un test qui
    // n'a besoin ni de l'un ni de l'autre.
    configFile: false,
    root: process.cwd(),
    envDir,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true },
    plugins,
  })

  const http: Server = createHttpServer(vite.middlewares)
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))

  return {
    origine: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
    fermer: async () => {
      await new Promise<void>((resolve) => http.close(() => resolve()))
      await vite.close()
    },
  }
}

describe('la correspondance entre une URL et une route', () => {
  it('ignore la chaîne de requête', () => {
    expect(matchBffRoute('/api/dev/read?filter=actifs', ROUTES)).toMatchObject({
      route: '/api/dev/read',
    })
  })

  it('décode le chemin, comme h3 le fera derrière elle', () => {
    // `%6D` est un `m` : Nitro décode avant de router, donc `/api/auth/%6De` atteint `me` en
    // production. Un pré-filtre qui comparerait le brut rendrait le développement plus strict.
    expect(matchBffRoute('/api/dev/%72ead', ROUTES)).toMatchObject({ route: '/api/dev/read' })
  })

  it('compare le brut quand le pourcentage est invalide, plutôt que de lever', () => {
    expect(() => matchBffRoute('/api/dev/%zz', ROUTES)).not.toThrow()
    expect(matchBffRoute('/api/dev/%zz', ROUTES)).toBeUndefined()
  })

  it('ne trouve rien pour une URL absente ou inconnue', () => {
    expect(matchBffRoute(undefined, ROUTES)).toBeUndefined()
    expect(matchBffRoute('/api/dev/inventee', ROUTES)).toBeUndefined()
  })
})

describe('les routes du BFF sous vite dev', () => {
  const envVide = mkdtempSync(join(tmpdir(), 'env-vide-'))
  let origine: string
  let fermer: () => Promise<void>

  beforeAll(async () => {
    ;({ origine, fermer } = await servir([bffDevPlugin(ROUTES), sentinelle()], envVide))
  })

  afterAll(async () => {
    await fermer()
    rmSync(envVide, { recursive: true, force: true })
  })

  it('sert une route déclarée, en exécutant le module qu’elle nomme', async () => {
    const response = await fetch(`${origine}/api/dev/read`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ seen: 'route de développement', filter: null })
  })

  /**
   * Le test que l'absence rendait la méthode ininspectable : sans lui, figer `router.add` sur `get`
   * laissait la suite verte, et `login`, `logout` et les six mutations de l'annuaire auraient répondu
   * 404 sous `pnpm dev` — le défaut même que ce fichier corrige.
   */
  it('sert aussi une route déclarée en post', async () => {
    const response = await fetch(`${origine}/api/dev/write`, { method: 'post' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ seen: 'route de développement' })
  })

  it('transmet la chaîne de requête, qui ne participe pas à la correspondance', async () => {
    const response = await fetch(`${origine}/api/dev/read?filter=actifs`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ filter: 'actifs' })
  })

  it('n’exécute pas un handler déclaré pour une autre méthode', async () => {
    const response = await fetch(`${origine}/api/dev/read`, { method: 'put' })

    expect(response.status).not.toBe(200)
    expect(await response.text()).not.toContain('route de développement')
  })

  it('laisse passer ce qui n’est pas une route du BFF', async () => {
    const response = await fetch(`${origine}/api/dev/absente`)

    expect(response.status).toBe(418)
  })

  /**
   * Vite autorise par défaut toute origine `localhost`, et son middleware CORS s'exécute avant le
   * nôtre. Nitro, lui, n'émet aucun de ces en-têtes : une page ouverte sur un autre port local ne
   * peut pas lire la réponse d'une route d'authentification. Le développement doit dire la même
   * chose, sans quoi `auth/http/login.ts` documente une défense que `pnpm dev` a retirée.
   */
  it('n’accorde le CORS de Vite à personne', async () => {
    const preflight = await fetch(`${origine}/api/dev/read`, {
      method: 'options',
      headers: { origin: 'http://localhost:9999', 'access-control-request-method': 'post' },
    })
    const lecture = await fetch(`${origine}/api/dev/read`, {
      headers: { origin: 'http://localhost:9999' },
    })

    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
    expect(lecture.headers.get('access-control-allow-origin')).toBeNull()
  })
})

/**
 * Ce que les suites précédentes ne peuvent pas dire : que le plugin **sans argument** sert les vraies
 * routes, toutes. Le paramètre `routes` n'existe que pour donner des handlers qui n'exigent pas
 * `DATABASE_URL`, et un `vite.config.ts` qui aurait passé une liste vide — ou tronquée, ce qui est le
 * mode d'échec réaliste — s'y serait glissé sans un mot.
 *
 * La méthode est délibérément `delete`, qu'aucune entrée du contrat n'emploie : le routeur ne trouve
 * alors pas de handler pour la méthode, ne charge aucun module, et rend le 404 de `createApp`. Ce
 * n'est pas 418, et c'est tout ce qu'on demande — la route est connue du plugin.
 */
describe('la liste que le plugin sert par défaut', () => {
  const envVide = mkdtempSync(join(tmpdir(), 'env-vide-'))
  let origine: string
  let fermer: () => Promise<void>

  beforeAll(async () => {
    ;({ origine, fermer } = await servir([bffDevPlugin(), sentinelle()], envVide))
  })

  afterAll(async () => {
    await fermer()
    rmSync(envVide, { recursive: true, force: true })
  })

  it('est celle du BFF en entier, sans que `vite.config.ts` ait à la passer', async () => {
    const statuts = await Promise.all(
      BFF_ROUTES.map(async (route) => {
        const response = await fetch(`${origine}${route.route}`, { method: 'delete' })

        return { route: route.route, status: response.status }
      }),
    )

    expect(statuts.filter(({ status }) => status === 418)).toEqual([])
  })

  it('et elle ne sert rien d’autre', async () => {
    const response = await fetch(`${origine}/api/auth/inventee`, { method: 'delete' })

    expect(response.status).toBe(418)
  })
})

/**
 * La seule ligne qui relie tout ce fichier au produit.
 *
 * Retirer `bffDevPlugin()` de `vite.config.ts` rend la branche entière inopérante et laisse
 * `pnpm check` vert : rien n'importait cette configuration, et le bout en bout lance `pnpm start`,
 * donc le build. On lit la **valeur**, pas le texte du fichier — chercher un nom dans une source ne
 * garde rien, un commentaire suffirait à le satisfaire.
 */
describe('le branchement dans vite.config.ts', () => {
  it('monte le plugin', async () => {
    const { default: config } = await import('../../vite.config')

    // Aplati à la main : `tanstackStart()` rend un tableau de plugins, et le `.flat(Infinity)` de la
    // bibliothèque standard fait dérailler l'inférence de TypeScript sur ces types récursifs.
    const noms: unknown[] = []
    const parcourir = (valeur: unknown): void => {
      if (Array.isArray(valeur)) return void valeur.forEach(parcourir)
      if (valeur && typeof valeur === 'object' && 'name' in valeur) noms.push(valeur.name)
    }
    parcourir(config.plugins)

    expect(noms).toContain('bff-dev-routes')
  })
})

describe('les routes dynamiques', () => {
  const envVide = mkdtempSync(join(tmpdir(), 'env-vide-'))

  afterAll(() => rmSync(envVide, { recursive: true, force: true }))

  it('font échouer le démarrage plutôt que de disparaître en silence', async () => {
    const dynamique = [
      {
        route: '/api/admin/operators/:id',
        handler: './src/test/fixtures/route-dev.ts',
        method: 'get',
      },
    ] as const satisfies readonly BffRoute[]

    await expect(servir([bffDevPlugin(dynamique)], envVide)).rejects.toThrow(
      /Routes dynamiques non servies/,
    )
  })
})

describe('les variables d’environnement sous vite dev', () => {
  const racine = mkdtempSync(join(tmpdir(), 'env-dev-'))

  beforeAll(() => {
    writeFileSync(join(racine, '.env'), 'GTW_DEV_ABSENTE=du-fichier\nGTW_DEV_PRESENTE=du-fichier\n')
  })

  afterAll(() => {
    delete process.env.GTW_DEV_ABSENTE
    delete process.env.GTW_DEV_PRESENTE
    rmSync(racine, { recursive: true, force: true })
  })

  /**
   * Le hook, et pas seulement la fonction : sans cette assertion, retirer `configResolved` du plugin
   * — ou intervertir ses deux arguments `string`, ce que `tsc` accepte — laissait la moitié « `.env` »
   * du correctif disparaître sans un test rouge.
   */
  it('sont versées par le plugin lui-même, au démarrage du serveur', async () => {
    delete process.env.GTW_DEV_ABSENTE

    const { fermer } = await servir([bffDevPlugin(ROUTES)], racine)

    expect(process.env.GTW_DEV_ABSENTE).toBe('du-fichier')
    await fermer()
  })

  /**
   * `envDir: false` est la façon dont Vite dit « ne lis aucun fichier ».
   *
   * Ce test ne tient pas le `if` du plugin — retiré, il reste vert, parce que `loadEnv` ne lit rien
   * de plus qu'on lui passe `false` ; c'est `pnpm typecheck` qui rougit alors. Il fixe le
   * comportement observable, et rien d'autre : le dire vaut mieux que le laisser croire.
   */
  it('ne sont pas lues quand la configuration l’interdit', async () => {
    delete process.env.GTW_DEV_ABSENTE

    const { fermer } = await servir([bffDevPlugin(ROUTES)], false)

    expect(process.env.GTW_DEV_ABSENTE).toBeUndefined()
    await fermer()
  })

  it('n’écrasent jamais une variable déjà posée', () => {
    process.env.GTW_DEV_PRESENTE = 'de-la-ligne-de-commande'

    applyDotEnv('development', racine)

    expect(process.env.GTW_DEV_PRESENTE).toBe('de-la-ligne-de-commande')
    // Et l'autre est bien arrivée : sans elle, « n'écrase pas » serait vrai d'une fonction qui ne
    // fait rien du tout.
    expect(process.env.GTW_DEV_ABSENTE).toBe('du-fichier')
  })
})
