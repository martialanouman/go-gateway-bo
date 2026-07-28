# step-121 — Éditeur de route : conditions, stratégie, cibles, route de repli

> **Jalon :** M6 (§6.1) · **Statut :** À FAIRE
> **Dépend de :** step-120 · **Bloque :** step-122

## But
Construire une règle de routage déclarative sans écrire de configuration : champs structurés, éditeur
de cibles adapté à la stratégie choisie.

## Périmètre (ce que fait CETTE PR)
- Formulaire d'édition (`create-route`, `update-route`) : conditions structurées (compte, client,
  expéditeur, destination, contenu) avec **testeur de regex** intégré.
- Menu de **stratégie de distribution**, et éditeur de cibles **adapté** : poids pour `weighted`,
  ordre pour `failover_priority`.
- Sélecteur de **route de repli**.
- Validation en ligne et prévisualisation du résumé tel qu'il apparaîtra dans la table.

## Points d'implémentation clés
- L'éditeur de cibles change **de forme** selon la stratégie : une liste pondérée et une liste ordonnée
  ne se manipulent pas pareil. Un champ générique « cibles » raterait l'intention du §6.1.
- Le testeur de regex s'exécute côté client sur un échantillon fourni par l'opérateur — **jamais** sur
  un corps de message réel (invariant a).
- Une route de repli pointant sur elle-même ou créant un cycle est refusée avec un message clair.
- Les noms de stratégies restent verbatim (`weighted`, `failover_priority`), en mono.

## Tests (écrits dans la même PR)
- Chaque stratégie rend l'éditeur de cibles attendu.
- Le testeur de regex signale une expression invalide sans planter l'écran.
- Cycle de repli refusé ; création et mise à jour auditées.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] éditeur de cibles conditionné par la stratégie · aucun corps réel dans le testeur

## Hors périmètre
La simulation contre le moteur → step-122.
