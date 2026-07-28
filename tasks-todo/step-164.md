# step-164 — Politique de contenu : plateforme et par client

> **Jalon :** M8 (§6.18) · **Statut :** À FAIRE
> **Dépend de :** step-062, step-025 · **Bloque :** step-165, step-166

## But
Décider si les corps de messages sont stockés, comment, et combien de temps — en énonçant chaque
option par sa conséquence, pas par son nom.

## Périmètre (ce que fait CETTE PR)
- **Politique plateforme** (`get-platform-content-policy`, `update-platform-content-policy`).
- **Politique par client** (`get-customer-content-policy`, `update-customer-content-policy`) :
  `off` / `stored_plaintext` / `stored_encrypted` / `inherit`, plus `content_retention_days`.
- Chaque option accompagnée de **sa conséquence en clair**.
- Affichage de la politique effective d'un client (héritée ou propre), pour lever l'ambiguïté d'`inherit`.

## Points d'implémentation clés
- **Honnêteté** (§6.18) : l'écran doit dire que le chiffrement protège **le repos** et que
  `content:read` reste la frontière d'accès. Ne jamais présenter `stored_encrypted` comme « sécurisé ».
- Passer de `stored_*` à `off` n'efface pas rétroactivement : le dire, et renvoyer vers l'effacement
  (step-165) pour ceux qui veulent détruire.
- `inherit` doit toujours afficher **la valeur effective** résolue, sinon l'écran ment par omission.
- Un changement de politique est à large conséquence : confirmation, et audit.

## Tests (écrits dans la même PR)
- Les quatre options rendent leur conséquence ; `inherit` affiche la valeur effective.
- Passer à `off` affiche l'avertissement de non-rétroactivité.
- Refusé sans permission ; changement audité.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] copie d'honnêteté présente · valeur effective toujours affichée

## Hors périmètre
Les effacements → step-165 et step-166.
