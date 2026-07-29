/**
 * Le seed du catalogue et des rôles par défaut.
 *
 * Appelé à chaque déploiement, potentiellement par plusieurs instances au même instant. Il doit donc
 * être **idempotent** et **sérialisé** — même contrat que la maintenance des partitions d'audit, et
 * pour la même raison : deux instances qui démarrent ensemble sont le cas nominal, pas l'exception.
 *
 * ## Ce que le seed maintient, et ce qu'il ne maintient pas
 *
 * Il pose les 44 clés du catalogue et actualise leur libellé.
 *
 * Il ne fait autorité que sur l'**existence** des neuf rôles, jamais sur leur contenu — à une
 * exception près, `super_admin`, traitée plus bas. Les rôles par défaut sont éditables (§6.10) :
 * seule leur suppression est interdite, et c'est une garde d'écriture (step-027), pas l'affaire du
 * seed. Réimposer les paquets à chaque démarrage annulerait le travail d'un administrateur —
 * silencieusement, et à chaque redéploiement.
 *
 * **`super_admin` est réconcilié à chaque passage**, parce que son contrat n'est pas un paquet mais
 * une phrase : « toutes les permissions, sans exception » (§6.10). Sans cette réconciliation, une
 * clé ajoutée par une livraison future n'irait à personne — pas même au propriétaire — et l'écran
 * qu'elle garde deviendrait inaccessible à tout le monde, sans qu'une seule erreur ne le signale.
 * La réconciliation n'**ajoute** que ce qui manque : elle ne reprend jamais une clé, pour qu'un
 * administrateur puisse encore restreindre ce rôle s'il le décide.
 *
 * ## Le retrait des clés disparues est une opération séparée, et volontairement pénible
 *
 * Retirer une clé du catalogue emporte par cascade tous les `role_permissions` qui la référencent —
 * y compris dans des rôles personnalisés que personne ne pourra reconstituer. L'opération est
 * **irréversible et invisible**, et le scénario qui la déclenche par accident n'a rien d'exotique :
 * un déploiement bleu/vert, un rollback, ou un ancien conteneur qui redémarre et rejoue un seed
 * d'une version antérieure. Les clés de la version neuve disparaissent, le déploiement suivant
 * recrée les lignes de `permissions` — mais jamais les paquets qu'elles gardaient.
 *
 * Le seed **refuse donc de supprimer** par défaut : il rend la liste et laisse la base en l'état.
 * Le retrait demande `{ pruneRemovedKeys: true }`, c'est-à-dire `pnpm db:seed --prune`, lancé par
 * quelqu'un qui sait quelle version il déploie.
 */

import { eq, notInArray, sql } from 'drizzle-orm'
import { PERMISSION_CATALOG, PERMISSION_KEYS } from '~/lib/permissions'
import type { Database } from '../db/index'
import { permissions, rolePermissions, roles } from '../db/schema/auth'
import { DEFAULT_ROLES } from './default-roles'

export type SeedReport = {
  /** Clés retirées. Non vide seulement quand `pruneRemovedKeys` a été demandé explicitement. */
  readonly permissionsRemoved: readonly string[]
  /**
   * Clés présentes en base mais absentes du catalogue, laissées en place. Non vide signale une
   * base en avance sur le code qui la seede — typiquement un rollback ou un conteneur d'une
   * version antérieure. À regarder avant de lancer un `--prune`.
   */
  readonly staleKeys: readonly string[]
  /** Rôles créés par cet appel. Vide au second passage — c'est la signature de l'idempotence. */
  readonly rolesCreated: readonly string[]
  /** Clés ajoutées à `super_admin` pour tenir son contrat « toutes les permissions ». */
  readonly ownerPermissionsAdded: readonly string[]
}

export type SeedOptions = {
  /**
   * Autorise le retrait des clés absentes du catalogue, et la cascade sur `role_permissions` qui
   * va avec. Faux par défaut : voir l'en-tête de ce fichier.
   */
  readonly pruneRemovedKeys?: boolean
}

/**
 * Clé du verrou consultatif. Arbitraire mais stable, et distincte de celle de la maintenance des
 * partitions : deux opérations qui n'ont rien à voir ne doivent pas s'attendre l'une l'autre.
 */
const SEED_LOCK = 'seed_auth_catalog'

export async function seedAuth(db: Database, options: SeedOptions = {}): Promise<SeedReport> {
  // Une condition `NOT IN ()` vide est toujours vraie : le `DELETE` ci-dessous viderait la table.
  // Impossible aujourd'hui — le catalogue est un littéral — et gratuit à garder.
  /* v8 ignore next 3 -- garde défensive : le catalogue est un littéral non vide, l'inatteignabilité
     de cette branche est précisément ce qu'elle vaut. Elle existe pour le jour où il serait calculé. */
  if (PERMISSION_KEYS.length === 0) {
    throw new Error('Le catalogue de permissions est vide : refus de seeder.')
  }

  return db.transaction(async (tx) => {
    // Pris pour la durée de la transaction et relâché avec elle, y compris en cas d'erreur. Sans
    // lui, deux instances passeraient le test d'existence d'un rôle avant que l'autre ne l'insère,
    // et la seconde échouerait sur la contrainte d'unicité — au démarrage, donc en boucle de
    // redémarrage.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${SEED_LOCK}))`)

    // `excluded` désigne la ligne qu'on tentait d'insérer : la description et la catégorie du
    // catalogue écrasent celles de la base, sans avoir à comparer clé par clé.
    await tx
      .insert(permissions)
      .values([...PERMISSION_CATALOG])
      .onConflictDoUpdate({
        target: permissions.key,
        set: { category: sql`excluded.category`, description: sql`excluded.description` },
      })

    const stale = await tx
      .select({ key: permissions.key })
      .from(permissions)
      .where(notInArray(permissions.key, [...PERMISSION_KEYS]))

    const removed = options.pruneRemovedKeys
      ? await tx
          .delete(permissions)
          .where(notInArray(permissions.key, [...PERMISSION_KEYS]))
          .returning({ key: permissions.key })
      : []

    const created: string[] = []
    for (const role of DEFAULT_ROLES) {
      const [inserted] = await tx
        .insert(roles)
        .values({ name: role.name, description: role.description, isDefault: true })
        .onConflictDoNothing({ target: roles.name })
        .returning({ id: roles.id })

      // Rien de rendu : le rôle existait déjà. On ne touche pas à son paquet — voir l'en-tête.
      if (!inserted) continue

      created.push(role.name)
      await tx
        .insert(rolePermissions)
        .values(role.permissions.map((key) => ({ roleId: inserted.id, permissionKey: key })))
    }

    // Réconciliation de `super_admin` : le seul rôle dont le contrat est une phrase et non une
    // liste. `onConflictDoNothing` rend l'opération idempotente et purement additive — une clé que
    // ce rôle détient déjà n'est pas retouchée, et aucune ne lui est jamais reprise.
    const [owner] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, 'super_admin'))
    const ownerAdded = owner
      ? await tx
          .insert(rolePermissions)
          .values(PERMISSION_KEYS.map((key) => ({ roleId: owner.id, permissionKey: key })))
          .onConflictDoNothing()
          .returning({ key: rolePermissions.permissionKey })
      : []

    return {
      permissionsRemoved: removed.map((row) => row.key),
      staleKeys: stale.map((row) => row.key),
      rolesCreated: created,
      ownerPermissionsAdded: ownerAdded.map((row) => row.key),
    }
  })
}
