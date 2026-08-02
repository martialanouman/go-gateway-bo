// Package store porte le petit schéma PostgreSQL dont le tableau de bord est propriétaire —
// opérateurs, rôles, permissions, journal d'audit, règles d'alerte, notifications, vues
// sauvegardées (§3.1) — et le code qui l'applique.
//
// Il ne connaît **rien** de la passerelle : clients, comptes SMPP, connecteurs, CDR et soldes se
// lisent à travers l'API Admin à chaque requête et ne sont jamais recopiés ici (§3.2).
//
// Il vit sous `internal/` pour la même raison que `internal/gateway` : le DSN porte un mot de passe,
// et un package `internal/` n'est importable que depuis ce module.
package store
