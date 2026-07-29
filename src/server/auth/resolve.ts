/**
 * Opérateur → l'ensemble de ses permissions.
 *
 * C'est l'**union** des paquets de ses rôles : pas de préséance, pas de niveau, pas d'héritage. Pour
 * savoir ce qu'un opérateur peut faire, on additionne. Un modèle à niveaux aurait exigé de résoudre
 * une priorité à chaque question, et cette résolution est exactement l'endroit où les failles
 * d'autorisation se logent.
 *
 * Cette fonction est la **source unique** de l'ensemble : `requirePermission()` (step-025) et la
 * réponse de `/auth/me` (step-022) s'y ramèneront tous les deux. Deux chemins de calcul finiraient
 * par diverger, et l'un des deux serait plus permissif.
 */

import { and, eq } from 'drizzle-orm'
import type { PermissionKey } from '~/lib/permissions'
import type { Database } from '../db/index'
import { operatorRoles, operators, rolePermissions } from '../db/schema/auth'

/**
 * Les permissions d'un opérateur **actif**, triées, sans doublon. Tableau vide s'il n'existe pas,
 * n'a aucun rôle, ou est désactivé.
 *
 * Le filtre sur `status` est ici, et pas chez l'appelant : désactiver un opérateur doit lui retirer
 * tout pouvoir immédiatement, sans avoir à défaire ses rattachements un par un. Le laisser à
 * l'appelant ferait dépendre la sécurité de l'endroit où le statut est vérifié — c'est-à-dire, à
 * terme, de nulle part.
 *
 * Le tri n'est pas cosmétique : il rend l'ensemble comparable d'un appel à l'autre, ce dont
 * dépendent l'`ETag` d'une réponse `/auth/me` et la lisibilité d'un `before_json` / `after_json`
 * dans le journal d'audit.
 */
export async function resolveOperatorPermissions(
  db: Database,
  operatorId: string,
): Promise<PermissionKey[]> {
  const rows = await db
    .selectDistinct({ key: rolePermissions.permissionKey })
    .from(operators)
    .innerJoin(operatorRoles, eq(operatorRoles.operatorId, operators.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, operatorRoles.roleId))
    .where(and(eq(operators.id, operatorId), eq(operators.status, 'active')))
    .orderBy(rolePermissions.permissionKey)

  // Le cast est le seul point où une clé de la base redevient une clé du catalogue. Il tient parce
  // que le seed fait autorité : `permission_key` est une clé étrangère vers `permissions`, dont le
  // contenu est exactement `PERMISSION_CATALOG` après chaque déploiement.
  return rows.map((row) => row.key as PermissionKey)
}
