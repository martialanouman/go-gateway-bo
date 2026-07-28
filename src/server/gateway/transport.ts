/**
 * Le transport HTTP vers l'API Admin, et le seul endroit qui présente le certificat client.
 *
 * **Pourquoi un dispatcher local et pas `setGlobalDispatcher`.** Un dispatcher global présenterait
 * le certificat client du BFF à *tout* hôte que ce processus contacte en TLS — le même processus
 * fait aussi le rendu SSR, et joindra un webhook Alertmanager en M9. Un certificat d'identité ne
 * s'envoie qu'à l'interlocuteur pour lequel il a été émis ; la portée est donc attachée au client,
 * pas au processus.
 *
 * **Pourquoi la requête est reconstruite à partir de primitives.** Node embarque sa propre copie
 * d'undici mais n'expose pas `Agent` : il faut le paquet npm, et les deux copies ne se reconnaissent
 * pas. Passer directement la `Request` construite par `openapi-fetch` au `fetch` du paquet échoue
 * sur « Failed to parse URL from [object Request] » — le converter la prend pour une chaîne. URL,
 * méthode, en-têtes et corps traversent donc la frontière sous forme de primitives, seules choses
 * que les deux copies interprètent de la même façon.
 *
 * **Rotation des certificats.** Les options TLS d'un `Agent` sont figées à sa construction : ce
 * transport ne recharge pas les fichiers. Une rotation exige donc un redémarrage du processus —
 * choix assumé ici, parce que le déploiement est déjà à ≥2 instances derrière un load balancer et
 * qu'un redémarrage tournant ne coupe rien. À revoir si la rotation devient assez fréquente pour
 * que ce soit un sujet d'exploitation.
 */

import { readFileSync } from 'node:fs'
import { Agent, fetch as undiciFetch } from 'undici'
import { ConfigurationError, type MtlsPaths } from './config'

export type Transport = {
  fetch: typeof globalThis.fetch
  /** Draine les connexions maintenues ouvertes. À appeler à l'arrêt et dans les tests. */
  close: () => Promise<void>
}

/**
 * Les 300 s par défaut d'undici n'ont pas de sens pour un cockpit : une passerelle qui n'a pas
 * envoyé d'en-têtes en 15 s ne répondra pas utilement, et la connexion vaut mieux libérée.
 */
const HEADERS_TIMEOUT_MS = 15_000
const BODY_TIMEOUT_MS = 30_000

/**
 * Sans `mtls`, le transport reste en clair : c'est le mode `mock`, où Prism écoute en local et où
 * exiger un certificat pousserait chacun à s'en fabriquer un.
 */
export function createTransport(mtls?: MtlsPaths): Transport {
  const agent = new Agent({
    ...(mtls
      ? {
          connect: {
            cert: readCertificate(mtls.certPath, 'GATEWAY_MTLS_CERT_PATH'),
            key: readCertificate(mtls.keyPath, 'GATEWAY_MTLS_KEY_PATH'),
            ca: readCertificate(mtls.caPath, 'GATEWAY_MTLS_CA_PATH'),
          },
        }
      : {}),
    headersTimeout: HEADERS_TIMEOUT_MS,
    bodyTimeout: BODY_TIMEOUT_MS,
  })

  const fetch = async (input: Request, init?: RequestInit): Promise<Response> => {
    // Le corps est matérialisé avant la traversée : un `ReadableStream` de la copie d'undici de Node
    // n'est pas lisible par celle du paquet npm. Les réponses de l'Admin API sont des documents
    // JSON, jamais des flux — la mise en mémoire n'a pas de coût caché ici.
    const body = input.body ? await input.arrayBuffer() : undefined

    const response = await undiciFetch(input.url, {
      method: input.method,
      headers: [...input.headers],
      ...(body ? { body } : {}),
      signal: init?.signal ?? input.signal,
      dispatcher: agent,
    })

    return response as unknown as Response
  }

  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    close: () => agent.close(),
  }
}

function readCertificate(path: string, variableName: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    // Ni le chemin ni la cause système ne sont repris : un message de démarrage part dans les logs
    // de l'orchestrateur, et la topologie des secrets n'a pas à s'y trouver.
    throw new ConfigurationError(`Le fichier désigné par ${variableName} est illisible.`)
  }
}
