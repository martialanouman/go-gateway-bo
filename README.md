# Tableau de bord Admin — Passerelle SMS

Cockpit d'exploitation interne de la passerelle SMS : clients, comptes SMPP, connecteurs, routage,
conformité, facturation. Application **TanStack Start** (React + TypeScript), servie par un process
Node auto-hébergé qui joue aussi le rôle de **BFF** vers l'API Admin de la passerelle.

## Démarrer

```bash
pnpm install
cp .env.example .env     # renseigner au minimum GATEWAY_* si l'on vise la vraie passerelle
pnpm dev                 # http://localhost:3000
```

Node ≥ 22 (voir `.nvmrc`), pnpm 11.

## Commandes

| Commande | Rôle |
|---|---|
| `pnpm dev` | serveur de développement avec rechargement |
| `pnpm build` | build client + serveur Nitro dans `.output/` |
| `pnpm start` | sert le build en Node |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `pnpm format` | Biome (lint + format en un seul outil) |
| `pnpm test` | Vitest |
| `pnpm vuln` | `pnpm audit` — échoue sur tout avis non trié |
| `pnpm check` | typecheck + lint + test + vuln + build |

`pnpm check` vert signifie une CI verte, à une garde près : la CI vérifie en plus que
`src/routeTree.gen.ts` est à jour après build.

## Où sont les choses

```
src/routes/      les écrans (routage par fichiers)
src/server/      le BFF : session, permissions, audit, proxy Admin, hub WebSocket
src/components/  primitives et composants partagés
src/styles/      tokens de la charte graphique
docs/            spécification technique et plan d'exécution
tasks-todo/      steps à faire · tasks-done/ steps livrées
```

`src/server/` est la seule moitié du dépôt qui connaît le jeton de l'API Admin, les certificats mTLS
et la base : le navigateur ne parle jamais directement à la passerelle.

## Contrat d'API

Le dépôt ne copie aucun schéma : il consomme le package versionné
`@martialanouman/gateway-api-contracts`, publié depuis `go-gateway`. Un endpoint manquant se corrige
par une PR **là-bas**, jamais par un contournement ici.

En développement, le mock Prism sert le contrat sans dépendre de la passerelle — ce qui est
nécessaire, une partie des opérations n'étant pas encore implémentée en amont.

## Dépendances

Chaque dépendance est une dette : préférer la bibliothèque déjà présente. Avant tout ajout, vérifier
la version et l'API à jour via `ctx7`, puis lancer `pnpm vuln`.

Deux protections sont actives et **ne doivent pas être désarmées par confort** :

- **Scripts d'installation refusés par défaut.** Un paquet qui en a besoin s'autorise nommément dans
  `allowBuilds` (`pnpm-workspace.yaml`), avec sa justification.
- **Quarantaine des versions fraîchement publiées.** Ne pas exempter un paquet pour installer une
  version sortie il y a quelques heures — c'est le scénario que la quarantaine couvre.

### Avis `pnpm audit` triés

`pnpm vuln` échoue sur tout avis non listé dans `auditConfig.ignoreGhsas`. Un avis n'y entre qu'avec
son raisonnement d'exposition écrit.

| Avis | Verdict |
|---|---|
| [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) — `brace-expansion <=5.0.7`, DoS par expansion non bornée | **Accepté.** Chaîne `@tanstack/nitro-v2-vite-plugin > nitropack > archiver > minimatch`. `archiver` empaquette les artefacts des presets qui zippent (lambda, azure) ; le nôtre est `node-server`. `brace-expansion` n'y traite que nos propres globs, au build : aucune entrée non fiable ne l'atteint. Le correctif amont (2.x → 5.x sous un `minimatch` v3) est plus risqué que la faille. À revoir à chaque bump de Nitro. |

## Contribuer

Une **step = une PR**. Prendre le prochain fichier de `tasks-todo/` (l'ordre de `INDEX.md` fait foi),
l'implémenter avec ses tests, puis déplacer le fichier dans `tasks-done/` en dernier commit.

Les portes de qualité tournent en jobs parallèles (`typecheck`, `lint`, `test`, `vuln`, `build`).
La protection de branche doit exiger le seul check **`CI`** : il agrège les cinq et reste valable
quand une porte s'ajoute — lister les jobs nommément se périmerait au premier ajout.
Les conventions, invariants et la Definition of Done sont dans [`CLAUDE.md`](./CLAUDE.md) ; le cadre
et l'ordre dans [`docs/plan-execution-tableau-de-bord.md`](./docs/plan-execution-tableau-de-bord.md).
