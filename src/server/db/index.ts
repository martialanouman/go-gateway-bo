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

let instance: { db: Database; client: postgres.Sql } | undefined

export function getDatabase(): Database {
  instance ??= connect(requireDatabaseUrl())
  return instance.db
}

/**
 * Ferme le pool. À appeler à l'arrêt du processus : sans cela, les connexions restent ouvertes
 * côté PostgreSQL jusqu'à leur expiration, et un redéploiement tournant les accumule.
 */
export async function closeDatabase(): Promise<void> {
  await instance?.client.end({ timeout: 5 })
  instance = undefined
}

export function connect(url: string, options?: { poolSize?: number }) {
  const client = postgres(url, {
    max: options?.poolSize ?? DEFAULT_POOL_SIZE,
    connection: { statement_timeout: STATEMENT_TIMEOUT_MS },
    // Les `NOTICE` de PostgreSQL (« relation existe déjà », émis par la maintenance des partitions)
    // n'ont pas à polluer la sortie : ce sont des messages attendus, pas des incidents.
    onnotice: () => {},
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
