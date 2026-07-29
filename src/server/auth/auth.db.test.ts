/**
 * Seed, résolution des permissions et bootstrap, contre un vrai PostgreSQL 18.
 *
 * Les trois partagent un fichier — donc un conteneur — parce que `fileParallelism: false` fait payer
 * un démarrage d'image par fichier `*.db.test.ts`. Ils partagent aussi leur sujet : ce que le seed
 * écrit est exactement ce que la résolution relit, et ce sur quoi le bootstrap s'appuie.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_CATALOG } from '~/lib/permissions'
import { connect, type Database } from '../db/index'
import { bootstrapSuperAdmin, installFirstAdministrator } from './bootstrap'
import { DEFAULT_ROLES } from './default-roles'
import { verifyPassword } from './password'
import { resolveOperatorPermissions } from './resolve'
import { seedAuth } from './seed'

/**
 * Paramètres de hachage allégés : le bootstrap est testé pour ce qu'il écrit, pas pour le coût de
 * scrypt. `password.test.ts` couvre les paramètres réels.
 */
const RAPIDE = { N: 1024, r: 8, p: 1 } as const

const POSTGRES_IMAGE = 'postgres:18-alpine'

let container: StartedPostgreSqlContainer
let sql: postgres.Sql
let db: Database

beforeAll(async () => {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start()
  const connection = connect(container.getConnectionUri(), { poolSize: 5 })
  sql = connection.client
  db = connection.db
  await migrate(db, { migrationsFolder: './drizzle' })
}, 180_000)

afterAll(async () => {
  await sql?.end({ timeout: 5 })
  await container?.stop()
})

/** Table rase avant chaque cas : le seed doit être jugé sur son effet, pas sur celui du cas d'avant. */
beforeEach(async () => {
  await sql`TRUNCATE operators, roles, permissions RESTART IDENTITY CASCADE`
})

