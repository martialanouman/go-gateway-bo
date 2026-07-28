# step-027 — Gestion des opérateurs et des rôles (CRUD)

> **Jalon :** M1 (§6.10, §5.1) · **Statut :** À FAIRE
> **Dépend de :** step-026 · **Bloque :** —

## But
Permettre à un `super_admin` d'administrer qui accède au tableau de bord et avec quels droits, sans
toucher au code.

## Périmètre (ce que fait CETTE PR)
- Écran **Opérateurs** (`operators:manage`) : liste, création, désactivation, affectation de
  **plusieurs rôles**, réinitialisation de facteur MFA, dernière connexion.
- Écran **Rôles** (`roles:manage`) : liste, création, édition d'un paquet de permissions par
  catégorie, duplication d'un rôle par défaut.
- Catalogue de permissions en lecture seule, groupé par `category`, avec description en français.
- Aperçu d'impact avant sauvegarde : « ce changement retire *N* permissions à *M* opérateurs ».

## Points d'implémentation clés
- Les rôles par défaut sont **non supprimables** ; l'UI le dit au lieu de désactiver un bouton sans
  explication.
- Garde-fou : ne pas se retirer à soi-même `operators:manage` / `roles:manage`, et refuser de
  supprimer le dernier détenteur de `super_admin`.
- Désactiver un opérateur **révoque ses sessions** immédiatement (step-022).
- Toutes ces actions sont auditées (step-025) — vérifier les `before_json`/`after_json`.

## Tests (écrits dans la même PR)
- CRUD complet opérateurs et rôles, sous permission ; refusé sans.
- Impossible de supprimer un rôle par défaut ou le dernier `super_admin`.
- Désactiver un opérateur connecté met fin à sa session.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] garde-fous d'auto-verrouillage testés · actions auditées

## Hors périmètre
L'écran de consultation du journal d'audit → step-184.
