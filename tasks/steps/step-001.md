# step-001 — SPA Vite + TanStack Router : portage du client et squelette de chargement

> **Jalon :** M0 (§4.2, §1.9) · **Statut :** LIVRÉE
> **Dépend de :** step-000 · **Bloque :** step-002, step-006, step-007, step-008

## But
Déplacer le client React sous `web/` et le faire démarrer **sans framework serveur** : Vite, le plugin
de routage de TanStack, un `index.html`, une entrée client. Et surtout : **un chargement à froid qui
peint le squelette de la coquille**, jamais un blanc.

## Périmètre (ce que fait CETTE PR)
- L'arborescence `web/src/` créée à neuf : `routes/`, `components/`, `lib/`, `styles/`. Une seule
  route pour commencer — les écrans arrivent avec leurs steps. *(Amendement 01/08/2026 : `components/`
  et `lib/` ne sont pas créés. Git ne versionne pas un répertoire vide, et CLAUDE.md pose que chaque
  package naît avec le code qui l'habite — c'est le même arbitrage qu'en step-000 pour les paquets
  `internal/`. `components/` naît en step-041 avec les primitives, `lib/` en step-004 avec les types
  client engendrés par le contrat du BFF.)*
- `web/index.html`, une entrée client qui monte `RouterProvider`, une route racine, et
  `@tanstack/router-plugin/vite` qui engendre l'arbre de routes.
- **Squelette de chargement dans `index.html`** : la silhouette de l'AppShell — rail, barre
  supérieure, zone de contenu — peinte en CSS pur, remplacée par React au montage.
- `vite dev` avec `server.proxy` : `/api` et `/ws` vers le BFF Go de step-000.
- Retrait des dépendances de l'ancien socle serveur (`@tanstack/react-start`, plugin Nitro).
- CI : job client (typecheck, lint, test, build).

## Points d'implémentation clés
- **TypeScript 7 n'inclut pas `node_modules/@types/*` automatiquement** comme TS 5 le faisait :
  vérifié, `tsc --listFilesOnly` n'en remonte aucun fichier. Déclarer `"types": ["node",
  "vite/client"]` explicitement, sinon les imports CSS et les API Node échouent sans raison lisible.
- **`strictPort: true`** : sans lui Vite glisse silencieusement sur le port suivant quand le sien est
  pris — et le port suivant est celui du BFF. Le symptôme observé était un proxy qui se parlait à
  lui-même. §1.8 proscrit le repli silencieux ; la règle vaut aussi pour le serveur de dev.
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
- **Réactiver `javascript-typescript` dans CodeQL** (*Settings → Code security → Default setup*) : la
  langue en a été retirée quand le dépôt a été remis à neuf, parce que CodeQL échoue
  fatalement sur un dépôt sans code à analyser. Cette step livre le premier code client.
- [x] `make check` vert des deux côtés
- [x] `make dev` sert l'application et proxifie `/api` vers le BFF
- [x] aucune dépendance à l'ancien socle serveur ne subsiste dans `web/package.json` — elles avaient
      déjà disparu avec la remise à neuf ; vérifié plutôt que refait
- [x] la mutation « vider le squelette de `index.html` » fait rougir le test de chargement à froid
      (sept tests rouges)

## Hors périmètre
`embed.FS` et le service des assets par le Go → step-002. La charte et `/_design` → step-008. Le
branchement des écrans sur leurs handlers → M1 et M2.
