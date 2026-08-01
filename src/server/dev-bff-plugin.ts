/**
 * Les routes du BFF sous `vite dev` — **ce que Nitro ne fait qu'au build**.
 *
 * ## Pourquoi ce fichier existe
 *
 * `nitroV2Plugin` sort dès la première ligne de son hook `config` quand la commande n'est pas
 * `build`. Les dix-huit entrées de `BFF_ROUTES` que `vite.config.ts` lui passe n'existent donc que
 * dans le bundle : sous `vite dev`, `/api/auth/me` recevait le 404 HTML du routeur applicatif, la
 * garde de session lisait cet échec comme une session indécidable, et la console s'ouvrait sur
 * « Chargement interrompu — 0, la passerelle n'a pas répondu ». Aucune porte ne l'a vu — le bout en
 * bout lance `pnpm start`, donc le build, et c'est délibéré (voir `playwright.config.ts`).
 *
 * ## Pourquoi un plugin, et pas des server routes TanStack
 *
 * Une server route vivrait sous `src/routes/` et devrait importer `src/server/` — ce que la règle de
 * lint de l'invariant (d) interdit. C'est déjà la raison pour laquelle `BFF_ROUTES` existe. Ce plugin
 * relit cette même liste : dev et build servent les mêmes **routes** parce qu'ils lisent la même
 * valeur. Ce qu'ils ne partagent pas, c'est la **correspondance** — voir `matchBffRoute`, et le
 * refus bruyant qui borne l'écart.
 *
 * ## Ce qu'il ne cherche pas à reproduire
 *
 * Ni le stockage Nitro, ni les tâches planifiées, ni le pré-rendu. Deux écarts assumés, tous deux
 * mesurés : une méthode non déclarée rend ici le 404 de `createApp`, là où Nitro rend la page SSR ;
 * et le rechargement à chaud réexécute un module serveur édité, donc **réarme ses singletons** — le
 * pool `postgres.js` de `db/index.ts` est abandonné, le sémaphore de `login.ts` reparti à zéro. En
 * développement, c'est le prix du rechargement ; en production, ces modules ne sont chargés qu'une
 * fois.
 */

import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'
import { loadEnv, type Plugin } from 'vite'
import { BFF_ROUTES, type BffRoute } from './bff-routes'

/**
 * Verse `.env` dans l'environnement du processus, **sans jamais écraser ce qui s'y trouve déjà**.
 *
 * Vite lit `.env` pour `import.meta.env` et n'en verse dans `process.env` que trois variables qui le
 * concernent, lui (`VITE_USER_NODE_ENV`, `BROWSER`, `BROWSER_ARGS`) — pas `DATABASE_URL`, pas les
 * secrets de session, pas l'adresse de la passerelle. Sans ce versement, un handler monté en
 * développement échoue sur la première variable qu'il réclame.
 *
 * La précédence est celle de `loadEnv`, et elle est la bonne : son résultat est le fichier **puis**
 * `process.env` par-dessus, si bien qu'un `Object.assign` ne peut pas remplacer une variable de la
 * ligne de commande par celle du fichier. `DATABASE_URL=… pnpm dev` vise donc une autre base sans
 * éditer `.env`, comme partout ailleurs.
 *
 * Le préfixe vide charge **tout** le fichier, secrets compris. Ce que cela n'ouvre pas : l'exposition
 * au client. `resolveEnvPrefix` **lève** si `envPrefix` contient une chaîne vide, et `config.env` est
 * calculé avant que ce hook ne s'exécute — un secret ne peut donc pas se retrouver dans le bundle
 * par ce chemin.
 */
export function applyDotEnv(mode: string, envDir: string): void {
  Object.assign(process.env, loadEnv(mode, envDir, ''))
}

/**
 * La route qu'une URL désigne, **comme h3 la lira**.
 *
 * Deux différences avec une comparaison de chaînes, et les deux ont été mesurées contre la
 * production : la chaîne de requête ne participe pas (`/api/admin/roles/impact?role=…` est une
 * lecture paramétrée), et le chemin est percent-décodé — `createAppEventHandler` décode avant de
 * router, si bien que `/api/auth/%6De` atteint `me` sous Nitro. Un pré-filtre plus strict que le
 * routeur qu'il protège rendrait le développement plus sévère que la production, sur des routes
 * d'authentification.
 */
export function matchBffRoute(
  url: string | undefined,
  routes: readonly BffRoute[],
): BffRoute | undefined {
  const raw = (url ?? '').split('?')[0] ?? ''

  let path = raw
  try {
    path = decodeURIComponent(raw)
  } catch {
    // Séquence `%` invalide : h3 ne la décodera pas davantage. On compare ce qui est arrivé.
  }

  return routes.find((route) => route.route === path)
}

/** Ce que h3 accepte et que la correspondance ci-dessus ignore. */
const DYNAMIC_SEGMENT = /[:*]/

/**
 * Refuse de démarrer sur une route dynamique, **bruyamment**.
 *
 * `matchBffRoute` compare des littéraux ; h3 et Nitro, eux, acceptent `:id` et `/**`. La première
 * route paramétrée ajoutée à `BFF_ROUTES` marcherait donc au build et rendrait un 404 sous
 * `pnpm dev` — exactement le défaut que ce fichier corrige, réintroduit sans un mot. Un échec au
 * démarrage coûte une minute ; le silence coûte une séance de débogage sur la mauvaise piste.
 */
