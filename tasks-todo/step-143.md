# step-143 — Levée de suppression (`suppressions:delete`, confirmation, audit)

> **Jalon :** M7 (§6.16, §7) · **Statut :** À FAIRE
> **Dépend de :** step-140, step-025 · **Bloque :** —

## But
Isoler l'acte le plus à risque juridique du produit : réautoriser l'envoi vers quelqu'un qui s'est
désabonné.

## Périmètre (ce que fait CETTE PR)
- Action de levée (`delete-suppression`) derrière la permission **dédiée `suppressions:delete`**,
  bouton distinct de tout le reste de l'écran.
- Confirmation à conséquence : qui, quel canal, depuis quand, quelle origine — et ce que la levée
  autorise à nouveau.
- Audit obligatoire (`suppression.delete`) avec l'opérateur, l'horodatage et la cible.
- Copie rappelant que seul le rôle `compliance` détient cette permission par défaut.

## Points d'implémentation clés
- Le §7 est explicite : « réautoriser un désabonné est l'acte à risque juridique ; réservé à un rôle
  dédié, pas à l'exploitation courante ». `ops` a `suppressions:read/write` **sans** `:delete` — le
  vérifier explicitement.
- Une suppression d'origine `regulator` mérite un avertissement renforcé : la lever peut être illégal.
- Pas de levée en masse dans cette step : une levée = un acte = une trace.
- Le bouton n'est jamais masqué à un opérateur non habilité : il est désactivé et **expliqué**.

## Tests (écrits dans la même PR)
- Un opérateur `ops` ne peut pas lever, et voit pourquoi ; `compliance` le peut.
- La levée écrit exactement une ligne d'audit avec la cible.
- Origine `regulator` → avertissement renforcé.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] permission dédiée testée (y compris le refus pour `ops`) · audit vérifié

## Hors périmètre
L'effacement RGPD (qui conserve l'opt-out) → step-166.
