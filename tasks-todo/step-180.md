# step-180 — `alert_rules` : CRUD + UI de configuration

> **Jalon :** M9 (§6.8, §3.1) · **Statut :** À FAIRE
> **Dépend de :** step-046, step-146 · **Bloque :** step-181, step-182, step-183

## But
Donner l'écran de configuration des alertes, en rendant visible **qui évaluera** chaque règle — c'est
ce qui détermine si elle survit à une panne du tableau de bord.

## Périmètre (ce que fait CETTE PR)
- CRUD `alert_rules` (`alerts:read` / `alerts:write`) sur la table du §3.1 : `metric`, `scope`
  (`global` | `connector` | `account`), `scope_id`, `condition_json`, `notify_channels_json`
  (email | webhook | slack), `status`.
- Champ **`evaluation_owner`** déterminé par la métrique et **affiché** :
  - `connector.error_rate`, `connector.status`, débit → **`alertmanager`** ;
  - `account.reputation`, `billing.mt_balance_low`, `billing.mo_floor_reached` → **`bff`**.
- Explication en ligne de la conséquence : une règle `alertmanager` continue de paginer même si le
  tableau de bord est hors service ; une règle `bff` dépend de l'évaluateur (step-182).
- ⚠️ **Dégradation assumée** : le write-through vers Alertmanager n'est pas implémentable
  (aucune surface au contrat) — l'écran indique que la règle infra doit être déclarée côté
  Alertmanager, voir step-183.

## Points d'implémentation clés
- `evaluation_owner` n'est pas un détail technique : c'est la différence entre une alerte qui survit
  et une qui disparaît avec le tableau de bord (§1.2, invariant e). L'afficher, toujours.
- Ne pas laisser l'opérateur choisir librement le propriétaire d'évaluation : il découle de la
  métrique. Le champ est **dérivé et expliqué**, pas éditable.
- Les seuils de réputation viennent de step-146 : proposer la création depuis le graphique de tendance.
- Aucune règle ne doit pouvoir être créée « active » sans canal de notification configuré.

## Tests (écrits dans la même PR)
- Chaque métrique dérive le bon `evaluation_owner` et l'affiche.
- Une règle sans canal de notification ne peut pas être activée.
- CRUD sous permission ; actions auditées.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] `evaluation_owner` dérivé, affiché, expliqué · limitation du write-through documentée

## Hors périmètre
La réception des alertes → step-181. L'évaluation métier → step-182.
