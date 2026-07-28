/**
 * Le transport HTTP vers l'API Admin, et le seul endroit qui présente le certificat client.
 *
 * **Pourquoi un dispatcher local et pas `setGlobalDispatcher`.** Un dispatcher global présenterait
 * le certificat client du BFF à *tout* hôte que ce processus contacte en TLS — le même processus
 * fait aussi le rendu SSR, et joindra un webhook Alertmanager en M9. Un certificat d'identité ne
 * s'envoie qu'à l'interlocuteur pour lequel il a été émis ; la portée est donc attachée au client,
 * pas au processus.
 *
 * **Pourquoi `fetch` vient d'undici et non du global.** Node embarque sa propre copie d'undici, mais
 * n'expose pas `Agent`. Mélanger l'`Agent` du paquet npm avec le `fetch` global reviendrait à faire
 * dialoguer deux copies distinctes de la même bibliothèque par leurs interfaces internes : ça marche
 * tant que leurs versions restent alignées, et casse silencieusement le jour où elles divergent.
 * Une seule source, donc.
 *
 * **Rotation des certificats.** Les options TLS d'un `Agent` sont figées à sa construction : ce
 * transport ne recharge pas les fichiers. Une rotation exige donc un redémarrage du processus —
 * choix assumé ici, parce que le déploiement est déjà à ≥2 instances derrière un load balancer et
 * qu'un redémarrage tournant ne coupe rien. À revoir si la rotation devient assez fréquente pour
 * que ce soit un sujet d'exploitation.
 */

import { readFileSync } from 'node:fs'
import {
  Agent,
  type RequestInfo as UndiciRequestInfo,
  type RequestInit as UndiciRequestInit,
  fetch as undiciFetch,
} from 'undici'
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

export function createMtlsTransport(mtls: MtlsPaths): Transport {
  const agent = new Agent({
    connect: {
      cert: readCertificate(mtls.certPath, 'GATEWAY_MTLS_CERT_PATH'),
      key: readCertificate(mtls.keyPath, 'GATEWAY_MTLS_KEY_PATH'),
      ca: readCertificate(mtls.caPath, 'GATEWAY_MTLS_CA_PATH'),
    },
    headersTimeout: HEADERS_TIMEOUT_MS,
    bodyTimeout: BODY_TIMEOUT_MS,
  })

  return {
    // Les casts tiennent à une différence de déclarations entre le `fetch` d'undici et celui du
    // DOM ; les deux implémentent la même spécification, et c'est le seul endroit du dépôt qui les
    // rapproche.
    fetch: ((input: Request, init?: RequestInit) =>
      undiciFetch(
        input as unknown as UndiciRequestInfo,
        {
          ...init,
          dispatcher: agent,
        } as unknown as UndiciRequestInit,
      )) as unknown as typeof globalThis.fetch,
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
