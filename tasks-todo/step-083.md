# step-083 — Connecteurs : CRUD à divulgation progressive, pool de binds, reconnexion

> **Jalon :** M4 (§1.1, §7) · **Statut :** À FAIRE
> **Dépend de :** step-040, step-041, step-042 · **Bloque :** step-084

## But
Rendre la création d'un connecteur SMSC praticable : peu de champs requis, le reste par défaut et
replié — un formulaire plat serait accablant pour le cas courant.

## Périmètre (ce que fait CETTE PR)
- Écran Connecteurs : `list-connectors`, `get-connector`, `create-connector`, `update-connector`,
  `delete-connector`.
- Formulaire à **divulgation progressive** : champs requis d'abord, section « Avancé » pour
  l'ensemble des options SMPP.
- Configuration du **pool de binds** (`set-connector-bind-pool`) et de la **politique de
  reconnexion** (`set-connector-reconnect-policy`).
- Débit et taux d'erreur affichés sur la fiche.

## Points d'implémentation clés
- Le compromis du §7 est le cœur de la step : « peu de champs requis, le reste par défaut ». Chaque
  champ avancé porte sa valeur par défaut visible, pour qu'un opérateur sache ce qu'il change.
- Le pool de binds est une capacité, pas un réglage cosmétique : afficher l'effet attendu sur le débit.
- Ne jamais afficher le mot de passe de bind du connecteur (invariant b) — masqué comme les autres
  secrets.
- Supprimer un connecteur référencé par une route est une action à conséquence : le dire, avec la liste.

## Tests (écrits dans la même PR)
- Création avec les seuls champs requis ; la section avancée reste repliée par défaut.
- Pool et politique de reconnexion se sauvegardent et se relisent.
- Suppression d'un connecteur référencé : avertissement listant les routes concernées.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] aucun secret de bind affiché · valeurs par défaut visibles

## Hors périmètre
La santé en direct et le rebind → step-084.
