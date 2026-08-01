/**
 * Le rail de navigation — **la carte du produit**, et une donnée, pas du JSX.
 *
 * Six familles, dans l'ordre où un opérateur les parcourt : ce qui tourne maintenant, puis qui
 * l'utilise, puis comment c'est acheminé, puis les obligations, puis l'argent, puis
 * l'administration. Cet ordre est celui de la charte, et il n'est pas alphabétique.
 *
 * Chaque entrée porte la permission qui la rend utile. Une famille dont **aucune** entrée n'est
 * accessible disparaît entièrement : garder un intitulé de groupe vide encombrerait le rail sans
 * rien apprendre — c'est la seule exception à « désactivé et expliqué », et elle est écrite ici
 * plutôt que décidée dans un composant.
 *
 * « Le rail de navigation n'a pas d'icônes » (charte §07) : les libellés portent le sens.
 */

import type { PermissionKey } from '~/lib/permissions'

export type NavEntry = {
  readonly to: string
  readonly label: string
  /**
   * La permission qui rend l'écran utile. L'entrée est masquée sans elle — voir l'en-tête.
   *
   * **Cette clé peint le rail ; elle ne garde rien.** La garde d'un écran est celle de la fonction
   * serveur qu'il appelle (`requirePermission`, step-025), et la garde de session viendra sur la
   * route de mise en page en step-026. Lire cette liste comme une matrice d'autorisation serait la
   * plus naturelle des erreurs, et la plus coûteuse.
   */
  readonly permission: PermissionKey
}

export type NavGroup = {
  readonly label: string
  readonly entries: readonly NavEntry[]
}

export const NAVIGATION: readonly NavGroup[] = [
  {
    label: 'Exploitation',
    entries: [
      // `connectors:read` et **non** `cdr:read_pii` : le catalogue décrit cette dernière comme
      // « voir les MSISDN **en clair** … sinon ils restent masqués ». C'est une clé de démasquage,
      // pas de lecture — son absence doit masquer des colonnes, pas faire disparaître l'écran phare
      // de l'exploitation. Un `billing_admin`, décrit comme « consultation seule sur le reste de la
      // plateforme », voyait Connecteurs, Sessions et Alertes mais pas Trafic.
      //
      // Une clé `metrics:read` dédiée serait plus juste ; l'ajouter demande trois endroits dans une
      // même PR (catalogue, garde serveur, rôles par défaut) et relève d'un amendement du §3.1, pas
      // d'une décision de cette step.
      { to: '/trafic', label: 'Trafic', permission: 'connectors:read' },
      { to: '/connecteurs', label: 'Connecteurs', permission: 'connectors:read' },
      { to: '/sessions', label: 'Sessions', permission: 'sessions:read' },
      { to: '/alertes', label: 'Alertes', permission: 'alerts:read' },
    ],
  },
  {
    label: 'Clients',
    entries: [
      { to: '/clients', label: 'Clients', permission: 'customers:read' },
      { to: '/groupes', label: 'Groupes', permission: 'groups:read' },
      { to: '/comptes', label: 'Comptes SMPP', permission: 'accounts:read' },
    ],
  },
  {
    label: 'Routage',
    entries: [
      { to: '/routes', label: 'Routes', permission: 'routes:read' },
      { to: '/scripts', label: 'Scripts', permission: 'scripts:read' },
      { to: '/reecriture', label: 'Réécriture de sender ID', permission: 'senderrewrite:read' },
      { to: '/antispam', label: 'Anti-spam', permission: 'antispam:read' },
    ],
  },
  {
    label: 'Conformité',
    entries: [
      { to: '/desabonnements', label: 'Désabonnements', permission: 'suppressions:read' },
      { to: '/entrants', label: 'Numéros entrants', permission: 'inbound:read' },
      { to: '/audit', label: 'Journal d’audit', permission: 'audit:read' },
    ],
  },
  {
    label: 'Facturation',
    entries: [{ to: '/facturation', label: 'Facturation', permission: 'billing:read' }],
  },
  {
    label: 'Administration',
    entries: [
      // Seul `super_admin` détient ces deux clés parmi les rôles par défaut : le groupe entier est
      // donc invisible pour les huit autres. C'est conforme au §6.10 — « qui peut éditer les rôles
      // peut s'accorder tout le reste » — et c'est le seul groupe dans ce cas.
      { to: '/operateurs', label: 'Opérateurs', permission: 'operators:manage' },
      { to: '/roles', label: 'Rôles', permission: 'roles:manage' },
    ],
  },
]

/** Toutes les entrées à plat — pour l'arborescence de routes et pour les tests. */
export const NAV_ENTRIES: readonly NavEntry[] = NAVIGATION.flatMap((group) => group.entries)
