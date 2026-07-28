# step-120 — Routes : table par priorité + réordonnancement

> **Jalon :** M6 (§6.1) · **Statut :** À FAIRE
> **Dépend de :** step-083, step-041 · **Bloque :** step-121, step-122

## But
Rendre l'ordre de matching des routes visible et manipulable : la priorité est la première chose
qu'un opérateur doit comprendre.

## Périmètre (ce que fait CETTE PR)
- Écran Routes (`routes:read` / `routes:write`) : table **ordonnée par priorité**, chaque ligne
  résumant conditions, stratégie et connecteur(s).
- Réordonnancement par **glisser-déposer** → `reorder-routes`, avec équivalent clavier obligatoire.
- Opérations : `list-routes`, `get-route`, `delete-route`.
- Activation/désactivation d'une route depuis la table.

## Points d'implémentation clés
- Le glisser-déposer n'est **jamais** la seule façon de réordonner : une alternative clavier
  (monter/descendre, ou saisie de position) est exigée par WCAG 2.1 AA (§1.2).
- Le réordonnancement est une écriture serveur : optimiste à l'affichage, mais **réconcilié** et
  annulé visuellement si l'appel échoue.
- La table doit rappeler ce qui **prime** sur elle : numéro exact, puis script, puis déclaratif —
  la bannière complète arrive en step-122.
- Aucune renumérotation locale inventée : la priorité qui fait foi est celle du serveur.

## Tests (écrits dans la même PR)
- Réordonnancement souris et clavier produisent le même appel.
- Échec serveur → retour à l'ordre précédent avec message.
- Sans `routes:write`, la table est en lecture seule et l'explique.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] alternative clavier au glisser-déposer testée

## Hors périmètre
L'éditeur de route → step-121. Le simulateur → step-122.
