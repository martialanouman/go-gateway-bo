// @vitest-environment node

// Ce fichier est le seul à parler à un vrai serveur HTTP. Il ne teste pas la passerelle — elle
// n'implémente pas encore la moitié du contrat — mais la conformité de NOTRE client au contrat :
// la requête qu'il émet est-elle acceptée par une implémentation qui valide, et la réponse
// décrite par le contrat se lit-elle telle que nos types la promettent ?
//
// Prism tourne dans le processus de test (pas en sous-processus) : port éphémère, arrêt
// déterministe, aucun processus survivant à une suite interrompue.
//
// `validateRequest: true` est ce qui rend ces tests capables d'échouer : vérifié en le passant à
// `false`, auquel cas le test négatif ci-dessous reçoit un 200 et rougit. Sans lui, Prism servirait
// un exemple quoi qu'on lui envoie, et « le client parle au contrat » ne voudrait plus rien dire.

import { fileURLToPath } from 'node:url'
import { createLogger } from '@stoplight/prism-core'
import { getHttpOperationsFromSpec } from '@stoplight/prism-http'
import { createServer } from '@stoplight/prism-http-server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGatewayClient, unwrap } from './client'
import { GatewayError } from './errors'

type PrismServer = Awaited<ReturnType<typeof startPrism>>

let prism: PrismServer

beforeAll(async () => {
  prism = await startPrism()
}, 30_000)

afterAll(async () => {
  await prism?.close()
})

describe('client Admin contre le contrat', () => {
  it('lit `list-customers` et rend la page décrite par le contrat', async () => {
    const page = await unwrap(await client().GET('/admin/customers'))

    expect(page).toHaveProperty('data')
    expect(Array.isArray(page.data)).toBe(true)
    expect(page).toHaveProperty('has_more')
  })

  it('sérialise les paramètres de requête comme le contrat les attend', async () => {
    const page = await unwrap(
      await client().GET('/admin/customers', {
        params: { query: { limit: 10, status: 'active' } },
      }),
    )

    expect(page).toHaveProperty('data')
  })

  it('se fait refuser une requête non conforme — la validation est bien armée', async () => {
    // `limit` est borné à 500 par le contrat. Une implémentation qui valide doit refuser 9999.
    // Si ce test passait au vert avec un 200, c'est que Prism ne valide rien et que les deux
    // tests ci-dessus ne prouveraient plus rien.
    const error = await unwrap(
      await client().GET('/admin/customers', { params: { query: { limit: 9999 } } }),
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(GatewayError)
    expect((error as GatewayError).status).toBe(422)
  })

  it('se fait refuser une requête sans jeton machine', async () => {
    // La sécurité du contrat est vérifiée par Prism : sans `Authorization`, c'est 401. Preuve que
    // le Bearer posé par le client est bien celui que la passerelle exigera.
    const anonymous = createGatewayClient({
      baseUrl: prism.baseUrl,
      getAccessToken: async () => '',
    })

    const error = await unwrap(await anonymous.GET('/admin/customers')).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(GatewayError)
    expect((error as GatewayError).status).toBe(401)
  })

  it('refuse à la compilation un champ absent du contrat', async () => {
    // Cette assertion se joue à `pnpm typecheck`, pas à l'exécution : si `CustomerCreate` venait à
    // accepter n'importe quoi, `@ts-expect-error` deviendrait inutilisé et tsc échouerait.
    await client().POST('/admin/customers', {
      // @ts-expect-error — `nom` n'existe pas au contrat ; le champ s'appelle `name`.
      body: { nom: 'ACME' },
    })
  })
})

function client() {
  return createGatewayClient({
    baseUrl: prism.baseUrl,
    getAccessToken: async () => 'jeton-machine-de-test',
  })
}

async function startPrism() {
  // `fileURLToPath` et non `.pathname` : ce dernier conserve le percent-encodage, et un dépôt cloné
  // dans un chemin contenant une espace donnerait « %20 » à un lecteur de fichiers.
  const spec = fileURLToPath(
    import.meta.resolve('@martialanouman/gateway-api-contracts/openapi-admin.yaml'),
  )
  const operations = await getHttpOperationsFromSpec(spec)

  const server = createServer(operations, {
    components: { logger: createLogger('contract-test', { level: 'silent' }) },
    config: {
      mock: { dynamic: false },
      checkSecurity: true,
      validateRequest: true,
      validateResponse: true,
      errors: true,
      upstreamProxy: undefined,
      isProxy: false,
    },
    cors: false,
  })

  // Port 0 : le système en attribue un libre. Deux suites lancées en parallèle ne se marchent pas
  // dessus, et aucun port fixe ne traîne dans la config.
  const address = await server.listen(0, '127.0.0.1')

  return {
    baseUrl: address,
    close: () => server.close(),
  }
}
