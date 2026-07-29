/**
 * `POST /api/auth/login` — la coquille HTTP, et rien d'autre.
 *
 * ## Pourquoi ce fichier n'est pas sous `src/routes/`
 *
 * Une *server route* TanStack doit vivre dans `src/routes/`, puisque c'est le routage par fichiers
 * qui lui donne son URL. Elle a pourtant besoin du BFF — base, service d'authentification — et la
 * règle de lint qui matérialise l'**invariant (d)** interdit précisément à `src/routes/**` de toucher
 * `src/server/**`. La contourner demandait une exception, et une exception sur cette règle-là se paie
 * en gardes compensatoires que la prochaine personne devra comprendre avant d'y toucher.
 *
 * Nitro sait enregistrer un handler depuis n'importe quel chemin, déclaré dans `vite.config.ts`. Le
 * fichier vit donc sous `src/server/`, personne ne l'importe depuis le client, et **la règle d'or
 * reste intacte, sans exception**.
 *
 * ## Ce que le passage à H3 apporte, au-delà de la frontière
 *
 * `getRequestIP(event)` rend **l'adresse du socket** — vérifié : un `x-forwarded-for` forgé ne la
 * change pas. Un `Request` web standard ne l'expose pas du tout, si bien que le comptage par adresse
 * était jusqu'ici hors d'atteinte.
 *
 * Cela ne l'active pas pour autant. Derrière le load balancer que la spec impose, l'adresse du
 * socket est celle du **répartiteur**, la même pour tous les opérateurs : la compter verrouillerait
 * la console entière au vingtième échec de n'importe qui. C'est `AUTH_TRUSTED_PROXIES` qui décide, et
 * son absence vaut « ne compte pas » — voir `client-ip.ts`. Ce que H3 apporte ici, c'est de rendre le
 * comptage **possible** une fois la topologie déclarée.
 *
 * **Corollaire à tenir** : aucune règle d'authentification ici. La décision est dans `login.ts`, la
 * discrétion de la réponse dans `http.ts`, l'adresse dans `client-ip.ts` — tous testés. Ce fichier
 * est exclu de la mesure de couverture parce qu'il ne décide rien ; le jour où il déciderait, la
 * règle sortirait de la mesure sans que personne ne le voie.
 */

import { defineEventHandler, getRequestHeader, getRequestIP, readBody } from 'h3'
import { getDatabase } from '../../db/index'
import { readClientIp, readTrustedProxyCount } from '../client-ip'
import { createSemaphore, readVerificationSlots } from '../concurrency'
import { loginResponse, parseCredentials } from '../http'
import { createLoginService, type LoginService } from '../login'
import { getSessionSecrets } from '../secrets'
import { readThrottleSecret } from '../throttle'

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
    semaphore: createSemaphore({ slots: readVerificationSlots(process.env), queueLimit: 64 }),
  })
  return service
}

export default defineEventHandler(async (event) => {
  // Un corps illisible n'est pas rejeté ici : il suit le même chemin qu'un échec ordinaire, plancher
  // de latence et compteur d'adresse compris. Un retour immédiat offrirait un chemin gratuit, jamais
  // compté, et un étalon exact de la latence pour calibrer les autres mesures.
  // **Uniquement du JSON, et ce n'est pas une préférence de style.** `readBody` de H3 accepte aussi
  // `application/x-www-form-urlencoded` — or un `<form>` de ce type est une *simple request* : aucun
  // preflight CORS, donc n'importe quelle page visitée par un opérateur pourrait déclencher des
  // tentatives de connexion depuis **son** navigateur et **son** adresse. Le verrouillage par
  // identifiant deviendrait actionnable à distance, et le compteur d'adresses s'empoisonnerait avec
  // des IP légitimes. Le JSON, lui, impose un preflight que rien ne satisfait ici.
  const contentType = getRequestHeader(event, 'content-type')?.split(';')[0]?.trim()
  const body =
    contentType === 'application/json' ? await readBody(event).catch(() => undefined) : undefined

  // Le refus passe par `malformed`, jamais par un retour anticipé : voir plus bas.
  const credentials = parseCredentials(body)

  const ipAddress = readClientIp(
    {
      forwardedFor: getRequestHeader(event, 'x-forwarded-for'),
      // Sans l'option `xForwardedFor` : elle prendrait la valeur la plus à gauche de la chaîne,
      // c'est-à-dire celle que l'appelant a écrite. On veut le socket, et lui seul.
      remoteAddress: getRequestIP(event),
    },
    readTrustedProxyCount(process.env),
  )

  const outcome = await getLoginService().attempt({
    identifier: credentials.ok ? credentials.identifier : '',
    password: credentials.ok ? credentials.password : '',
    ipAddress,
    malformed: !credentials.ok,
  })

  // La `Response` est rendue telle quelle : H3 la reconnaît et la transpose lui-même. Recopier les
  // en-têtes à la main — ce que faisait la première version — passait par
  // `Object.fromEntries(response.headers)`, qui **fond plusieurs `set-cookie` en un seul**, joints
  // par une virgule et donc invalides dès qu'une date d'expiration en contient une. La step-022 pose
  // précisément un cookie de session sur cette réponse : le piège se serait déclenché là, sans
  // qu'aucun test de cette PR ne le voie.
  return loginResponse(outcome, getSessionSecrets())
})
