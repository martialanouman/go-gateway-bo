# step-020 — Schéma auth (operators, roles, permissions, jointures) + seeds

> **Jalon :** M1 (§3.1, §6.10) · **Statut :** À FAIRE
> **Dépend de :** step-002 · **Bloque :** step-021, step-025, step-027

## But
Poser le modèle d'autorisation : un catalogue de permissions figé, des rôles éditables qui en sont
des paquets, et un opérateur qui peut en détenir plusieurs.

## Périmètre (ce que fait CETTE PR)
- Modèle Drizzle finalisé : `operators`, `permissions`, `roles`, `role_permissions`, `operator_roles`.
- **Seed du catalogue de permissions** — les ~40 clés du §3.1, avec `category` et `description`
  en français : `routes:*`, `scripts:*`, `sessions:*`, `antispam:*`, `customers:*`, `accounts:*`,
  `credentials:*`, `senderrewrite:*`, `suppressions:*`, `inbound:*`, `groups:*`, `billing:*`,
  `content:read`, `content:erase`, `gdpr:erase`, `cdr:export_bulk`, `alerts:*`, `audit:read`,
  `operators:manage`, `roles:manage`.
- **Seed des neuf rôles par défaut** du §6.10 avec leurs paquets exacts : `super_admin`, `ops`,
  `script_author`, `support_readonly`, `billing_admin`, `billing_readonly`, `account_manager`,
  `compliance`, `auditor`.
- Fonction de résolution : opérateur → **union** des permissions de ses rôles.
- Commande de création du premier `super_admin` (bootstrap).

## Points d'implémentation clés
- Le catalogue est **fixe** : versionné avec les releases, jamais éditable par un admin (§3.1). Le
  seed est idempotent et fait autorité — il retire les clés disparues.
- Les rôles par défaut sont `is_default = true` et **non supprimables** ; ils restent éditables.
- Pièges du §6.10 à respecter au caractère près : `ops` a `suppressions:read/write` **sans**
  `:delete` ; `script_author` n'a **pas** `scripts:publish` ; `support_readonly` n'a **jamais**
  `content:read` ; `compliance` est le seul rôle par défaut avec `suppressions:delete` et
  `gdpr:erase`, et n'a **pas** `content:read` ; `account_manager` n'a pas `billing:topup`.
- Aucune notion de « niveau » ou de hiérarchie de rôle : uniquement des unions de permissions.

## Tests (écrits dans la même PR)
- Le seed est idempotent : deux exécutions donnent le même état.
- Table de vérité par rôle par défaut : chacune des neuf lignes du §6.10 est vérifiée, y compris les
  exclusions (`ops` sans `suppressions:delete`, `support_readonly` sans `content:read`).
- Un opérateur à deux rôles obtient l'union exacte de leurs permissions.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] les neuf rôles et le catalogue complet sont seedés et testés

## Hors périmètre
L'application des permissions → step-025. Les écrans → step-027.
