# step-041 — Primitives UI lot 1 : bouton, champ, select, pilule de statut, tabs, table

> **Jalon :** M2 (§4.2) · **Statut :** À FAIRE
> **Dépend de :** step-003 · **Bloque :** step-042, step-040, step-026 et tous les écrans

## But
Construire les composants les plus utilisés, une fois, correctement : Base UI pour le comportement
accessible, tokens de la charte pour la forme.

## Périmètre (ce que fait CETTE PR)
- `Button` (variantes en contour selon la charte), `TextField`, `Select`, `Checkbox`, `Radio`,
  `Switch`, `Tabs`, `StatusPill`, `Table` (en-têtes triables, densité).
- `StatusPill` porte la sémantique de statut de la charte : **une couleur + un libellé** par état
  critique, et conserve le `snake_case` de l'API (`half_open`, `reconnecting`).
- Indicateur de valeur en direct (point pulsant) réservé aux données WS ; jamais sur un instantané.
- Ajout à la page `/_design` : chaque primitive avec ses états (défaut, survol, focus, désactivé,
  invalide, chargement).

## Points d'implémentation clés
- **Base UI** (`@base-ui/react`) fournit le comportement et l'accessibilité ; vérifier l'API via
  **`ctx7`** avant chaque composant — le package est en 1.x et a changé de nom.
- Un champ invalide porte un message lié par `aria-describedby`, pas seulement une bordure rouge.
- Les valeurs machine (identifiants, compteurs, MSISDN) sont rendues en **mono** ; le texte narratif
  jamais.
- Aucun composant ne code une couleur en dur : uniquement des tokens.

## Tests (écrits dans la même PR)
- Rendu et interaction clavier de chaque primitive (`user-event`).
- `StatusPill` : chaque état de la charte donne la bonne paire couleur/libellé.
- Un champ invalide expose son message aux technologies d'assistance.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] toutes les primitives visibles sur `/_design` avec leurs états

## Hors périmètre
Overlays et états de contenu → step-042.
