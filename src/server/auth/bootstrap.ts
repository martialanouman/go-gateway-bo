/**
 * Création du **premier** `super_admin` — l'amorçage d'une installation neuve.
 *
 * C'est la seule façon d'obtenir un premier compte : sans lui, personne ne peut se connecter, donc
 * personne ne peut créer d'opérateur par l'écran de gestion (step-027). Une fois ce compte créé,
 * cette commande refuse de s'exécuter à nouveau.
 *
 * ## Pourquoi ce refus n'est pas une commodité
 *
 * Une commande hors ligne capable de créer un `super_admin` à tout moment contournerait les deux
 * garanties du modèle : la garde `operators:manage` et l'écriture d'audit nominative. Quiconque
 * atteint le shell d'un conteneur s'accorderait la plateforme entière sans laisser de trace. Le
 * garde-fou est donc « **aucun** opérateur en base », et non « aucun `super_admin` » : le second se
 * contournerait en désactivant le compte existant.
 *
 * Le corollaire est que la création doit être **atomique**. Un opérateur inséré puis un échec sur
 * l'attribution du rôle laisserait un compte sans pouvoir — et le garde-fou interdirait alors toute
 * nouvelle tentative. L'installation serait bloquée, réparable seulement à la main en base.
 */

import { count as countRows, eq, sql } from 'drizzle-orm'
import type { Database } from '../db/index'
import { operatorRoles, operators, roles } from '../db/schema/auth'
import { hashPassword, type ScryptParameters } from './password'
import { checkPasswordPolicy, explainRejection } from './password-policy'
import { seedAuth } from './seed'

export type BootstrapIdentity = {
  readonly email: string
  readonly displayName: string
  readonly password: string
}

/**
 * Lit l'identité du premier administrateur dans l'environnement.
 *
 * **Par l'environnement et pas par les arguments**, et ce n'est pas un détail de confort : la ligne
 * de commande d'un processus est lisible par tout utilisateur de la machine (`ps aux`) et atterrit
 * dans l'historique du shell. Un mot de passe passé en argument est un mot de passe divulgué.
 */
export function readBootstrapIdentity(env: NodeJS.ProcessEnv): BootstrapIdentity {
  const email = env.BOOTSTRAP_ADMIN_EMAIL
  const password = env.BOOTSTRAP_ADMIN_PASSWORD
  const displayName = env.BOOTSTRAP_ADMIN_NAME

  // Nommer la variable manquante, pas « la configuration est incomplète » : l'exploitant qui lance
  // cette commande est au milieu d'une installation et n'a pas le fichier sous les yeux.
  const missing = [
    ['BOOTSTRAP_ADMIN_EMAIL', email],
    ['BOOTSTRAP_ADMIN_PASSWORD', password],
    ['BOOTSTRAP_ADMIN_NAME', displayName],
  ].flatMap(([name, value]) => (value ? [] : [name]))

  if (missing.length > 0) {
    throw new Error(`Variables d'environnement requises et absentes : ${missing.join(', ')}.`)
  }

  return {
    email: (email as string).trim(),
    password: password as string,
    displayName: (displayName as string).trim(),
  }
}

/** Verrou consultatif propre à l'amorçage, distinct de celui du seed. */
const BOOTSTRAP_LOCK = 'bootstrap_super_admin'

export async function bootstrapSuperAdmin(
  db: Database,
  identity: BootstrapIdentity,
  parameters?: ScryptParameters,
): Promise<{ operatorId: string }> {
  // Validé avant de toucher la base, et avant de hacher : inutile de dépenser 166 ms et 128 Mio sur
  // une saisie que l'on refusera de toute façon.
  if (!/^[^\s@]+@[^\s@]+$/.test(identity.email)) {
    throw new Error("L'adresse email du premier administrateur est invalide.")
  }
  // La même politique que partout ailleurs (step-021), et non une règle propre à l'amorçage : deux
  // politiques finiraient par diverger, et c'est celle du compte le plus puissant qui serait la plus
  // faible.
  const rejection = checkPasswordPolicy(identity.password, [identity.email, identity.displayName])
  if (rejection) {
    throw new Error(`Mot de passe du premier administrateur refusé. ${explainRejection(rejection)}`)
  }

  const passwordHash = await hashPassword(identity.password, parameters)

  return db.transaction(async (tx) => {
    // **Sans ce verrou, le garde-fou ci-dessous ne garde rien.** Une transaction PostgreSQL est en
    // `READ COMMITTED` par défaut : deux bootstraps simultanés sur une base vide comptent tous deux
    // zéro, insèrent deux emails différents — que l'index d'unicité sur `lower(email)` ne peut donc
    // pas départager — et committent tous les deux. Deux `super_admin`, dont un que personne n'a
    // voulu et qu'aucun audit ne mentionne. Le verrou sérialise, et se relâche avec la transaction.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${BOOTSTRAP_LOCK}))`)

    const [existing] = await tx.select({ total: countRows() }).from(operators)
    if ((existing?.total ?? 0) > 0) {
      throw new Error(
        'Un opérateur existe déjà : le bootstrap ne sert qu’à créer le tout premier compte. ' +
          'Les suivants se créent depuis l’écran de gestion des opérateurs, sous une permission et avec un audit.',
      )
    }

    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, 'super_admin'))
    if (!role) {
      // Sans ce contrôle, l'échec remonterait comme une violation de clé étrangère sur
      // `operator_roles` — une erreur qui dit ce qui a cassé, jamais quoi faire ensuite.
      throw new Error(
        'Le rôle super_admin est absent : lancer le seed du catalogue avant le bootstrap.',
      )
    }

    const [operator] = await tx
      .insert(operators)
      .values({ email: identity.email, displayName: identity.displayName, passwordHash })
      .returning({ id: operators.id })

    if (!operator) throw new Error("L'opérateur n'a pas pu être créé.")

    await tx.insert(operatorRoles).values({ operatorId: operator.id, roleId: role.id })

    return { operatorId: operator.id }
  })
}

/**
 * L'installation complète : le catalogue, puis le premier administrateur.
 *
 * L'ordre est une décision, pas de la plomberie — `bootstrapSuperAdmin` a besoin du rôle
 * `super_admin`, donc du seed. Elle vit donc ici, sous test, plutôt que dans le point d'entrée en
 * ligne de commande, qui est exclu de la mesure de couverture.
 */
export async function installFirstAdministrator(
  db: Database,
  identity: BootstrapIdentity,
  parameters?: ScryptParameters,
): Promise<{ operatorId: string }> {
  await seedAuth(db)
  return bootstrapSuperAdmin(db, identity, parameters)
}
