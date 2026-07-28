# step-144 — Numéros entrants : CRUD, affectation, mots-clés

> **Jalon :** M7 (§6.7) · **Statut :** À FAIRE
> **Dépend de :** step-063 · **Bloque :** step-145

## But
Gérer les shortcodes et long codes par lesquels arrivent les MO — et décider à quel compte va chaque
message entrant.

## Périmètre (ce que fait CETTE PR)
- CRUD numéros entrants (`inbound:read` / `inbound:write`) : `list-inbound-numbers`,
  `create-inbound-number`, `update-inbound-number`, `delete-inbound-number`.
- Attributs : adresse, type, pays, connecteur, affectation **dédié / partagé**.
- Affectation (`assign-inbound-number`).
- Éditeur de **mots-clés** pour les numéros partagés : `list-inbound-keywords`,
  `create-inbound-keyword`, `update-inbound-keyword`, `delete-inbound-keyword`.
- Test « à quel compte irait ce MO ? ».

## Points d'implémentation clés
- Dédié et partagé ne se gèrent pas pareil : un numéro dédié n'a pas de mots-clés, un partagé en
  dépend entièrement. L'UI doit basculer, pas afficher les deux à vide.
- Un mot-clé en collision avec un mot-clé d'opt-out (STOP/START/HELP, step-141) doit être signalé :
  la conformité prime sur le routage MO.
- Le test « à quel compte irait ce MO ? » est l'outil de diagnostic de l'écran : le rendre atteignable
  en un clic depuis un numéro.
- Le pays est structurant (comme pour les mots-clés d'opt-out), pas un champ libre.

## Tests (écrits dans la même PR)
- CRUD et affectation sous permission.
- Un numéro partagé sans mot-clé est signalé comme incomplet.
- Collision avec un mot-clé d'opt-out signalée.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] bascule dédié/partagé testée · collisions signalées

## Hors périmètre
La file des MO non routés → step-145.
