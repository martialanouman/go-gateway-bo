# step-042 — Primitives UI lot 2 : dialog, menu, tooltip, toast + les cinq états de contenu

> **Jalon :** M2 (charte §08) · **Statut :** À FAIRE
> **Dépend de :** step-041 · **Bloque :** step-026 et tous les écrans

## But
Livrer les surfaces flottantes et, surtout, normaliser les cinq états de contenu pour qu'aucun écran
n'improvise un vide, une erreur ou une dégradation.

## Périmètre (ce que fait CETTE PR)
- `Dialog` (dont variante de confirmation à conséquence), `DropdownMenu`, `Tooltip`, `Popover`,
  `Toast` + pile de toasts avec barre latérale colorée par sévérité.
- **Cinq états distincts**, chacun un composant : `Loading` (squelette reproduisant la mise en page),
  `Empty` (rien encore + comment créer), `NoResults` (filtres trop étroits + comment élargir),
  `ModuleDisabled` (dégradation propre, **jamais** une erreur), `ErrorState` (réalité HTTP +
  « vos données locales restent affichées » + Réessayer).
- `ConfirmDialog` : titre, **conséquence en clair**, saisie de confirmation pour les actes
  irréversibles.

## Points d'implémentation clés
- Ces cinq états ne sont pas décoratifs : ils sont la différence entre « rien à afficher » et « c'est
  cassé ». Un écran qui confond les deux est un bug de step.
- `ModuleDisabled` sert la facturation désactivée (§1.3) : dégradation, pas erreur.
- Focus piégé dans les dialogs, restauration du focus à la fermeture, `Escape` fonctionnel.
- Les toasts ne portent **jamais** un corps de message ni un secret (invariants a et b).

## Tests (écrits dans la même PR)
- Dialog : piège de focus, restauration, fermeture clavier.
- Les cinq états rendent des textes distincts ; `ModuleDisabled` n'est jamais rendu comme une erreur.
- `ConfirmDialog` : l'action ne part pas sans confirmation explicite.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] les cinq états sont sur `/_design` avec leur copie française définitive

## Hors périmètre
Le centre de notifications → step-046.
