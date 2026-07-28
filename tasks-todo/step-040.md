# step-040 — AppShell : rail de navigation, barre supérieure, layout, routage fichiers

> **Jalon :** M2 (§4.2) · **Statut :** À FAIRE
> **Dépend de :** step-003, step-022 · **Bloque :** tous les écrans

## But
Poser la coquille dans laquelle tous les écrans viendront se brancher : navigation, en-tête, zone de
contenu, et l'arborescence de routes qui les accueillera.

## Périmètre (ce que fait CETTE PR)
- `AppShell` d'après `AppShell.jsx` du kit UI : rail de navigation groupé (Exploitation, Clients,
  Routage, Conformité, Facturation, Administration), barre supérieure, zone de contenu, pile de toasts.
- Arborescence `src/routes/` complète en **routes vides mais nommées**, chacune rendant l'état vide
  explicite prévu par la charte plutôt qu'un écran inventé.
- Composants de mise en page : `Page` (titre, fil d'ariane, actions), `Toolbar`.
- Entrées de navigation filtrées par permission (via `PermissionGate`), avec compteurs quand ils sont
  connus.

## Points d'implémentation clés
- **Desktop-first**, dégradation propre sur tablette (§1.2) : le rail se réduit, il ne disparaît pas.
- Densité maîtrisée : hiérarchiser, pas entasser — la charte prime sur l'envie de remplir.
- La route active doit être dérivée du routeur, jamais d'un état local dupliqué.
- Squelettes de chargement reproduisant la **vraie** mise en page (charte §08), pas un spinner centré.

## Tests (écrits dans la même PR)
- La navigation rend la route correspondante ; l'entrée active reflète l'URL.
- Une entrée dont l'opérateur n'a pas la permission est absente ou désactivée avec sa raison.
- Chaque route déclarée rend un état vide explicite, aucune page blanche.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] navigation clavier complète · repères ARIA corrects

## Hors périmètre
Le contenu réel de chaque écran → jalons M3 à M9.
