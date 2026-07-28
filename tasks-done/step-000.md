# step-000 — Scaffold TanStack Start (pnpm, TS strict, lint/format, CI)

> **Jalon :** M0 (§1.3, §4.2 `docs/specification-technique-tableau-de-bord.md`) · **Statut :** À FAIRE
> **Dépend de :** — · **Bloque :** toutes les steps suivantes

## But
Poser un dépôt qui compile, se lint et se déploie en Node auto-hébergé, pour que toute step suivante
n'ait plus qu'à ajouter du produit.

## Périmètre (ce que fait CETTE PR)
- Application TanStack Start (React + TypeScript, Vite, SSR + fonctions serveur), gestionnaire **pnpm**.
- `tsconfig.json` en `strict` (+ `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
- Arborescence : `src/routes/` (routage fichiers), `src/server/` (BFF), `src/components/`,
  `src/lib/`, `src/styles/`.
- Lint + format (Biome) + `pnpm` scripts :
  `dev`, `build`, `start`, `typecheck`, `lint`, `format`, `test`.
- CI GitHub Actions : install pnpm avec cache, `typecheck`, `lint`, `build` sur chaque PR.
- `README.md` : démarrage local en trois commandes. `.env.example` documenté, `.env` ignoré.
- `CLAUDE.md` du dépôt : pile, invariants (a…e), DoD, index documentaire.

## Points d'implémentation clés
- **Cible Node auto-hébergée**, jamais edge/serverless : le hub WebSocket exige un process
  longue durée (§1.3). Choisir le preset de build en conséquence dès maintenant.
- **`ctx7` avant d'installer** : TanStack Start évolue vite (`createServerFn`, `createFileRoute`
  avec `server.handlers`). Ne recopier aucune API de mémoire.
- Node ≥ 24 LTS ; figer la version dans `.nvmrc` et dans la CI.
- Aucune dépendance de composants UI à ce stade — elles arrivent en step-041.

## Tests (écrits dans la même PR)
- Un test de fumée (Vitest) qui rend la route racine.
- La CI échoue si `typecheck` ou `lint` échoue (vérifié par une PR de démonstration ou un run local).

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] `pnpm dev` sert l'application ; `pnpm build && pnpm start` la sert en Node
- [ ] CI verte sur la PR · `.env` jamais commité

## Hors périmètre
Contrat API et mock → step-001. Base de données → step-002. Tokens visuels → step-003.
