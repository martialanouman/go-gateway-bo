/**
 * Le catalogue de permissions — le vocabulaire de l'autorisation.
 *
 * **Figé et versionné avec les livraisons** (§3.1) : jamais éditable depuis l'interface. Un
 * administrateur compose des rôles à partir de ces clés, il n'en invente pas.
 *
 * Ce module vit dans `src/lib/` et non sous `src/server/` parce qu'il ne porte aucun secret et que
 * les deux moitiés en ont besoin : le BFF pour ses gardes (`requirePermission`, step-025), le client
 * pour son rendu conditionnel à partir de l'ensemble rendu par `/auth/me` (step-026) et pour l'écran
 * d'édition de rôle, qui affiche ces descriptions telles quelles (step-027).
 *
 * ## Ajouter une clé, c'est trois endroits dans la même PR
 *
 * Le catalogue **ici**, la garde serveur qui l'exige, et le tableau des rôles par défaut
 * (`src/server/auth/default-roles.ts`). Une clé sans garde est une permission qui ne garde rien ;
 * une garde sans clé au catalogue refuse tout le monde ; une clé qu'aucun rôle ne détient est
 * inaccessible à tous sauf `super_admin`. Les trois erreurs sont silencieuses, et le seul filet est
 * l'ensemble de tests qui accompagne ces deux fichiers.
 *
 * ## Écart assumé avec le §3.1 d'origine
 *
 * Le §3.1 énumérait 40 clés. Quatre ont été ajoutées par la step-020, et la spec amendée dans la
 * même PR :
 *
 * - `connectors:read` / `connectors:write` / `connectors:rebind` — la catégorie `connectors`
 *   existait dans l'enum PostgreSQL depuis la step-002 sans qu'aucune clé ne s'y rattache, alors que
 *   le §6.10 donne « lecture/écriture connecteurs » à `ops` et décrit `account_manager` par
 *   l'exclusion « pas de routage/connecteur ». On n'exclut pas ce qui n'est gardé par rien.
 * - `cdr:read_pii` — le §6.4 exige un « masquage MSISDN **par rôle** » sur l'export, tandis que le
 *   §4.2 interdit « un contrôle de rôle codé en dur ». La seule façon de tenir les deux est une clé
 *   de catalogue. Elle s'applique **uniformément** à la recherche CDR, au visualiseur de trace et à
 *   l'export : masquer à l'export seul ne protégerait rien, puisque les mêmes numéros se lisent à
 *   l'écran.
 */

/**
 * Les familles d'un catalogue, dans l'ordre où l'écran d'édition de rôle les présente. Miroir exact
 * de l'enum `permission_category` posé en base (`src/server/db/schema/auth.ts`) : une valeur ajoutée
 * ici sans migration ferait échouer le seed à l'insertion.
 */
export const PERMISSION_CATEGORIES = [
  'routing',
  'connectors',
  'sessions',
  'antispam',
  'accounts',
  'billing',
  'content',
  'compliance',
  'alerts',
  'audit',
  'admin',
] as const

export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number]

export type PermissionEntry = {
  readonly key: string
  readonly category: PermissionCategory
  readonly description: string
}

/**
 * Les 44 clés. L'ordre suit celui des catégories ci-dessus, pour que la lecture du fichier et celle
 * de l'écran coïncident.
 *
 * Motif à respecter en ajoutant une clé : **le verbe dangereux a la sienne**. `sessions:disconnect`
 * n'est pas dans `sessions:write`, `credentials:rotate` n'est pas dans `credentials:write`,
 * `scripts:publish` n'est pas dans `scripts:write`. C'est ce qui permet à un rôle de corriger une
 * configuration sans pouvoir déclencher l'acte visible en production.
 */
