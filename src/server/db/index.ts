/**
 * Accès au magasin propre au BFF.
 *
 * Comme le client de l'API Admin, ce module ne s'importe que depuis `src/server/` : une règle de
 * lint et un test d'invariant refusent son import depuis le code client (invariant d).
 *
 * Le pool est construit une fois et partagé. `postgres` (postgres.js) ouvre ses connexions
 * paresseusement : construire le pool ne joint pas la base, ce qui permet de le créer au premier
 * import sans transformer une base absente en échec de démarrage du serveur de rendu.
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Database = ReturnType<typeof connect>['db']

/**
 * Dix connexions par instance. Le tableau de bord sert 100 à 300 opérateurs depuis ≥2 instances, et
 * ses requêtes sont courtes : la contention viendra de l'API Admin, jamais de ce magasin. Un pool
 * large ne ferait qu'épuiser plus vite les `max_connections` de PostgreSQL.
 */
const DEFAULT_POOL_SIZE = 10

/**
 * Une requête qui dépasse ce délai ne rendra pas la main à un écran : PostgreSQL l'interrompt
 * lui-même plutôt que de la laisser tenir une connexion du pool. Exprimé en millisecondes, comme
 * l'attend le paramètre de session du même nom.
 */
const STATEMENT_TIMEOUT_MS = 10_000

/** Une connexion inactive plus longtemps que cela est rendue plutôt que gardée à vie. */
const IDLE_TIMEOUT_S = 30

/** Échouer vite sur une base injoignable : un écran qui attend n'aide personne (invariant e). */
const CONNECT_TIMEOUT_S = 5

let instance: { db: Database; client: postgres.Sql } | undefined
let closing: Promise<void> | undefined

export function getDatabase(): Database {
  // Une fois l'extinction engagée, plus aucune connexion neuve. Sans cette garde, un appel
  // concurrent — une écriture d'audit dans un `finally`, un handler WebSocket qui se termine —
  // rouvrirait un pool que plus personne ne fermera, et le processus ne s'arrêterait jamais.
  if (closing) {
    throw new Error("Le pool est en cours de fermeture : aucune requête nouvelle n'est acceptée.")
  }

  instance ??= connect(requireDatabaseUrl())
  return instance.db
}

/**
 * Ferme le pool. À appeler à l'arrêt du processus : sans cela, les connexions restent ouvertes côté
 * PostgreSQL jusqu'à leur expiration, et un redéploiement tournant les accumule.
 *
 * `instance` est relâchée **avant** l'attente, et non après : pendant les cinq secondes de drain, un
 * appelant obtiendrait sinon un pool en train de se fermer et échouerait en `CONNECTION_ENDED` au
 * lieu d'être refusé clairement. Appeler cette fonction deux fois rend la même promesse plutôt que
 * de lancer deux extinctions.
 */
export function closeDatabase(): Promise<void> {
  const current = instance
  instance = undefined
  closing ??= current ? current.client.end({ timeout: 5 }) : Promise.resolve()
  return closing
}

/**
 * Rouvre la possibilité d'obtenir un pool après une fermeture. **Réservé aux tests.**
 *
 * L'arrêt est délibérément terminal en production : une instance qui a commencé à s'éteindre ne
 * doit jamais rouvrir de connexion, sinon le processus ne se termine pas. Les tests, eux, ferment
 * et rouvrent à chaque cas — leur donner cette porte nommée vaut mieux que d'affaiblir la
 * sémantique d'arrêt pour tout le monde, ce qui laisserait une écriture d'audit tardive ressusciter
 * un pool que plus personne n'attend.
 */
export function resetDatabaseForTests(): void {
  instance = undefined
  closing = undefined
}

export function connect(url: string, options?: { poolSize?: number }) {
  const client = postgres(url, {
    max: options?.poolSize ?? DEFAULT_POOL_SIZE,
    connection: { statement_timeout: STATEMENT_TIMEOUT_MS },
    // Sans `idle_timeout`, postgres.js garde ses dix connexions ouvertes à vie, par instance.
    idle_timeout: IDLE_TIMEOUT_S,
    // Trente secondes par défaut : un écran qui attend une demi-minute sur une base injoignable
    // contredit l'invariant (e), qui veut un échec rapide et lisible plutôt qu'une attente.
    connect_timeout: CONNECT_TIMEOUT_S,
    // Un seul `NOTICE` est attendu et sans intérêt : « la relation existe déjà » (42P07), qu'émet la
    // maintenance des partitions. Tout taire ferait aussi disparaître les rapports de verrou mortel
    // et les avertissements de troncature d'identifiant — c'est-à-dire précisément ce qu'on veut
    // voir arriver.
    onnotice: (notice) => {
      if (notice.code !== '42P07') console.warn('[postgres]', notice.severity, notice.message)
    },
  })

  // `snake_case` côté base, `camelCase` côté TypeScript. La convention est déclarée une seule fois,
  // ici et dans `drizzle.config.ts`, jamais répétée colonne par colonne.
  return { client, db: drizzle(client, { schema, casing: 'snake_case' }) }
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    // Même règle qu'ailleurs : pas de repli silencieux vers une base locale. Une instance qui
    // démarre en écrivant son audit dans le vide est pire qu'une instance qui refuse de démarrer.
    throw new Error("DATABASE_URL est requise et absente de l'environnement.")
  }
  return url
}

export { schema }
