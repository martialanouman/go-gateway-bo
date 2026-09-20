import type { FileRouteTypes } from '~/routeTree.gen'
import type { PermissionKey } from './permissions.gen'

/**
 * Les écrans de la coquille, **dérivés de l'arbre** plutôt qu'énumérés : un écran appartient au rail
 * s'il est enfant de `_shell`, et rien ne le dit mieux que son identifiant.
 *
 * L'ancienne rédaction retranchait `/` et `/_design` de tous les chemins. Elle demandait qu'on pense
 * à retrancher chaque route posée hors de la coquille — `/login` et `/mfa` l'ont montré en
 * s'invitant dans la table —, et l'oubli ne rougissait pas : il **ajoutait** une entrée au rail.
 */
type ShellScreen<Id> = Id extends `/_shell/${infer Path}` ? `/${Path}` : never

export type NavPath = Exclude<ShellScreen<FileRouteTypes['id']>, '/'>

export type Milestone = 'M3' | 'M4' | 'M5' | 'M6' | 'M7' | 'M8' | 'M9'

// Les intitulés de `tasks/plan.md`, §8 à §14.
export const MILESTONES: Record<Milestone, string> = {
  M3: 'Clients, comptes SMPP et identifiants',
  M4: 'Exploitation temps réel',
  M5: 'CDR Explorer et trace',
  M6: 'Routage et scripts',
  M7: 'Conformité',
  M8: 'Facturation, contenu et RGPD',
  M9: 'Alerting, audit et mise en production',
}

export type NavEntry = {
  readonly to: NavPath
  readonly label: string
  readonly milestone: Milestone
  /** Une seule suffit ; vide, l'entrée s'ouvre à toute session. */
  readonly anyOf: readonly PermissionKey[]
}

export type NavGroup = { readonly label: string; readonly entries: readonly NavEntry[] }

/**
 * Le rail de la charte — cinq groupes, quinze entrées — et la seule liste : les routes, le rail et
 * leurs tests la lisent.
 *
 * Trafic et CDR Explorer n'exigent rien parce que le catalogue n'a aucune clé pour les lire
 * (`cdr:read_pii` ne gouverne que les numéros en clair). Contenu & RGPD s'ouvre sur l'une de trois
 * clés : le rôle `compliance` efface sans jamais lire (§6.10).
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Exploitation',
    entries: [
      { to: '/traffic', label: 'Trafic', milestone: 'M4', anyOf: [] },
      { to: '/cdr', label: 'CDR Explorer', milestone: 'M5', anyOf: [] },
      { to: '/sessions', label: 'Sessions', milestone: 'M4', anyOf: ['sessions:read'] },
      { to: '/connectors', label: 'Connecteurs', milestone: 'M4', anyOf: ['connectors:read'] },
    ],
  },
  {
    label: 'Clients',
    entries: [
      { to: '/customers', label: 'Clients', milestone: 'M3', anyOf: ['customers:read'] },
      { to: '/accounts', label: 'Comptes SMPP', milestone: 'M3', anyOf: ['accounts:read'] },
      { to: '/groups', label: 'Groupes', milestone: 'M3', anyOf: ['groups:read'] },
    ],
  },
  {
    label: 'Routage',
    entries: [
      { to: '/routes', label: 'Routes', milestone: 'M6', anyOf: ['routes:read'] },
      { to: '/exact-routes', label: 'Numéros exacts', milestone: 'M6', anyOf: ['routes:read'] },
      { to: '/scripts', label: 'Scripts', milestone: 'M6', anyOf: ['scripts:read'] },
    ],
  },
  {
    label: 'Conformité',
    entries: [
      {
        to: '/suppressions',
        label: 'Désabonnements',
        milestone: 'M7',
        anyOf: ['suppressions:read'],
      },
      {
        to: '/content',
        label: 'Contenu & RGPD',
        milestone: 'M8',
        anyOf: ['content:read', 'content:erase', 'gdpr:erase'],
      },
      { to: '/audit', label: 'Journal d’audit', milestone: 'M9', anyOf: ['audit:read'] },
    ],
  },
  {
    label: 'Facturation',
    entries: [
      { to: '/billing', label: 'Soldes & crédits', milestone: 'M8', anyOf: ['billing:read'] },
      { to: '/rate-plans', label: 'Plans tarifaires', milestone: 'M8', anyOf: ['billing:read'] },
    ],
  },
]

export const NAV_ENTRIES = NAV_GROUPS.flatMap((group) => group.entries)

export function navEntry(to: NavPath) {
  const entry = NAV_ENTRIES.find((candidate) => candidate.to === to)
  if (entry === undefined) throw new Error(`aucune entrée de navigation pour ${to}`)
  return entry
}
