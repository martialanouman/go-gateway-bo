# step-141 — Suppressions : création, import en masse, mots-clés par pays

> **Jalon :** M7 (§6.16) · **Statut :** À FAIRE
> **Dépend de :** step-140 · **Bloque :** —

## But
Alimenter les listes de suppression : à l'unité, en masse, et par les mots-clés qui les déclenchent
automatiquement.

## Périmètre (ce que fait CETTE PR)
- Création unitaire (`create-suppression`, `suppressions:write`) avec choix de portée explicite.
- **Import en masse** (`import-suppressions`) avec **compte-rendu** : acceptés, rejetés et pourquoi.
- Mots-clés opt-out par pays (`list-opt-out-keywords`, `create-opt-out-keyword`,
  `update-opt-out-keyword`, `delete-opt-out-keyword`) : STOP / START / HELP + gabarits.
- Aperçu des gabarits de réponse automatique.

## Points d'implémentation clés
- Ajouter une suppression est peu risqué, la retirer l'est beaucoup : cette asymétrie doit se voir
  dans l'UI (création simple ici, levée gardée en step-143).
- L'import doit **toujours** rendre son compte-rendu ligne à ligne : un import silencieux sur des
  données de conformité est inacceptable.
- Les mots-clés sont par pays : afficher le pays comme dimension de premier plan, pas comme un champ
  secondaire.
- Une réponse automatique STOP n'est **jamais facturée** : le rappeler dans l'aide contextuelle.

## Tests (écrits dans la même PR)
- Création unitaire avec portée ; refusée sans `suppressions:write`.
- Import : compte-rendu détaillé, lignes invalides rejetées sans bloquer les valides.
- CRUD des mots-clés par pays.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] compte-rendu d'import complet · actions auditées

## Hors périmètre
La levée de suppression → step-143.
