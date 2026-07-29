/**
 * Les neuf rôles livrés avec le produit (§6.10).
 *
 * Un rôle est un **paquet nommé de permissions**, rien d'autre : pas de niveau, pas de hiérarchie,
 * pas d'héritage. Un opérateur qui en détient plusieurs obtient l'**union** de leurs clés. C'est ce
 * qui rend l'autorisation lisible : pour savoir ce qu'un opérateur peut faire, on additionne, on ne
 * résout pas une préséance.
 *
 * Ces neuf-là sont `is_default = true` : **non supprimables, mais éditables**. Un administrateur qui
 * retire une clé de `ops` la retire pour de bon — le seed ne réimpose pas les paquets à chaque
 * démarrage, il ne crée que ce qui manque (voir `seed.ts`). Cette table est donc l'état *initial*,
 * pas un état maintenu.
 *
 * ## Ce qui est écrit dans le §6.10, et ce qui est interprété
 *
 * Six règles y sont énoncées au caractère près, et les tests les figent : `ops` a
 * `suppressions:read/write` **sans** `:delete` ; `script_author` n'a **pas** `scripts:publish` ;
 * `support_readonly` n'a **jamais** `content:read` ; `compliance` est le seul rôle par défaut avec
 * `suppressions:delete` et `gdpr:erase`, et n'a **pas** `content:read` ; `account_manager` n'a pas
 * `billing:topup`.
 *
 * Le reste demande une interprétation, et il vaut mieux qu'elle soit écrite ici qu'improvisée :
 *
 * - **« lecture seule ailleurs »** (`billing_admin`) et **« lecture seule (comptes, routage,
 *   sessions, CDR/trace, facturation) »** (`support_readonly`) sont rendus par `READ_ONLY_BASELINE`
 *   ci-dessous. Quatre clés de lecture en sont exclues par principe et non par oubli :
 *   `content:read` (jamais implicite), `credentials:read` (le §6.10 écarte explicitement les
 *   identifiants du support), `scripts:read` (le code source d'un script est de la propriété
 *   intellectuelle de routage, écartée elle aussi) et `audit:read` (voir `SENSITIVE_READS`).
 * - **`senderrewrite:read` n'est pas dans ce socle.** Le §6.10 énumère « routage … réécriture »
 *   comme deux choses distinctes dans la ligne `ops` ; « routage » seul ne peut donc pas emporter la
 *   réécriture ailleurs.
 * - **`ops` n'a ni `customers:*` ni `accounts:*`.** Le §6.10 ne les lui donne pas, et un rôle ne
 *   s'élargit pas par confort. C'est un point à confirmer en exploitation : le moniteur de sessions
 *   affiche des binds rattachés à des comptes, et le rôle pourrait s'y trouver à l'étroit. Le
 *   corriger sera un amendement du §6.10, pas une rustine ici.
 */

import type { PermissionKey } from '~/lib/permissions'
import { PERMISSION_KEYS } from '~/lib/permissions'

export type DefaultRole = {
  readonly name: string
  readonly description: string
  readonly permissions: readonly PermissionKey[]
}

/**
 * Le socle de lecture d'un rôle décrit comme « lecture seule ailleurs ».
 *
 * Défini par soustraction plutôt que par énumération : une clé `:read` ajoutée plus tard au
 * catalogue rejoint automatiquement ce socle, au lieu d'être oubliée dans une liste écrite à la
 * main. Le mode d'échec inverse — une lecture sensible qui rejoindrait le socle sans qu'on le
 * remarque — est couvert par `SENSITIVE_READS`, qu'il faut modifier explicitement.
 */
const SENSITIVE_READS: readonly PermissionKey[] = [
  'content:read',
  'credentials:read',
  'scripts:read',
  // `audit:read` a rejoint cette liste après coup, et l'oubli valait la peine d'être écrit : le
  // socle « toutes les clés `:read` » l'avait donné à `support_readonly` et à `billing_admin` sans
  // que personne ne le décide. Or le journal d'audit porte la trace nominative de chaque lecture de
  // corps de message et les `before_json`/`after_json` de toute mutation — le donner au rôle le plus
  // large vide de sens le rôle `auditor`, dont c'est la seule permission. Il reste accordé
  // explicitement à `ops` (« lecture seule facturation/audit », §6.10).
  'audit:read',
]

const READ_ONLY_BASELINE: readonly PermissionKey[] = PERMISSION_KEYS.filter(
  (key) => key.endsWith(':read') && !SENSITIVE_READS.includes(key),
)

/**
 * Assemble un paquet à partir du socle de lecture.
 *
 * Passer par une fonction typée plutôt que par un littéral étalé n'est pas cosmétique : un
 * `[...socle, 'cdr:read_pii']` s'élargit en `string[]`, et le paquet perd exactement la vérification
 * qui empêche d'y glisser une clé absente du catalogue — c'est-à-dire une permission qui n'ouvrirait
 * jamais rien, silencieusement.
 */
