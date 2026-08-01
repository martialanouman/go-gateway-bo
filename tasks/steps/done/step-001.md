# step-001 — SPA Vite + TanStack Router : portage du client et squelette de chargement

> **Jalon :** M0 (§4.2, §1.9) · **Statut :** LIVRÉE
> **Dépend de :** step-000 · **Bloque :** step-002, step-006, step-007, step-008

## But
Déplacer le client React sous `web/` et le faire démarrer **sans framework serveur** : Vite, le plugin
de routage de TanStack, un `index.html`, une entrée client. Et surtout : **un chargement à froid qui
peint le squelette de la coquille**, jamais un blanc.

## Périmètre (ce que fait CETTE PR)
- `git mv src web/src` — les ~8 500 lignes de composants, écrans, `lib` et tokens suivent, avec leur
  historique. `tsconfig.json`, l'alias `~`, Biome et Vitest sont reciblés sur `web/`.
- **Remplacement de l'enveloppe du framework** : `__root.tsx` cède la place à `web/index.html` + une
  entrée client qui monte `RouterProvider` ; `@tanstack/router-plugin/vite` remplace le plugin de
  Start et régénère l'arbre de routes.
- **Squelette de chargement dans `index.html`** : la silhouette de l'AppShell — rail, barre
  supérieure, zone de contenu — peinte en CSS pur, remplacée par React au montage.
- `vite dev` avec `server.proxy` : `/api` et `/ws` vers le BFF Go de step-000.
- Retrait des dépendances de l'ancien socle serveur (`@tanstack/react-start`, plugin Nitro).
- CI : job client (typecheck, lint, test, build).

## Points d'implémentation clés
- **Les écrans suivent le déménagement mais ne sont pas acquis pour autant.** Ils compilent — ce sont
  du React + TanStack Router + Query ordinaires — mais aucun n'a de handler Go en face. Ils rendent
  donc leur état d'erreur, ce qui est le comportement voulu par la convention §1.9, pas un défaut.
  Chacun sera *vérifié* dans sa propre step (008, 040 à 042, 027 à 029).
- **Le squelette n'est pas un `spinner`.** §1.9 exige « le squelette de la vraie mise en page ». Un
  rond qui tourne est un blanc décoré : il ne dit pas ce qui arrive et fait sursauter la mise en page
  quand le contenu apparaît.
- L'arbre de routes généré est **commité** ; la CI vérifie qu'il est à jour.
- Deux processus en développement, un seul en production. Le `proxy` de Vite rejoue exactement le
  chemin de production — c'est la raison de le préférer à un serveur de développement maison.

## Tests (écrits dans la même PR)
- **Scénario / parcours** : *Étant donné* une URL profonde collée dans un onglet neuf, *Quand* la page
  charge, *Alors* la silhouette de la coquille est peinte **avant** que le bundle démarre.
  Le vérifier en désactivant JavaScript, ou en assertant le HTML servi — pas après hydratation, ce qui
  ne prouverait rien.
- `pnpm -C web build` produit un bundle ; `pnpm -C web typecheck` est vert sur l'arbre déplacé.
- L'arbre de routes régénéré est identique au fichier commité.

## Definition of Done
- [ ] `make check` vert des deux côtés
- [ ] `make dev` sert l'application et proxifie `/api` vers le BFF
- [ ] aucune dépendance à l'ancien socle serveur ne subsiste dans `web/package.json`
- [ ] la mutation « vider le squelette de `index.html` » fait rougir le test de chargement à froid

## Hors périmètre
`embed.FS` et le service des assets par le Go → step-002. La charte et `/_design` → step-008. Le
branchement des écrans sur leurs handlers → M1 et M2.
