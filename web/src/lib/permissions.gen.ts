/**
 * Ce fichier est engendré à partir du catalogue de internal/permissions, qui fait foi. Le modifier
 * à la main n'a aucun effet durable : la génération suivante l'écrase.
 *
 * Le régénérer :   make generate
 * Ou directement : go run ./cmd/permissionsgen web/src/lib/permissions.gen.ts
 */

export type PermissionKey =
  | 'routes:read'
  | 'routes:write'
  | 'routes:import'
  | 'scripts:read'
  | 'scripts:write'
  | 'scripts:publish'
  | 'senderrewrite:read'
  | 'senderrewrite:write'
  | 'connectors:read'
  | 'connectors:write'
  | 'connectors:rebind'
  | 'sessions:read'
  | 'sessions:disconnect'
  | 'antispam:read'
  | 'antispam:write'
  | 'customers:read'
  | 'customers:write'
  | 'accounts:read'
  | 'accounts:write'
  | 'credentials:read'
  | 'credentials:write'
  | 'credentials:rotate'
  | 'groups:read'
  | 'groups:write'
  | 'billing:read'
  | 'billing:write'
  | 'billing:topup'
  | 'billing:provider:write'
  | 'billing:scope_change'
  | 'content:read'
  | 'content:erase'
  | 'cdr:read_pii'
  | 'cdr:export_bulk'
  | 'suppressions:read'
  | 'suppressions:write'
  | 'suppressions:delete'
  | 'inbound:read'
  | 'inbound:write'
  | 'gdpr:erase'
  | 'alerts:read'
  | 'alerts:write'
  | 'audit:read'
  | 'operators:manage'
  | 'roles:manage'

export type PermissionCategory =
  | 'routing'
  | 'connectors'
  | 'sessions'
  | 'antispam'
  | 'accounts'
  | 'billing'
  | 'content'
  | 'compliance'
  | 'alerts'
  | 'audit'
  | 'admin'

export interface Permission {
  readonly key: PermissionKey
  readonly category: PermissionCategory
  readonly description: string
}

export const PERMISSIONS: readonly Permission[] = [
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
  {
    key: 'audit:read',
    category: 'audit',
    description: 'Consulter le journal d’audit : qui a fait quoi, quand, avec quel avant/après',
  },
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
]
