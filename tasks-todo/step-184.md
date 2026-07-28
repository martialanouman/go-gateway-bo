# step-184 — Journal d'audit : écran de consultation

> **Jalon :** M9 (§1.1, §3.1) · **Statut :** À FAIRE
> **Dépend de :** step-025, step-100 · **Bloque :** —

## But
Rendre consultable la piste d'audit écrite depuis la step-025 : qui a fait quoi, quand, et avec quel
avant/après.

## Périmètre (ce que fait CETTE PR)
- Écran Journal d'audit (permission **`audit:read`**) : `GET /audit-log?operator=&targetType=
  &dateFrom=&dateTo=`.
- Table paginée, filtres opérateur / type de cible / plage de dates / action.
- Panneau de détail : `before_json` / `after_json` rendus en **différentiel lisible**, adresse IP,
  horodatage.
- Export du résultat filtré (mêmes règles de gouvernance que l'export CDR).

## Points d'implémentation clés
- Le rôle `auditor` n'a **que** `audit:read` (§6.10) : cet écran doit être entièrement utilisable
  avec cette seule permission, sans dépendre d'un appel exigeant autre chose.
- `before_json` / `after_json` ne contiennent ni corps ni secret (garanti en step-025) : le vérifier
  ici aussi, côté rendu, plutôt que de faire confiance.
- Le différentiel doit rester lisible sur de gros objets : replier l'inchangé, mettre en avant ce qui
  a changé.
- La table est partitionnée par mois (step-002) : les filtres de date doivent en profiter, pas la
  scanner entière.

## Tests (écrits dans la même PR)
- Filtres opérateur, cible et plage de dates ; pagination stable.
- Aucun secret ni corps rendu, même si un enregistrement piégé en contient (invariants a et b).
- Un opérateur `auditor` accède à l'écran complet ; un opérateur sans `audit:read` est refusé.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] utilisable avec `audit:read` seul · invariants (a)(b) revérifiés au rendu

## Hors périmètre
L'écriture de l'audit → step-025.
