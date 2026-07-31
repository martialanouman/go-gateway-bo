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
  /** La permission qui rend l'écran utile. L'entrée est masquée sans elle — voir l'en-tête. */
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
      { to: '/trafic', label: 'Trafic', permission: 'cdr:read_pii' },
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
      { to: '/operateurs', label: 'Opérateurs', permission: 'operators:manage' },
      { to: '/roles', label: 'Rôles', permission: 'roles:manage' },
    ],
  },
]

/** Toutes les entrées à plat — pour l'arborescence de routes et pour les tests. */
export const NAV_ENTRIES: readonly NavEntry[] = NAVIGATION.flatMap((group) => group.entries)