async function count(table: string): Promise<number> {
  const [row] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM ${sql(table)}
  `
  return Number(row?.count)
}

describe('seed du catalogue et des rôles', () => {
  it('pose les 44 permissions et les 9 rôles sur une base vide', async () => {
    await seedAuth(db)

    expect(await count('permissions')).toBe(PERMISSION_CATALOG.length)
    expect(await count('roles')).toBe(DEFAULT_ROLES.length)
  })

  it('donne le même état après deux exécutions', async () => {
    // L'idempotence n'est pas un confort : le seed tourne à chaque déploiement, et sur ≥2 instances.
    // Comparer les identifiants de rôle, et pas seulement les comptes, est ce qui compte — recréer
    // un rôle à l'identique sous un nouvel `id` détacherait tous ses opérateurs par cascade.
    await seedAuth(db)
    const avant = await sql<{ id: string; name: string }[]>`
      SELECT id::text, name FROM roles ORDER BY name
    `

    await seedAuth(db)

    expect(
      await sql<{ id: string; name: string }[]>`SELECT id::text, name FROM roles ORDER BY name`,
    ).toEqual(avant)
    expect(await count('permissions')).toBe(PERMISSION_CATALOG.length)
    expect(await count('role_permissions')).toBe(
      DEFAULT_ROLES.reduce((total, role) => total + role.permissions.length, 0),
    )
  })

  it('signale une clé absente du catalogue sans la retirer', async () => {
    // **Le retrait ne se fait plus par défaut.** Une clé supprimée emporte par cascade tous les
    // `role_permissions` qui la référencent, y compris dans des rôles personnalisés que personne ne
    // pourra reconstituer. Or le scénario qui déclenche ce retrait par accident est banal : un
    // rollback, un bleu/vert, ou un vieux conteneur qui rejoue le seed d'une version antérieure. Les
    // clés de la version neuve disparaissent, le déploiement suivant recrée les lignes de
    // `permissions` — mais jamais les paquets qu'elles gardaient.
    await seedAuth(db)
    await sql`INSERT INTO permissions (key, category, description) VALUES ('legacy:key', 'admin', 'Permission d une livraison passée')`
    const [role] = await sql<{ id: string }[]>`SELECT id::text FROM roles WHERE name = 'ops'`
    await sql`INSERT INTO role_permissions (role_id, permission_key) VALUES (${role?.id ?? ''}, 'legacy:key')`

    const report = await seedAuth(db)

    expect(report.staleKeys).toEqual(['legacy:key'])
    expect(report.permissionsRemoved).toEqual([])
    expect(await sql`SELECT 1 FROM permissions WHERE key = 'legacy:key'`).toHaveLength(1)
    expect(
      await sql`SELECT 1 FROM role_permissions WHERE permission_key = 'legacy:key'`,
    ).toHaveLength(1)
  })

  it('retire la clé, et ce qu elle gardait, quand le retrait est demandé explicitement', async () => {
    // `pnpm db:seed --prune`, lancé par quelqu'un qui sait quelle version il déploie.
    await seedAuth(db)
    await sql`INSERT INTO permissions (key, category, description) VALUES ('legacy:key', 'admin', 'Permission d une livraison passée')`
    const [role] = await sql<{ id: string }[]>`SELECT id::text FROM roles WHERE name = 'ops'`
    await sql`INSERT INTO role_permissions (role_id, permission_key) VALUES (${role?.id ?? ''}, 'legacy:key')`

    const report = await seedAuth(db, { pruneRemovedKeys: true })

    expect(report.permissionsRemoved).toEqual(['legacy:key'])
    expect(await sql`SELECT 1 FROM permissions WHERE key = 'legacy:key'`).toHaveLength(0)
    expect(
      await sql`SELECT 1 FROM role_permissions WHERE permission_key = 'legacy:key'`,
    ).toHaveLength(0)
  })

  it('rend à super_admin une clé du catalogue qu il ne détient pas', async () => {
    // Le contrat de ce rôle est une phrase — « toutes les permissions, sans exception » — et pas une
    // liste. Sans cette réconciliation, une clé ajoutée par une livraison future n'irait à personne,
    // pas même au propriétaire : l'écran qu'elle garde deviendrait inaccessible à tout le monde, en
    // silence. C'est le scénario de **chaque montée de version** sur une base déjà installée.
    await seedAuth(db)
    const [role] = await sql<
      { id: string }[]
    >`SELECT id::text FROM roles WHERE name = 'super_admin'`
    await sql`DELETE FROM role_permissions WHERE role_id = ${role?.id ?? ''} AND permission_key = 'connectors:rebind'`

    const report = await seedAuth(db)

    expect(report.ownerPermissionsAdded).toEqual(['connectors:rebind'])
  })

  it('n ajoute rien à super_admin au second passage', async () => {
    await seedAuth(db)

    expect((await seedAuth(db)).ownerPermissionsAdded).toEqual([])
  })

  it('actualise la description et la catégorie d une clé qui a changé', async () => {
    await seedAuth(db)
    await sql`UPDATE permissions SET description = 'texte périmé', category = 'admin' WHERE key = 'audit:read'`

    await seedAuth(db)

    const [row] = await sql<{ description: string; category: string }[]>`
      SELECT description, category::text FROM permissions WHERE key = 'audit:read'
    `
    expect(row?.category).toBe('audit')
    expect(row?.description).not.toBe('texte périmé')
  })

  it('marque les neuf rôles comme livrés avec le produit', async () => {
    await seedAuth(db)

    const rows = await sql<{ name: string }[]>`
      SELECT name FROM roles WHERE is_default = false ORDER BY name
    `
    expect(rows).toEqual([])
  })

  it('ne réimpose pas le paquet d un rôle par défaut qu un administrateur a modifié', async () => {
    // Les rôles par défaut sont **éditables** (§6.10) : seule leur suppression est interdite. Un
    // seed qui rétablirait les paquets à chaque déploiement annulerait silencieusement le travail
    // d'un administrateur — et le lui rendrait au redémarrage suivant, ce qui est pire qu'un refus.
    await seedAuth(db)
    const [role] = await sql<{ id: string }[]>`SELECT id::text FROM roles WHERE name = 'ops'`
    await sql`DELETE FROM role_permissions WHERE role_id = ${role?.id ?? ''} AND permission_key = 'sessions:disconnect'`

    await seedAuth(db)

    expect(
      await sql`SELECT 1 FROM role_permissions WHERE role_id = ${role?.id ?? ''} AND permission_key = 'sessions:disconnect'`,
    ).toHaveLength(0)
  })

  it('recrée un rôle par défaut supprimé à la main, avec son paquet initial', async () => {
    // Le pendant du test précédent : ce que le seed maintient, c'est l'**existence** des neuf rôles,
    // pas leur contenu. Une base à qui il manque `auditor` n'a plus de rôle de revue.
    await seedAuth(db)
    await sql`DELETE FROM roles WHERE name = 'auditor'`

    await seedAuth(db)

    const rows = await sql<{ permission_key: string }[]>`
      SELECT rp.permission_key FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      WHERE r.name = 'auditor'
    `
    expect(rows.map((row) => row.permission_key)).toEqual(['audit:read'])
  })
})

describe('résolution des permissions d un opérateur', () => {
  beforeEach(async () => {
    await seedAuth(db)
  })

  async function createOperator(email: string): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO operators (email, display_name, password_hash)
      VALUES (${email}, 'Opérateur de test', 'hachage-factice')
      RETURNING id::text
    `
    return row?.id ?? ''
  }

  async function grant(operatorId: string, roleName: string): Promise<void> {
    await sql`
      INSERT INTO operator_roles (operator_id, role_id)
      SELECT ${operatorId}::uuid, id FROM roles WHERE name = ${roleName}
    `
  }

  it('rend exactement les permissions du rôle unique d un opérateur', async () => {
    const id = await createOperator('auditeur@example.test')
    await grant(id, 'auditor')

    expect(await resolveOperatorPermissions(db, id)).toEqual(['audit:read'])
  })

  it('rend l union de deux rôles, sans doublon', async () => {
    // C'est la propriété qui définit le modèle : pas de préséance, pas de niveau — une addition.
    // Un opérateur qui cumule `auditor` et `billing_readonly` obtient les deux lectures.
    const id = await createOperator('cumul@example.test')
    await grant(id, 'auditor')
    await grant(id, 'billing_readonly')

    expect(await resolveOperatorPermissions(db, id)).toEqual(['audit:read', 'billing:read'])
  })

  it('ne rend rien pour un opérateur sans rôle', async () => {
    // Le défaut est le refus. Un opérateur créé sans rôle ne peut rien faire — et surtout pas se
    // retrouver avec un accès par omission.
    const id = await createOperator('sans-role@example.test')

    expect(await resolveOperatorPermissions(db, id)).toEqual([])
  })

  it('ne rend rien pour un opérateur qui n existe pas', async () => {
    expect(await resolveOperatorPermissions(db, '00000000-0000-7000-8000-000000000000')).toEqual([])
  })

  it('ne rend rien pour un opérateur désactivé, même s il détient des rôles', async () => {
    // Désactiver un opérateur doit lui retirer tout pouvoir immédiatement, sans avoir à défaire ses
    // rattachements. Laisser la résolution répondre pour un compte désactivé ferait dépendre la
    // sécurité de l'endroit où le statut est vérifié — c'est-à-dire de personne en particulier.
    const id = await createOperator('parti@example.test')
    await grant(id, 'super_admin')
    await sql`UPDATE operators SET status = 'disabled' WHERE id = ${id}::uuid`

    expect(await resolveOperatorPermissions(db, id)).toEqual([])
  })

  it('perd les permissions d un rôle retiré de l opérateur', async () => {
    const id = await createOperator('mouvement@example.test')
    await grant(id, 'billing_readonly')
    await sql`DELETE FROM operator_roles WHERE operator_id = ${id}::uuid`

    expect(await resolveOperatorPermissions(db, id)).toEqual([])
  })
})

