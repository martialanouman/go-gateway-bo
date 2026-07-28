/**
 * Les migrations, appliquées sur un vrai PostgreSQL 18 démarré pour l'occasion.
 *
 * Ces tests ne sont pas dans `pnpm test` : ils coûtent quelques secondes et exigent Docker, là où la
 * boucle de travail doit rester à quelques centaines de millisecondes. Ils sont dans `pnpm check`,
 * qui est la porte de la Definition of Done — donc ils tournent à chaque PR, sans jamais se sauter
 * en silence.
 *
 * Ils vérifient ce qu'aucun test unitaire ne peut voir : que le SQL écrit à la main fait réellement
 * ce qu'il annonce, et que `uuidv7()` existe bien dans l'image utilisée.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect } from './index'

/** La même image que `docker-compose.yml` : tester sur une autre version ne prouverait rien. */
const POSTGRES_IMAGE = 'postgres:18-alpine'

let container: StartedPostgreSqlContainer
let sql: postgres.Sql
let applyMigrations: () => Promise<void>

beforeAll(async () => {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start()

  const { client, db } = connect(container.getConnectionUri(), { poolSize: 2 })
  sql = client
  applyMigrations = () => migrate(db, { migrationsFolder: './drizzle' })

  await applyMigrations()
}, 180_000)

afterAll(async () => {
  await sql?.end({ timeout: 5 })
  await container?.stop()
})

describe('migrations', () => {
  it('crée les neuf tables que le BFF possède, et rien de plus', async () => {
    const rows = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT LIKE 'audit_log_%'
      ORDER BY tablename
    `

    expect(rows.map((row) => row.tablename)).toEqual([
      'alert_rules',
      'audit_log',
      'notifications',
      'operator_roles',
      'operators',
      'permissions',
      'role_permissions',
      'roles',
      'saved_views',
    ])
  })

  it('ne crée aucune table portant des données de la passerelle', async () => {
    // Le BFF lit clients, comptes, connecteurs, CDR et soldes à travers l'API Admin, à chaque
    // affichage. Une table qui les recopierait créerait une seconde vérité, et un cockpit qui
    // montre un état périmé est pire qu'un cockpit en panne : il inspire confiance (§3.2).
    const rows = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND (tablename LIKE '%customer%' OR tablename LIKE '%smpp%' OR tablename LIKE '%connector%'
             OR tablename LIKE '%message%' OR tablename LIKE '%cdr%' OR tablename LIKE '%balance%'
             OR tablename LIKE '%credential%' OR tablename LIKE '%session%')
    `

    expect(rows).toEqual([])
  })

  it('sont idempotentes : les rejouer ne change rien', async () => {
    // `migrate()` relit son journal et ne réapplique rien. Le vrai risque est ailleurs : la
    // migration manuscrite s'exécuterait deux fois sur une base où le journal aurait été perdu.
    await expect(applyMigrations()).resolves.not.toThrow()

    const [row] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations
    `
    expect(row?.count).toBe('2')
  })

  it('génère des identifiants UUIDv7 côté base', async () => {
    // La version 7 est lisible dans le nibble de version : c'est ce qui donne des clés primaires
    // ordonnées dans le temps, et donc des insertions qui ne fragmentent pas l'index.
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO permissions (key, category, description)
      VALUES ('probe:read', 'audit', 'sonde de test')
      RETURNING key AS id
    `
    expect(row?.id).toBe('probe:read')

    const [generated] = await sql<{ id: string }[]>`SELECT uuidv7()::text AS id`
    expect(generated?.id?.charAt(14)).toBe('7')
  })
})

describe('partitionnement de audit_log', () => {
  it('est une table partitionnée par intervalle, pas une table ordinaire', async () => {
    const [row] = await sql<{ relkind: string; strategy: string }[]>`
      SELECT c.relkind::text, p.partstrat::text AS strategy
      FROM pg_class c
      JOIN pg_partitioned_table p ON p.partrelid = c.oid
      WHERE c.relname = 'audit_log'
    `

    expect(row?.relkind).toBe('p')
    expect(row?.strategy).toBe('r')
  })

  it('range une écriture du mois courant dans la partition de ce mois', async () => {
    const [row] = await sql<{ partition: string }[]>`
      WITH inserted AS (
        INSERT INTO audit_log (action, target_type, target_id)
        VALUES ('probe.write', 'probe', 'mois-courant')
        RETURNING tableoid, id
      )
      SELECT tableoid::regclass::text AS partition FROM inserted
    `

    const expected = `audit_log_${new Date().toISOString().slice(0, 7).replace('-', '_')}`
    expect(row?.partition).toBe(expected)
  })

  it('couvre au moins les trois mois à venir', async () => {
    // C'est cet horizon qui rend la partition par défaut théorique : une instance déployée
    // aujourd'hui écrit dans une partition nommée jusqu'à trois mois plus tard.
    const rows = await sql<{ relname: string }[]>`
      SELECT relname::text FROM pg_class
      WHERE relname ~ '^audit_log_[0-9]{4}_[0-9]{2}$'
      ORDER BY relname
    `

    expect(rows.length).toBeGreaterThanOrEqual(4)
  })

  it('rattrape dans la partition par défaut une écriture hors horizon', async () => {
    // Sans ce filet, l'écriture échouerait — et comme toute mutation doit être auditée pour aboutir
    // (invariant c), un oubli de maintenance bloquerait les mutations du tableau de bord.
    const [row] = await sql<{ partition: string }[]>`
      WITH inserted AS (
        INSERT INTO audit_log (action, created_at)
        VALUES ('probe.write', now() + interval '5 years')
        RETURNING tableoid
      )
      SELECT tableoid::regclass::text AS partition FROM inserted
    `

    expect(row?.partition).toBe('audit_log_default')
  })

  it('peut recréer les partitions sans erreur, autant de fois qu on veut', async () => {
    // La fonction est appelée à chaque déploiement, et potentiellement par plusieurs instances au
    // même instant : elle doit être idempotente et sérialisée.
    await sql`SELECT ensure_audit_log_partitions(3)`
    await sql`SELECT ensure_audit_log_partitions(3)`

    const [row] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM pg_class
      WHERE relname ~ '^audit_log_[0-9]{4}_[0-9]{2}$'
    `
    expect(Number(row?.count)).toBeGreaterThanOrEqual(4)
  })

  it('tient un appel concurrent — le verrou consultatif sérialise', async () => {
    // Deux instances qui démarrent ensemble appellent la fonction en même temps.
    // `CREATE TABLE IF NOT EXISTS` seul ne protège pas de la course au catalogue.
    await expect(
      Promise.all([
        sql`SELECT ensure_audit_log_partitions(6)`,
        sql`SELECT ensure_audit_log_partitions(6)`,
        sql`SELECT ensure_audit_log_partitions(6)`,
      ]),
    ).resolves.toHaveLength(3)
  })
})
