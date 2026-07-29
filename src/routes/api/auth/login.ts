/**
 * `POST /api/auth/login` — le transport, et rien d'autre.
 *
 * Toute la sécurité est dans `src/server/auth/` et testée là-bas : décision (`login.ts`), discrétion
 * de la réponse (`http.ts`), adresse de l'appelant (`client-ip.ts`), bornage de la concurrence
 * (`concurrency.ts`). Ce fichier lit une requête, appelle, rend une réponse — c'est ce qui permet de
 * l'exclure de la mesure de couverture sans rien y cacher.
 *
 * **Corollaire à tenir** : aucune règle d'authentification ici. Le jour où une décision y apparaît —
 * un cas particulier, une exception, un court-circuit — elle sort de la mesure sans que personne ne
 * le voie, et c'est précisément le genre de code où cela ne doit pas arriver.
 */

import { createFileRoute } from '@tanstack/react-router'
import { readClientIpFromRequest } from '~/server/auth/client-ip'
import { createSemaphore, readVerificationSlots } from '~/server/auth/concurrency'
import { loginResponse, parseCredentials } from '~/server/auth/http'
import { createLoginService, type LoginService } from '~/server/auth/login'
import { readThrottleSecret } from '~/server/auth/throttle'
import { getDatabase } from '~/server/db/index'

let service: LoginService | undefined

/**
 * Un service par process, construit au premier appel.
 *
 * Le sémaphore **doit** être partagé par toutes les requêtes : en construire un par appel reviendrait
 * à n'en avoir aucun, et le threadpool libuv se retrouverait saturé par les vérifications scrypt —
 * ce que ce sémaphore existe précisément pour empêcher.
 */
function getLoginService(): LoginService {
  service ??= createLoginService({
    db: getDatabase(),
    throttleSecret: readThrottleSecret(process.env),
    semaphore: createSemaphore({
      slots: readVerificationSlots(process.env),
      queueLimit: 64,
    }),
  })
  return service
}

export const Route = createFileRoute('/api/auth/login')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Un corps illisible suit le même chemin qu'une saisie invalide : voir `parseCredentials`.
        const body = await request.json().catch(() => undefined)
        const credentials = parseCredentials(body)

        // **Jamais `x-real-ip`.** C'est un en-tête fourni par le client, exactement comme
        // `x-forwarded-for` : le lire reviendrait à laisser l'appelant choisir son identité de
        // comptage, ce que `client-ip.ts` existe précisément pour empêcher.
        const ipAddress = readClientIpFromRequest(request, process.env)

        // Une saisie illisible passe par le **même** chemin qu'un échec ordinaire : plancher de
        // latence et compteur compris. Un retour immédiat ici donnerait un chemin gratuit, jamais
        // compté, et un étalon exact de la latence réseau pour calibrer les autres mesures.
        const outcome = await getLoginService().attempt({
          identifier: credentials.ok ? credentials.identifier : '',
          password: credentials.ok ? credentials.password : '',
          ipAddress,
          malformed: !credentials.ok,
        })

        return loginResponse(outcome)
      },
    },
  },
})