describe('bootstrap du premier super_admin', () => {
  const IDENTITE = {
    email: 'proprietaire@example.test',
    displayName: 'Propriétaire',
    password: 'un mot de passe assez long',
  } as const

  beforeEach(async () => {
    await seedAuth(db)
  })

  it('crée un opérateur qui détient tout le catalogue', async () => {
    const { operatorId } = await bootstrapSuperAdmin(db, IDENTITE, RAPIDE)

    expect(await resolveOperatorPermissions(db, operatorId)).toHaveLength(PERMISSION_CATALOG.length)
  })

  it('stocke un mot de passe vérifiable, et jamais en clair', async () => {
    await bootstrapSuperAdmin(db, IDENTITE, RAPIDE)

    const [row] = await sql<{ password_hash: string }[]>`
      SELECT password_hash FROM operators WHERE email = ${IDENTITE.email}
    `
    expect(row?.password_hash).not.toContain(IDENTITE.password)
    await expect(verifyPassword(IDENTITE.password, row?.password_hash ?? '')).resolves.toBe(true)
  })

  it('refuse de s exécuter quand un opérateur existe déjà', async () => {
    // C'est un **bootstrap**, pas une commande de création d'opérateur : celle-ci passera par
    // l'écran de step-027, gardée par `operators:manage` et auditée. Une commande hors ligne capable
    // de créer un `super_admin` à tout moment contournerait les deux — quiconque atteint le shell du
    // conteneur s'accorderait la plateforme entière, sans laisser de trace nominative.
    await bootstrapSuperAdmin(db, IDENTITE, RAPIDE)

    await expect(
      bootstrapSuperAdmin(db, { ...IDENTITE, email: 'second@example.test' }, RAPIDE),
    ).rejects.toThrow(/existe déjà/i)
  })

  it('sérialise les amorçages concurrents par un verrou, de façon observable', async () => {
    // **Le trou que le test séquentiel ci-dessus ne peut pas voir.** Une transaction PostgreSQL est
    // en `READ COMMITTED` : sans verrou, deux appels concurrents comptent tous deux zéro opérateur,
    // insèrent deux emails différents — que l'index d'unicité sur `lower(email)` ne peut donc pas
    // départager — et committent tous les deux. Deux `super_admin`, dont un que personne n'a voulu
    // et qu'aucun audit ne mentionne.
    //
    // Lancer deux `bootstrapSuperAdmin` en parallèle **ne le prouverait pas** : vérifié, un tel test
    // reste vert même après avoir retiré le verrou du code, parce que rien ne garantit que les deux
    // transactions se chevauchent réellement. On observe donc le verrou lui-même — une transaction
    // qui le détient sans committer doit faire attendre l'amorçage — exactement comme le fait déjà
    // `migrations.db.test.ts` pour la maintenance des partitions.
    const bloquante = sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('bootstrap_super_admin'))`
      await attenteVisible()
    })

    const amorcage = bootstrapSuperAdmin(db, IDENTITE, RAPIDE)

    await expect(Promise.all([bloquante, amorcage])).resolves.toHaveLength(2)
    expect(await count('operators')).toBe(1)
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
    throw new Error("Aucun amorçage n'a attendu le verrou : la sérialisation n'est pas prouvée.")
  }

  it('installe tout en une commande : catalogue puis premier administrateur', async () => {
    // `installFirstAdministrator` porte l'**ordre** — le bootstrap a besoin du rôle `super_admin`,
    // donc du seed. Cet ordre est une décision, et il vit sous test plutôt que dans le point d'entrée
    // en ligne de commande, qui est exclu de la mesure de couverture.
    await sql`TRUNCATE operators, roles, permissions RESTART IDENTITY CASCADE`

    const { operatorId } = await installFirstAdministrator(db, IDENTITE, RAPIDE)

    expect(await count('roles')).toBe(DEFAULT_ROLES.length)
    expect(await resolveOperatorPermissions(db, operatorId)).toHaveLength(PERMISSION_CATALOG.length)
  })

  it('refuse un mot de passe trop court pour un compte qui détient tout', async () => {
    await expect(
      bootstrapSuperAdmin(db, { ...IDENTITE, password: 'court' }, RAPIDE),
    ).rejects.toThrow(/12/)
  })

  it('refuse un email vide ou sans arobase', async () => {
    for (const email of ['', 'pas-un-email', '@example.test', 'a@']) {
      await expect(bootstrapSuperAdmin(db, { ...IDENTITE, email }, RAPIDE), email).rejects.toThrow(
        /adresse/i,
      )
    }
  })

  it('explique clairement que le seed doit précéder, plutôt que d échouer sur une clé étrangère', async () => {
    // Le mode d'échec à éviter : une erreur PostgreSQL brute sur `operator_roles` au moment où un
    // exploitant installe la plateforme. Elle ne dit pas quoi faire ; le message, si.
    await sql`DELETE FROM roles WHERE name = 'super_admin'`

    await expect(bootstrapSuperAdmin(db, IDENTITE, RAPIDE)).rejects.toThrow(/seed/i)
  })

  it('ne laisse aucun opérateur derrière lui quand l attribution du rôle échoue', async () => {
    // Sans transaction, un échec après l'insertion de l'opérateur laisserait un compte **sans rôle
    // mais existant** — et le garde-fou « un opérateur existe déjà » interdirait alors toute
    // nouvelle tentative. La plateforme serait définitivement sans administrateur, réparable
    // seulement à la main en base.
    await sql`DELETE FROM roles WHERE name = 'super_admin'`

    await expect(bootstrapSuperAdmin(db, IDENTITE, RAPIDE)).rejects.toThrow()
    expect(await count('operators')).toBe(0)
  })

  it('traite l unicité de l email sans distinguer la casse', async () => {
    // L'index d'unicité est posé sur `lower(email)` : la violation doit remonter comme une erreur
    // claire, pas comme deux comptes distincts pour la même personne.
    await sql`INSERT INTO operators (email, display_name, password_hash) VALUES ('Proprietaire@Example.test', 'Doublon', 'x')`

    await expect(
      bootstrapSuperAdmin(db, { ...IDENTITE, email: 'proprietaire@example.test' }, RAPIDE),
    ).rejects.toThrow(/existe déjà/i)
  })
})
