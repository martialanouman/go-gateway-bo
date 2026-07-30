# step-025 — Moteur de permissions côté serveur + journal d'audit + MFA obligatoire

> **Jalon :** M1 (§6.10, §3.1, §6.9) · **Statut :** À FAIRE
> **Dépend de :** step-020, step-022, step-023, step-024 · **Bloque :** toute step qui écrit

## But
Faire de l'autorisation et de l'audit une propriété du serveur, pas une convention : aucune fonction
serveur protégée ne s'exécute sans permission vérifiée ni trace écrite.

## Périmètre (ce que fait CETTE PR)
- `requirePermission(key)` : garde composable pour toute fonction serveur / route BFF, refus en
  erreur typée `{ code, message, errors[] }`.
- Écriture systématique dans `audit_log` pour toute mutation : `operator_id`, `action`,
  `target_type`, `target_id`, `before_json`, `after_json`, `ip_address`.
- **MFA obligatoire pour les rôles privilégiés** : une session sans MFA passée ne peut atteindre
  aucune permission d'écriture ni `content:read` / `gdpr:erase`.
- Test transversal qui **énumère toutes les routes du BFF** et échoue si l'une d'elles mute sans
  garde de permission ni écriture d'audit.

## Points d'implémentation clés
- **Invariant (c)** : c'est ici que l'autorisation vit. Le rendu UI (step-026) ne la remplace jamais.
- Le jeton machine vers l'API Admin porte `content:read` en permanence : sans cette garde, **tout**
  opérateur pourrait lire un corps. C'est la raison d'être de la step.
- `before_json`/`after_json` ne contiennent **jamais** un corps de message ni un secret : filtrer
  explicitement (invariants a et b).
- L'écriture d'audit est dans la même transaction que la mutation quand c'est possible ; sinon, échec
  d'audit = échec de l'opération, jamais un succès silencieux.

## Tests (écrits dans la même PR)
- Sans la permission, l'appel échoue et ne mute rien ; avec, il mute et écrit exactement une ligne d'audit.
- Le test d'énumération des routes détecte une route de mutation non gardée (cas fabriqué).
- Une session non-MFA est refusée sur une permission d'écriture.
- Un secret ou un corps placé dans un payload muté n'apparaît pas dans `audit_log`.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] test d'énumération des routes en place et bloquant · invariants (a)(b)(c) tenus

## Hors périmètre
L'écran de consultation de l'audit → step-184.
