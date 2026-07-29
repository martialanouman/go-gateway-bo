/**
 * Le schéma que le BFF possède — et **rien d'autre**.
 *
 * Dix tables : opérateurs, catalogue de permissions, rôles et leurs deux tables de liaison,
 * journal d'audit, règles d'alerte, notifications, vues sauvegardées, et le compteur d'échecs
 * d'authentification (step-021).
 *
 * Ce qui n'est **pas** ici, et ne doit jamais y arriver : clients, groupes de clients, comptes
 * SMPP, identifiants de bind, connecteurs, sessions, CDR, traces, soldes, plans tarifaires. Toutes
 * ces données appartiennent à la passerelle et se lisent à travers l'API Admin **à chaque
 * affichage** (§3.2). Les recopier ici créerait une seconde vérité qui divergerait en silence, et
 * un cockpit qui montre un état périmé est pire qu'un cockpit en panne : il inspire confiance.
 *
 * Le seul cache admis est celui de TanStack Query, côté requête, avec sa durée de vie explicite —
 * jamais une table.
 */

export * from './alerting'
export * from './audit'
export * from './auth'
export * from './throttle'
export * from './views'