export const PERMISSION_CATALOG = [
  // ─── routing ────────────────────────────────────────────────────────────────────────────────
  {
    key: 'routes:read',
    category: 'routing',
    description: 'Consulter les routes, leur ordre de priorité et la route de repli',
  },
  {
    key: 'routes:write',
    category: 'routing',
    description: 'Créer, modifier, réordonner et supprimer des routes',
  },
  {
    key: 'routes:import',
    category: 'routing',
    description: 'Importer en masse des routes par numéro exact (portabilité MNP)',
  },
  {
    key: 'scripts:read',
    category: 'routing',
    description: 'Lire le code source des scripts de routage et leurs versions',
  },
  {
    key: 'scripts:write',
    category: 'routing',
    description:
      'Modifier un script de routage et enregistrer une nouvelle version, sans la publier',
  },
  {
    key: 'scripts:publish',
    category: 'routing',
    description:
      'Mettre une version de script en production ou revenir à la précédente — effet immédiat sur le routage',
  },
  {
    key: 'senderrewrite:read',
    category: 'routing',
    description: 'Consulter les règles de réécriture de sender ID',
  },
  {
    key: 'senderrewrite:write',
    category: 'routing',
    description: 'Créer et modifier les règles de réécriture de sender ID',
  },

  // ─── connectors ─────────────────────────────────────────────────────────────────────────────
  {
    key: 'connectors:read',
    category: 'connectors',
    description: 'Consulter les connecteurs, leur pool de binds, link_status et breaker_state',
  },
  {
    key: 'connectors:write',
    category: 'connectors',
    description:
      'Créer, modifier et supprimer un connecteur et la configuration de son pool de binds',
  },
  {
    key: 'connectors:rebind',
    category: 'connectors',
    description:
      'Forcer la reconnexion d’un bind — interrompt le trafic qu’il porte le temps du rétablissement',
  },

  // ─── sessions ───────────────────────────────────────────────────────────────────────────────
  {
    key: 'sessions:read',
    category: 'sessions',
    description: 'Consulter les sessions SMPP actives et leurs binds',
  },
  {
    key: 'sessions:disconnect',
    category: 'sessions',
    description: 'Déconnecter de force une session SMPP — le client perd sa connexion sans préavis',
  },

  // ─── antispam ───────────────────────────────────────────────────────────────────────────────
  {
    key: 'antispam:read',
    category: 'antispam',
    description: 'Consulter les règles anti-spam, la file de revue et la réputation des comptes',
  },
  {
    key: 'antispam:write',
    category: 'antispam',
    description: 'Créer et modifier les règles anti-spam et traiter la file de revue',
  },

  // ─── accounts ───────────────────────────────────────────────────────────────────────────────
  {
    key: 'customers:read',
    category: 'accounts',
    description: 'Consulter la liste des clients et leur fiche',
  },
  {
    key: 'customers:write',
    category: 'accounts',
    description: 'Créer et modifier un client, le suspendre ou le réactiver en cascade',
  },
  {
    key: 'accounts:read',
    category: 'accounts',
    description: 'Consulter les comptes SMPP, leurs canaux, quotas et max_sessions',
  },
  {
    key: 'accounts:write',
    category: 'accounts',
    description:
      'Créer et modifier un compte SMPP, ses quotas, ses limites de débit et ses webhooks',
  },
  {
    key: 'credentials:read',
    category: 'accounts',
    description:
      'Voir la liste des identifiants d’un compte et leur état — jamais le secret, qui n’est plus réaffichable',
  },
  {
    key: 'credentials:write',
    category: 'accounts',
    description:
      'Créer et révoquer un identifiant de bind — le secret n’est montré qu’à la création',
  },
  {
    key: 'credentials:rotate',
    category: 'accounts',
    description:
      'Faire tourner un identifiant avec période de grâce — l’ancien secret cesse d’être accepté à son terme',
  },
  {
    key: 'groups:read',
    category: 'accounts',
    description: 'Consulter les groupes de clients et leur composition',
  },
  {
    key: 'groups:write',
    category: 'accounts',
    description: 'Créer et modifier les groupes de clients et leurs membres',
  },

  // ─── billing ────────────────────────────────────────────────────────────────────────────────
  {
    key: 'billing:read',
    category: 'billing',
    description: 'Consulter les soldes, le grand livre et les plans tarifaires',
  },
  {
    key: 'billing:write',
    category: 'billing',
    description: 'Modifier les plans tarifaires et les paramètres de facturation d’un client',
  },
  {
    key: 'billing:topup',
    category: 'billing',
    description:
      'Recharger un solde ou transférer du crédit entre comptes — mouvement d’argent réel',
  },
  {
    key: 'billing:provider:write',
    category: 'billing',
    description: 'Configurer les fournisseurs de facturation et tester leur connexion',
  },
  {
    key: 'billing:scope_change',
    category: 'billing',
    description:
      'Changer le balance_scope d’un client — modifie la façon dont ses comptes consomment leur solde',
  },

  // ─── content ────────────────────────────────────────────────────────────────────────────────
  {
    key: 'content:read',
    category: 'content',
    description:
      'Afficher le corps d’un message — chaque lecture est journalisée nominativement et reste consultable',
  },
  {
    key: 'content:erase',
    category: 'content',
    description:
      'Détruire la clé de chiffrement d’un contenu — corps illisible, métadonnées conservées, irréversible',
  },
  {
    key: 'cdr:read_pii',
    category: 'content',
    description:
      'Voir les MSISDN en clair dans la recherche, la trace et les exports — sinon ils restent masqués',
  },
  {
    key: 'cdr:export_bulk',
    category: 'content',
    description: 'Lancer un export CSV de masse de CDR, dans la limite du plafond de lignes',
  },

  // ─── compliance ─────────────────────────────────────────────────────────────────────────────
  {
    key: 'suppressions:read',
    category: 'compliance',
    description: 'Consulter les listes de désabonnement par canal et l’origine de chaque entrée',
  },
  {
    key: 'suppressions:write',
    category: 'compliance',
    description: 'Ajouter des entrées de désabonnement, à l’unité ou par import en masse',
  },
  {
    key: 'suppressions:delete',
    category: 'compliance',
    description:
      'Lever un désabonnement — le destinataire redevient joignable, l’action est journalisée nominativement',
  },
  {
    key: 'inbound:read',
    category: 'compliance',
    description: 'Consulter les numéros entrants, leurs affectations et leurs mots-clés',
  },
  {
    key: 'inbound:write',
    category: 'compliance',
    description: 'Créer et affecter des numéros entrants et leurs mots-clés',
  },
  {
    key: 'gdpr:erase',
    category: 'compliance',
    description:
      'Lancer un effacement RGPD sur un client ou un MSISDN — irréversible, avec attestation à l’achèvement',
  },

  // ─── alerts ─────────────────────────────────────────────────────────────────────────────────
  {
    key: 'alerts:read',
    category: 'alerts',
    description: 'Consulter les règles d’alerte métier et les notifications déclenchées',
  },
  {
    key: 'alerts:write',
    category: 'alerts',
    description: 'Créer et modifier les règles d’alerte métier et leurs canaux de notification',
  },

  // ─── audit ──────────────────────────────────────────────────────────────────────────────────
  {
    key: 'audit:read',
    category: 'audit',
    description: 'Consulter le journal d’audit : qui a fait quoi, quand, avec quel avant/après',
  },

  // ─── admin ──────────────────────────────────────────────────────────────────────────────────
  {
    key: 'operators:manage',
    category: 'admin',
    description: 'Créer, désactiver des opérateurs et leur attribuer des rôles',
  },
  {
    key: 'roles:manage',
    category: 'admin',
    description: 'Créer et modifier des rôles, c’est-à-dire redistribuer toutes les permissions',
  },
] as const satisfies readonly PermissionEntry[]

/**
 * L'union exacte des 44 clés. C'est ce qui fait qu'une garde mal orthographiée —
 * `requirePermission('routes:raed')` — ne compile pas, au lieu de refuser tout le monde en silence.
 */
export type PermissionKey = (typeof PERMISSION_CATALOG)[number]['key']

const BY_KEY = new Map<string, (typeof PERMISSION_CATALOG)[number]>(
  PERMISSION_CATALOG.map((entry) => [entry.key, entry]),
)

/** Rend l'entrée du catalogue, ou `undefined` pour une clé qui n'y est pas. */
export function permissionByKey(
  key: PermissionKey,
): (typeof PERMISSION_CATALOG)[number] | undefined {
  return BY_KEY.get(key)
}

/** Toutes les clés, pour le seed et les tests. */
export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_CATALOG.map(
  (entry) => entry.key,
)