function refuseDynamicRoutes(routes: readonly BffRoute[]): void {
  const dynamiques = routes.filter((route) => DYNAMIC_SEGMENT.test(route.route))
  if (dynamiques.length === 0) return

  throw new Error(
    `Routes dynamiques non servies en développement : ${dynamiques.map((r) => r.route).join(', ')}. ` +
      'La correspondance de `dev-bff-plugin.ts` compare des littéraux — l’étendre est une step, pas ' +
      'un contournement.',
  )
}

/**
 * `routes` est un paramètre pour que le test puisse en donner qui n'exigent pas `DATABASE_URL` —
 * chaque route réelle appelle `getDatabase()` avant toute autre chose. La valeur par défaut est la
 * vraie liste : `vite.config.ts` n'a rien à passer, donc rien à oublier.
 */
export function bffDevPlugin(routes: readonly BffRoute[] = BFF_ROUTES): Plugin {
  return {
    name: 'bff-dev-routes',
    // Le build a Nitro, qui monte ces mêmes routes pour de bon. Ce plugin n'a donc rien à y faire.
    //
    // **Aucun test ne rougit si cette ligne disparaît**, et ce n'est pas une supposition : sans elle,
    // `configureServer` ne serait de toute façon pas appelé — il n'y a pas de serveur de
    // développement au build. Ce qui subsisterait, c'est `configResolved` : `pnpm build` verserait le
    // `.env` du poste dans `process.env`, et un build cesserait de ne dépendre que de son
    // environnement. Le prouver demanderait de lancer un build par assertion. À noter : `serve`
    // couvre aussi `vite preview`, qui n'existe pas comme script ici.
    apply: 'serve',

    config() {
      return {
        server: {
          // **Nitro ne sert aucun en-tête CORS ; le développement ne doit pas être plus permissif.**
          //
          // Vite autorise par défaut toute origine `localhost` ou `127.0.0.1`, et son middleware CORS
          // est monté *avant* les hooks `configureServer` — donc avant celui-ci. Sans cette ligne,
          // n'importe quelle page servie sur un autre port local pourrait poster du JSON sur
          // `/api/auth/login` **et lire la réponse**, alors que `auth/http/login.ts` justifie son
          // refus du `urlencoded` par le fait qu'un preflight JSON n'est satisfait par personne.
          // C'est vrai sous Nitro ; ce plugin ne doit pas le rendre faux.
          cors: false,
        },
      }
    },

    // `configResolved` et non `config` : `envDir` y est résolu, donc jamais à deviner. Ce hook
    // s'exécute avant `configureServer`, et les handlers ne lisent leur environnement qu'à la
    // première requête — le versement est largement à l'heure.
    //
    // `envDir: false` est la façon dont Vite dit « ne lis aucun fichier d'environnement ». La
    // respecter plutôt que de retomber sur la racine : un réglage qui ne fait pas ce qu'il annonce
    // est pire que son absence.
    //
    // **Retirer cette ligne ne fait rougir aucun test, et c'est vérifié** : `loadEnv` ne lit rien de
    // plus quand on lui passe `false`, si bien que le comportement observable ne change pas. Ce qui
    // rougit alors, c'est `pnpm typecheck` — `envDir` est `string | false`. La garde est donc tenue
    // par le typage, et le test voisin ne fait que fixer le comportement au cas où `loadEnv`
    // changerait d'avis.
    configResolved(config) {
      if (config.envDir === false) return

      applyDotEnv(config.mode, config.envDir)
    },

    configureServer(server) {
      refuseDynamicRoutes(routes)

      const router = createRouter()

      for (const { route, handler, method } of routes) {
        router.add(
          route,
          // Chargé à la requête, et non au démarrage : c'est ce qui donne le rechargement à chaud, et
          // ce qui évite d'exiger `DATABASE_URL` pour une route que personne n'appelle.
          defineEventHandler(async (event) => {
            const module = await server.ssrLoadModule(handler)

            return module.default(event)
          }),
          method,
        )
      }

      const listener = toNodeListener(createApp().use(router))

      // Monté ici — donc avant `transformMiddleware` et le repli HTML, qui répondent déjà sur
      // `/api/...`. Rendu depuis le retour de ce hook, il passerait après le catch-all de TanStack
      // Start, lequel est installé de cette façon-là. En revanche `cors`, `hostValidation` et
      // `rejectInvalidRequest` sont montés **avant** tous les hooks : d'où le `cors: false` ci-dessus.
      server.middlewares.use((request, response, next) => {
        if (!matchBffRoute(request.url, routes)) return next()

        // `toNodeListener` rattrape ce que lève l'application, mais pas ce que lève son propre
        // rattrapage — un `sendError` sur une réponse déjà détruite. Non rattrapé, ce rejet tue le
        // processus sous Node 24, et le serveur de développement disparaît sans laisser de trace.
        Promise.resolve(listener(request, response)).catch(next)
      })
    },
  }
}
