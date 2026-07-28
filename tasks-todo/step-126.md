# step-126 — Règles de réécriture de sender ID : CRUD + test

> **Jalon :** M6 (§6.13) · **Statut :** À FAIRE
> **Dépend de :** step-083, step-062 · **Bloque :** —

## But
Gérer la réécriture d'expéditeur à quatre portées, avec la précédence visible — sinon personne ne sait
quelle règle a gagné.

## Périmètre (ce que fait CETTE PR)
- Écran CRUD (`senderrewrite:read` / `senderrewrite:write`) : `list-sender-rewrite-rules`
  (`?scope=&scopeId=`), `create-sender-rewrite-rule`, `update-sender-rewrite-rule`,
  `delete-sender-rewrite-rule`.
- Création **consciente de la portée** : plateforme / client / compte / connecteur.
- Éditeur : conditions, type de réécriture, priorité, **raison**.
- **Visibilité de la précédence** : quelle règle l'emporterait, et pourquoi.
- Action de **test** (`test-sender-rewrite-rule`) sur un exemple.
- Points d'entrée depuis Connecteur, Client, Compte, plus une liste plateforme.

## Points d'implémentation clés
- La précédence entre quatre portées est le piège de l'écran : l'afficher explicitement, pas la
  laisser deviner par la priorité numérique.
- Le champ « raison » est un vrai champ d'exploitation : il explique en CDR pourquoi l'adresse
  affichée diffère de l'adresse soumise (§6.13). Le rendre obligatoire.
- Visibilité CDR : rappeler que le CDR porte **adresse originale vs utilisée** — le lien avec le CDR
  Explorer aide au diagnostic.
- Une règle de portée plateforme est une action à large impact : confirmation à conséquence.

## Tests (écrits dans la même PR)
- CRUD aux quatre portées sous permission.
- Le test de règle renvoie l'adresse réécrite attendue.
- La précédence affichée correspond à la règle qui gagnerait réellement.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] précédence explicite testée · raison obligatoire

## Hors périmètre
L'autorisation de sender ID (côté client) → step-062.
