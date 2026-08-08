# step-020 — Seed de l'autorisation : les 44 clés, les 9 rôles, idempotent

> **Jalon :** M1 (§3.1, §6.10) · **Statut :** À FAIRE
> **Dépend de :** step-005, step-006 · **Bloque :** step-021 → step-029, et toute garde de M2

## But
Remplir le vocabulaire que step-006 a défini et que step-005 a laissé vide : les 44 permissions et
les neuf rôles par défaut existent en base, rejouables sans effet, et le binaire refuse de servir sur
un schéma en retard. C'est la **première step qui écrit une requête** — donc celle qui tranche `sqlc`
contre `pgx` nu (`plan.md` §19, renvoyée ici par l'amendement du 02/08/2026).

## Périmètre (ce que fait CETTE PR)
- Le seed des **44 permissions**, projeté depuis `internal/permissions` : la table est une image du
  catalogue Go, jamais une seconde source.
- Les **neuf rôles par défaut** du §6.10 (`is_default = true`) et leurs `role_permissions`.
- Idempotence réelle : rejouer ne change rien, et une divergence se dit au lieu d'être avalée.
- `make bootstrap`, **première moitié** : sème. La création du premier opérateur est en step-021 — le
  README annonce déjà la cible entière, et sa description se confronte au livré.
- **Vérification de version du schéma au démarrage** : dette écrite par step-005 (DN-6), qui attendait
  la première step à lire la base.
- Le choix d'accès aux données (`sqlc` ou `pgx` nu) **écrit avec sa raison**, et `plan.md` §19 mis à
  jour dans la même PR.

## Points d'implémentation clés
- **Le §6.10 est de la prose, et c'est la donnée de cette step.** Neuf listes écrites à la main, dont
  ce sont les **exclusions** qui portent le sens : `ops` sans `suppressions:delete`, `script_author`
  sans `scripts:publish`, `support_readonly` sans `content:read`, `account_manager` sans
  `billing:topup`, `auditor` sans `cdr:read_pii`. Une exclusion oubliée n'a aucun symptôme visible :
  elle accorde, en silence, exactement ce que le rôle existe pour interdire.
- **Trois clés n'appartiennent à aucun rôle sauf `super_admin`, délibérément** : `content:read`,
  `operators:manage`, `roles:manage`. Toute **autre** clé orpheline est un oubli, et le §6.10 exige
  qu'un test bloquant le signale.
- **Le seed vit dans le Go, pas dans une migration SQL.** Une migration figerait une copie des 44 clés
  que rien ne relie au catalogue, et « l'ordre des migrations est un contrat, elles ne se réécrivent
  jamais » (step-005) — or le catalogue, lui, bouge à chaque release. La contrainte `RESTRICT` de
  `role_permissions.permission_key` est déjà en place pour faire échouer bruyamment le retrait d'une
  clé encore accordée.
- **Idempotent ne veut pas dire `ON CONFLICT DO NOTHING`.** Une description modifiée doit être mise à
  jour, une clé disparue du catalogue doit être **signalée** — sinon la base garde indéfiniment un
  vocabulaire que plus personne ne lit, et le premier symptôme sera un écran de rôle qui affiche une
  permission que le serveur ignore.
- **La table de vérité se lit depuis le §6.10, jamais depuis le seed.** Une porte dont les cas
  viennent de la donnée qu'elle garde ne voit pas sa dérive : la fixture du test est écrite à la main
  d'après la spec, et la mutation qui compte **retire** une clé plutôt que d'en altérer une.
- La vérification de version compare la dernière migration appliquée à celle qu'embarque le binaire et
  **refuse de servir** en nommant les deux. Démarrer quand même produirait des échecs de forme inconnue
  à l'exécution, sur des colonnes absentes.

## Tests (écrits dans la même PR)
- **Scénario** `seed.feature` : *Étant donné* une base migrée, *Quand* le seed est joué, *Alors* les 44
  clés et les 9 rôles existent ; *Quand* il est rejoué, *Alors* rien ne change et rien n'échoue.
- **Table de vérité des neuf rôles**, exclusions comprises, sur une fixture écrite d'après le §6.10.
- Aucune clé orpheline hors des trois délibérées ; et l'inverse — aucune ligne en base qui ne soit au
  catalogue.
- Un binaire dont le schéma est en retard refuse de démarrer et nomme la version attendue et la
  version trouvée.

## Definition of Done
- [ ] `make check` vert
- [ ] `make bootstrap` existe et sème ; deux exécutions successives laissent la base **identique** —
      comparée, pas supposée
- [ ] le choix `sqlc` / `pgx` nu est écrit avec sa raison, et `plan.md` §19 ne le donne plus pour ouvert
- [ ] la mutation « retirer `suppressions:delete` de `compliance` » et celle « accorder
      `billing:topup` à `account_manager` » font rougir la table de vérité
- [ ] la mutation « retirer la vérification de version du schéma » fait rougir le scénario de démarrage

## Hors périmètre
La création du premier opérateur et `argon2id` → step-021. `RequirePermission` → step-025. L'édition
des rôles depuis l'interface → step-029. La purge des sessions et le détachement des partitions →
step-187. L'appel récurrent à `ensure_audit_log_partitions()` → step-025, première step dont une
écriture dépend (step-005, DN-11).
