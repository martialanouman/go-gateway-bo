# step-124 — Éditeur Monaco : contrat `resolveRoute`, validation, test contre payload

> **Jalon :** M6 (§6.2) · **Statut :** À FAIRE
> **Dépend de :** step-042 · **Bloque :** step-125

## But
Poser l'IDE embarqué : écrire un script de routage, le valider et l'exécuter contre un payload
d'exemple, sans quitter le tableau de bord.

## Périmètre (ce que fait CETTE PR)
- Écran Scripts (`scripts:read` / `scripts:write`) : liste + éditeur **Monaco** (JS/Lua).
- Contrat documenté dans l'éditeur : `resolveRoute(message) -> routeId | null`, avec les aides
  `lookup()` / `findRouteByName()`.
- `validate-routing-script` : diagnostics de **lint en ligne** (marqueurs Monaco).
- `test-routing-script` : exécuteur de payload en **split-pane**, affichant la route résolue ou
  « aucune correspondance ».
- CRUD : `list-routing-scripts`, `get-routing-script`, `create-routing-script`,
  `update-routing-script`, `delete-routing-script`.
- **Messages de garde-fou** visibles : limites du bac à sable et repli déclaratif —
  « Bac à sable : timeout 50 ms · mémoire 8 Mo. En cas d'échec, le routage déclaratif prend le relais. »

## Points d'implémentation clés
- Monaco est lourd : **chargement paresseux**, uniquement sur cet écran, pour ne pas peser sur le
  reste de l'application.
- Le payload de test est saisi par l'opérateur, jamais tiré d'un message réel, et n'est pas journalisé
  (invariant a).
- L'exécution réelle a lieu **côté passerelle** (bac à sable) : le tableau de bord n'exécute jamais de
  script utilisateur dans le navigateur.
- Outil exclusivement du fournisseur : aucun script client, nulle part (§6.2).
- Thème Monaco aligné sur les tokens de la charte, pas le thème par défaut.

## Tests (écrits dans la même PR)
- Un script invalide produit des marqueurs de diagnostic en ligne.
- Le test contre payload affiche la route résolue et le cas « aucune correspondance ».
- Monaco n'est pas chargé sur les autres écrans (test de bundle ou de chargement).

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] chargement paresseux vérifié · garde-fous affichés

## Hors périmètre
Publication, versions et portée → step-125.
