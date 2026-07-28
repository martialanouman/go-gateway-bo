# step-065 — Quotas, limites de débit et `max_sessions` (avertissement d'écart)

> **Jalon :** M3 (§6.5) · **Statut :** À FAIRE
> **Dépend de :** step-064 · **Bloque :** step-086

## But
Rendre réglables les limites d'un compte — et rendre impossible le malentendu le plus courant :
croire qu'une baisse de quota coupe les binds déjà ouverts.

## Périmètre (ce que fait CETTE PR)
- Section Quotas : limites de débit et `max_sessions` (`set-account-session-limits`).
- Affichage **« sessions vivantes / limite »** alimenté par `list-account-sessions`.
- **Badge d'écart explicite** quand les binds vivants dépassent la limite : « 8 vivantes / limite 4 ».
- **Avertissement avant sauvegarde** si la valeur saisie est inférieure au nombre de sessions ouvertes.

## Points d'implémentation clés
- Le point pédagogique du §6.5 : **baisser le quota ne coupe pas les binds vivants**. La copie le dit
  en toutes lettres, et l'écran indique que forcer la convergence exige une déconnexion explicite
  (step-086).
- L'écart n'est pas une erreur : c'est un état légitime, rendu comme un avertissement, pas comme une
  panne.
- Le nombre de sessions vivantes est une donnée en direct : marquer sa fraîcheur, ne pas la figer.
- Les valeurs machine (`max_sessions`) restent en mono et non traduites.

## Tests (écrits dans la même PR)
- Sauvegarder une limite inférieure aux sessions ouvertes déclenche l'avertissement et n'est pas
  bloquée après confirmation.
- Le badge d'écart s'affiche exactement dans le cas « vivantes > limite ».
- Refusé sans `accounts:write`.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] copie « ne coupe pas les binds vivants » présente et testée

## Hors périmètre
La déconnexion forcée → step-086.
