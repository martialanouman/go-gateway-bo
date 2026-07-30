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

import { readFileSync } from 'node:fs'
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

  // Au moins trois connexions : le test de verrou en occupe une qui attend, et il en faut d'autres
  // pour observer `pg_locks` pendant ce temps.
  const { client, db } = connect(container.getConnectionUri(), { poolSize: 5 })
  sql = client
  applyMigrations = () => migrate(db, { migrationsFolder: './drizzle' })

  await applyMigrations()
}, 180_000)

afterAll(async () => {
  await sql?.end({ timeout: 5 })
  await container?.stop()
})

/** Les partitions mensuelles présentes, triées — la partition par défaut n'en fait pas partie. */
async function partitionNames(): Promise<string[]> {
  const rows = await sql<{ relname: string }[]>`
    SELECT relname::text FROM pg_class
    WHERE relname ~ '^audit_log_[0-9]{4}_[0-9]{2}$'
    ORDER BY relname
  `
  return rows.map((row) => row.relname)
}

describe('migrations', () => {
  it('crée les douze tables que le BFF possède, et rien de plus', async () => {
    const rows = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT LIKE 'audit_log_%'
      ORDER BY tablename
    `

    expect(rows.map((row) => row.tablename)).toEqual([
      'alert_rules',
      'audit_log',
      'login_attempts',
      'notifications',
      'operator_recovery_codes',
      'operator_roles',
      'operator_sessions',
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
    //
    // `operator_sessions` est exclue **nommément**, et surtout pas en relâchant le motif : elle
    // porte les sessions d'opérateur du tableau de bord, pas les binds SMPP du §6.5. C'est
    // exactement l'homonymie que le préfixe `operator_` existe pour lever, et cette garde doit
    // continuer d'attraper une table `sessions` ou `smpp_sessions` qui apparaîtrait un jour.
    const rows = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND (tablename LIKE '%customer%' OR tablename LIKE '%smpp%' OR tablename LIKE '%connector%'
             OR tablename LIKE '%message%' OR tablename LIKE '%cdr%' OR tablename LIKE '%balance%'
             OR tablename LIKE '%credential%' OR tablename LIKE '%session%')
        AND tablename <> 'operator_sessions'
    `

    expect(rows).toEqual([])
  })

  it('ne réapplique rien quand on relance le migrator', async () => {
    await expect(applyMigrations()).resolves.not.toThrow()

    const [row] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations
    `
    expect(row?.count).toBe('6')
  })

  it('rejoue la migration manuscrite sans erreur ni dérive du catalogue', async () => {
    // Le test ci-dessus ne prouve que le comportement du migrator, pas le nôtre. Le vrai risque est
    // qu'un jour cette migration soit rejouée sur une base dont le journal a été perdu, ou copiée
    // dans une procédure de reprise. `0001` promet d'être idempotente : on l'exécute donc pour de
    // vrai, deux fois, hors du migrator.
    const manuscrite = readFileSync('./drizzle/0001_audit_log_partitions.sql', 'utf8')
    const statements = manuscrite
      .split('--> statement-breakpoint')
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0)

    const partitionsAvant = await partitionNames()

    for (const statement of statements) await sql.unsafe(statement)
    for (const statement of statements) await sql.unsafe(statement)

    expect(await partitionNames()).toEqual(partitionsAvant)
  })

  it('donne aux clés primaires un UUIDv7 par défaut de colonne', async () => {
    // On insère sans fournir d'`id`, dans une table qui en a un : c'est le DDL généré qu'on
    // exerce, pas la fonction de PostgreSQL. La version 7 se lit au quatorzième caractère, et c'est
    // elle qui donne des clés ordonnées dans le temps — donc des insertions qui ne fragmentent pas
    // l'index, contrairement à un UUIDv4.
    const [role] = await sql<{ id: string }[]>`
      INSERT INTO roles (name, description) VALUES ('probe_role', 'sonde') RETURNING id::text
    `
    expect(role?.id?.charAt(14)).toBe('7')

    // Deux identifiants générés à la suite doivent être croissants : c'est la propriété qui
    // distingue v7 de v4, et la raison de l'avoir choisi.
    const [second] = await sql<{ id: string }[]>`
      INSERT INTO roles (name, description) VALUES ('probe_role_2', 'sonde') RETURNING id::text
    `
    expect(second?.id?.localeCompare(role?.id ?? '')).toBe(1)
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

  it('couvre exactement le mois courant et les trois suivants', async () => {
    // C'est cet horizon qui rend la partition par défaut théorique. Compter les partitions ne
    // suffirait pas : inverser le signe de `make_interval` en créerait tout autant, dans le passé.
    // On compare donc les mois eux-mêmes, calculés côté base pour ne pas dépendre du fuseau de Node.
    const attendus = await sql<{ nom: string }[]>`
      SELECT 'audit_log_' || to_char(
               date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => n),
               'YYYY_MM'
             ) AS nom
      FROM generate_series(0, 3) AS n
      ORDER BY nom
    `

    const existants = await partitionNames()
    for (const { nom } of attendus) expect(existants).toContain(nom)
  })

  it('découpe les mois en UTC, quel que soit le fuseau de qui applique la migration', async () => {
    // Les bornes d'une partition sont figées à la création, en convertissant le littéral selon le
    // fuseau de la session. Une migration lancée depuis un poste à Paris découperait les mois à
    // minuit heure de Paris, la CI à minuit UTC — deux bases qui ne rangent pas les mêmes écritures
    // dans les mêmes partitions, et ça ne se voit qu'au passage d'un mois.
    // Un horizon plus lointain que celui déjà créé, pour que des partitions NEUVES naissent bien
    // sous ce fuseau — sinon la fonction ne crée rien et le test ne prouverait rien.
    await sql`SET TimeZone = 'Pacific/Auckland'`
    await sql`SELECT ensure_audit_log_partitions(12)`

    // Relire en UTC : `pg_get_expr` rend la borne dans le fuseau de la session, pas dans celui où
    // elle a été posée. Comparer le texte sous Auckland reviendrait à tester l'affichage.
    await sql`SET TimeZone = 'UTC'`
    const rows = await sql<{ relname: string; bound: string }[]>`
      SELECT c.relname::text, pg_get_expr(c.relpartbound, c.oid) AS bound
      FROM pg_class c
      WHERE c.relname ~ '^audit_log_[0-9]{4}_[0-9]{2}$'
      ORDER BY c.relname
    `

    expect(rows.length).toBeGreaterThanOrEqual(13)
    for (const { relname, bound } of rows) {
      // Sans le `set_config` de la fonction, les partitions créées ci-dessus auraient leurs bornes
      // à minuit heure d'Auckland, soit 11:00 ou 12:00 UTC la veille.
      expect(`${relname} ${bound}`).toContain('00:00:00+00')
    }
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
    // Elle doit être idempotente et sérialisée, plusieurs instances pouvant l'appeler au même
    // instant.
    //
    // **Elle n'est appelée par rien en production**, contrairement à ce qui était écrit ici :
    // l'unique appel réel est celui du corps de la migration 0001, et `drizzle-kit migrate`
    // n'applique une migration qu'une fois. L'horizon posé le jour de la première migration
    // s'épuise donc au bout de quelques mois, et les lignes tombent ensuite dans
    // `audit_log_default` — où leur seule présence rend la création du mois correspondant
    // définitivement impossible (voir le garde-fou de la migration). C'est step-187 qui pose la
    // maintenance périodique ; d'ici là, la partition par défaut fait office de filet et rien
    // n'échoue, mais la table redevient monolithique en silence.
    await sql`SELECT ensure_audit_log_partitions(3)`
    await sql`SELECT ensure_audit_log_partitions(3)`

    const [row] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM pg_class
      WHERE relname ~ '^audit_log_[0-9]{4}_[0-9]{2}$'
    `
    expect(Number(row?.count)).toBeGreaterThanOrEqual(4)
  })

  it('sérialise les appels concurrents par un verrou, de façon observable', async () => {
    // Lancer trois appels en parallèle et constater qu'aucun ne lève ne prouverait rien : sans
    // verrou, la collision au catalogue est probabiliste et le test passerait la plupart du temps.
    // On observe donc le verrou lui-même : une transaction qui le détient et ne committe pas doit
    // faire attendre la suivante, visible dans `pg_locks` avec `granted = false`.
    const premiere = sql.begin(async (tx) => {
      await tx`SELECT ensure_audit_log_partitions(3)`
      await attenteVisible()
    })

    const seconde = sql`SELECT ensure_audit_log_partitions(3)`

    await expect(Promise.all([premiere, seconde])).resolves.toHaveLength(2)
  })

  /** Attend qu'un second appelant soit effectivement en file sur le verrou consultatif. */
  async function attenteVisible(): Promise<void> {
    for (let essai = 0; essai < 100; essai++) {
      const [row] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted
      `
      if (Number(row?.count) > 0) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error("Aucun appelant n'a attendu le verrou : la sérialisation n'est pas prouvée.")
  }
})
