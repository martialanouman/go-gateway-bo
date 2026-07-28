# step-146 — Anti-spam : CRUD, test, file de revue, tendance de réputation

> **Jalon :** M7 (§6.6) · **Statut :** À FAIRE
> **Dépend de :** step-041, step-080 · **Bloque :** step-180

## But
Donner à l'exploitation le contrôle de l'anti-spam : les règles, ce qu'elles ont signalé, et la
réputation qui en découle.

## Périmètre (ce que fait CETTE PR)
- CRUD règles (`antispam:read` / `antispam:write`) : `list-antispam-rules`, `create-antispam-rule`,
  `update-antispam-rule`, `delete-antispam-rule` — l'écran reflète le schéma anti-spam.
- Aperçu **« tester contre un exemple »**.
- **File de revue** de l'activité signalée : approuver / bloquer / mettre en liste blanche.
- **Graphique de tendance de réputation par client**, avec seuils alimentant `alert_rules` (step-180).

## Points d'implémentation clés
- Le test contre un exemple utilise un contenu **saisi par l'opérateur**, jamais un message réel, et
  n'est pas journalisé (invariant a).
- La file de revue est une file de décisions : chaque action doit être auditée et réversible tant que
  possible ; l'UI dit ce qui ne l'est pas.
- La tendance de réputation se lit dans le temps : sans historique visible, un seuil ne veut rien dire.
- Le lien vers la création d'une règle d'alerte sur `account.reputation` prépare la step-180.

## Tests (écrits dans la même PR)
- CRUD sous permission ; test contre exemple renvoyant le verdict attendu.
- Les trois actions de la file de revue s'appliquent et sont auditées.
- Aucun contenu de test journalisé (invariant a).

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] file de revue auditée · tendance historisée

## Hors périmètre
Les règles d'alerte → step-180.
