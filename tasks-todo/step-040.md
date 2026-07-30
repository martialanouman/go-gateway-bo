# step-040 — AppShell : rail de navigation, barre supérieure, layout, routage fichiers

> **Jalon :** M2 (§4.2) · **Statut :** À FAIRE
> **Dépend de :** step-003, step-022, step-041, step-042 · **Bloque :** step-026, step-027, tous les écrans

> **Dépendances corrigées le 30/07/2026.** La ligne annonçait `step-003, step-022` seulement, alors
> que le périmètre ci-dessous exige les primitives (`041`) pour le rail, la barre et `Page`, et les
> états `Empty` / `Loading` (`042`) pour les routes vides et les squelettes. `usePermission` /
> `PermissionGate` **remontent de `step-026` vers cette step** : le rail filtre ses entrées dès qu'il
> existe, et les livrer plus tard aurait fait sortir une navigation montrant des entrées
> inutilisables. Voir la note † de `INDEX.md`.

## But
Poser la coquille dans laquelle tous les écrans viendront se brancher : navigation, en-tête, zone de
contenu, et l'arborescence de routes qui les accueillera.

## Périmètre (ce que fait CETTE PR)
- `AppShell` d'après `AppShell.jsx` du kit UI : rail de navigation groupé (Exploitation, Clients,
  Routage, Conformité, Facturation, Administration), barre supérieure, zone de contenu, pile de toasts.
- Arborescence `src/routes/` complète en **routes vides mais nommées**, chacune rendant l'état vide
  explicite prévu par la charte plutôt qu'un écran inventé.
- Composants de mise en page : `Page` (titre, fil d'ariane, actions), `Toolbar`.
- **Hook `usePermission(key)` alimenté par `/auth/me`, et composant `PermissionGate`** (remontés de
  `step-026`). Le rendu conditionnel est un **confort**, jamais une garde : l'autorisation vit dans
  `requirePermission()` côté serveur (step-025, invariant c).
- Entrées de navigation filtrées par permission (via `PermissionGate`), avec compteurs quand ils sont
  connus.

## Points d'implémentation clés
- **Desktop-first**, dégradation propre sur tablette (§1.2) : le rail se réduit, il ne disparaît pas.
- Densité maîtrisée : hiérarchiser, pas entasser — la charte prime sur l'envie de remplir.
- La route active doit être dérivée du routeur, jamais d'un état local dupliqué.
- Squelettes de chargement reproduisant la **vraie** mise en page (charte §08), pas un spinner centré.

## Tests (écrits dans la même PR)
- `usePermission` / `PermissionGate` : avec la clé, l'enfant est rendu ; sans, il est désactivé et
  expliqué — jamais retiré en silence.
- La navigation rend la route correspondante ; l'entrée active reflète l'URL.
- Une entrée dont l'opérateur n'a pas la permission est absente ou désactivée avec sa raison.
- Chaque route déclarée rend un état vide explicite, aucune page blanche.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] navigation clavier complète · repères ARIA corrects

## Hors périmètre
Le contenu réel de chaque écran → jalons M3 à M9.
