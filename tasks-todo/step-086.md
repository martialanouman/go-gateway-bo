# step-086 — Sessions : déconnexion forcée + écart `max_sessions`

> **Jalon :** M4 (§6.5) · **Statut :** À FAIRE
> **Dépend de :** step-085, step-065 · **Bloque :** —

## But
Donner à l'opérateur le seul moyen de faire converger un compte vers son quota — et l'entourer de
tout ce qu'une action destructrice exige.

## Périmètre (ce que fait CETTE PR)
- Action `disconnect-session` (`sessions:disconnect`) avec confirmation nommant la session concernée :
  « Un unbind gracieux sera envoyé à `ses_9f2a…`. Le compte devra se reconnecter. »
- Vue par compte : sessions vivantes vs `max_sessions`, avec le badge d'écart de la step-065.
- Chemin explicite « faire converger » depuis l'écart : sélectionner et déconnecter.
- Journalisation systématique (`session.disconnect`).

## Points d'implémentation clés
- Rappel du §6.5 : baisser un quota **ne coupe pas** les binds vivants ; seule cette action le fait.
  L'écran est l'endroit où cette règle devient concrète.
- Aucune déconnexion de masse sans énumération préalable de ce qui va être coupé.
- L'identifiant de session est une valeur machine : mono, tronqué à l'affichage mais copiable en entier.
- L'action est irréversible du point de vue de l'opérateur : confirmation à conséquence, pas un
  simple « OK ».

## Tests (écrits dans la même PR)
- Déconnexion sous permission ; refusée sans `sessions:disconnect`.
- La confirmation nomme la session ; l'action est auditée.
- Après déconnexion, l'écart se réduit et le badge disparaît quand la convergence est atteinte.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] confirmation nommée · action auditée

## Hors périmètre
Le réglage du quota lui-même → step-065.