function fromBaseline(options: {
  without: readonly PermissionKey[]
  with: readonly PermissionKey[]
}): readonly PermissionKey[] {
  // Les deux champs sont requis, sans valeur par défaut : un `?? []` non exercé est une branche que
  // la couverture signale à raison, et surtout un appelant peut oublier `without` sans s'en rendre
  // compte — c'est-à-dire élargir un rôle par omission.
  return [...READ_ONLY_BASELINE.filter((key) => !options.without.includes(key)), ...options.with]
}

export const DEFAULT_ROLES: readonly DefaultRole[] = [
  {
    name: 'super_admin',
    description: 'Propriétaire de la plateforme : toutes les permissions, sans exception',
    permissions: PERMISSION_KEYS,
  },
  {
    name: 'ops',
    description:
      'Exploitation réseau : routage, connecteurs, sessions, anti-spam et scripts, en lecture et en écriture',
    permissions: [
      'routes:read',
      'routes:write',
      'routes:import',
      'scripts:read',
      'scripts:write',
      // La publication est bien à `ops` : le §6.10 la retire à `script_author` au motif d'une
      // « revue par `ops`/`super_admin` », ce qui n'a de sens que si `ops` peut publier.
      'scripts:publish',
      'senderrewrite:read',
      'senderrewrite:write',
      'connectors:read',
      'connectors:write',
      'connectors:rebind',
      'sessions:read',
      'sessions:disconnect',
      'antispam:read',
      'antispam:write',
      'inbound:read',
      'inbound:write',
      'suppressions:read',
      'suppressions:write',
      'alerts:read',
      'alerts:write',
      'billing:read',
      'audit:read',
      'cdr:read_pii',
      'cdr:export_bulk',
    ],
  },
  {
    name: 'script_author',
    description:
      'Ingénierie des scripts de routage : écrire et versionner, la mise en production restant à ops',
    permissions: ['scripts:read', 'scripts:write'],
  },
  {
    name: 'support_readonly',
    description:
      'Support niveau 1 : consultation seule, sans corps de message, sans identifiant, sans code de script',
    permissions: fromBaseline({ without: ['senderrewrite:read'], with: ['cdr:read_pii'] }),
  },
  {
    name: 'billing_admin',
    description: 'Finance : facturation complète, consultation seule sur le reste de la plateforme',
    permissions: fromBaseline({
      // Mêmes exclusions que `support_readonly`, la réécriture comprise : « lecture seule ailleurs »
      // ne peut pas être plus large que le rôle de lecture seule de référence.
      without: ['senderrewrite:read'],
      with: ['billing:write', 'billing:topup', 'billing:provider:write', 'billing:scope_change'],
    }),
  },
  {
    name: 'billing_readonly',
    description: 'Reporting financier : consultation des soldes et du grand livre, rien d’autre',
    permissions: ['billing:read'],
  },
  {
    name: 'account_manager',
    description:
      'Onboarding client : clients, comptes SMPP, identifiants et groupes, sans routage ni recharge',
    permissions: [
      'customers:read',
      'customers:write',
      'accounts:read',
      'accounts:write',
      'credentials:read',
      'credentials:write',
      'credentials:rotate',
      'groups:read',
      'groups:write',
      'billing:read',
      'billing:write',
      // `balance_scope` se fixe à l'ouverture d'un client : c'est un acte d'onboarding, et le §6.10
      // n'exclut de ce rôle que le routage, les connecteurs, `billing:topup` et le fournisseur de
      // facturation.
      'billing:scope_change',
    ],
  },
  {
    name: 'compliance',
    description:
      'Conformité et juridique : désabonnements, effacements RGPD, consultation des comptes et des CDR',
    permissions: [
      'suppressions:read',
      'suppressions:write',
      'suppressions:delete',
      'inbound:read',
      'gdpr:erase',
      'content:erase',
      'customers:read',
      'accounts:read',
      'cdr:read_pii',
      'cdr:export_bulk',
    ],
  },
  {
    name: 'auditor',
    description: 'Revue de conformité et de sécurité : lecture du journal d’audit, et rien d’autre',
    permissions: ['audit:read'],
  },
]

/**
 * Les permissions initiales d'un rôle par défaut, ou un tableau vide pour un nom inconnu.
 *
 * Rendre « rien » plutôt que de lancer est délibéré : les rôles personnalisés (step-027) passent par
 * la base, pas par cette table, et un appel avec leur nom doit être sans effet — jamais tout.
 */
export function permissionsOfDefaultRole(name: string): readonly PermissionKey[] {
  return DEFAULT_ROLES.find((role) => role.name === name)?.permissions ?? []
}
