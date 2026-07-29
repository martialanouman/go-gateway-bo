# Tableau de bord Admin — Passerelle SMS

Cockpit d'exploitation interne de la passerelle SMS : clients, comptes SMPP, connecteurs, routage,
conformité, facturation. Application **TanStack Start** (React + TypeScript), servie par un process
Node auto-hébergé qui joue aussi le rôle de **BFF** vers l'API Admin de la passerelle.

## Démarrer

```bash
# Une fois par poste. Les contrats viennent de GitHub Packages, qui exige une authentification même
# en lecture. Le jeton du CLI `gh` suffit ; le credential va dans la config utilisateur et non dans
# le dépôt — pnpm refuse d'expanser une variable dans un `.npmrc` commité, voir `.npmrc`.
gh auth refresh --hostname github.com -s read:packages
pnpm config set "//npm.pkg.github.com/:_authToken" "$(gh auth token)"

pnpm install
cp .env.example .env      # GATEWAY_MODE=mock suffit pour développer
docker compose up -d      # PostgreSQL 18 + Redis
pnpm db:migrate           # applique les migrations
pnpm mock                 # Prism sert le contrat sur :4010 — dans un autre terminal
pnpm dev                  # http://localhost:3000
```

Node ≥ 24 (`.nvmrc` fait foi — la CI y lit sa version), pnpm 11.

Un `pnpm install` qui échoue en **401 ou 403 sur `npm.pkg.github.com`** a toujours l'une de ces deux
causes : le jeton local n'a pas le scope `read:packages`, ou le package n'accorde pas la lecture à ce
dépôt. La réponse n'est jamais d'ajouter un PAT en secret — voir « Contrat d'API ».

## Commandes

| Commande | Rôle |
|---|---|
| `pnpm dev` | serveur de développement avec rechargement |
| `pnpm build` | build client + serveur Nitro dans `.output/` |
| `pnpm start` | sert le build en Node |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `pnpm format` | Biome (lint + format en un seul outil) |
| `pnpm test` | Vitest — la boucle rapide, sans dépendance externe |
| `pnpm test:db` | Vitest sur un PostgreSQL 18 éphémère (Testcontainers) — **Docker requis** |
| `pnpm db:migrate` | applique les migrations |
| `pnpm db:generate` | génère une migration depuis le schéma Drizzle |
| `pnpm db:studio` | explorateur de schéma Drizzle |
| `pnpm mock` | Prism sert le contrat sur `:4010` |
| `pnpm vuln` | `pnpm audit` — échoue sur tout avis non trié |
| `pnpm coverage` | les deux projets Vitest en une passe, avec les seuils de couverture |
| `pnpm e2e` | Playwright contre le build de production — **Docker non requis, navigateur oui** |
| `pnpm check` | typecheck + lint + coverage + vuln + build |

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
et la base : le navigateur ne parle jamais directement à la passerelle. Une règle Biome **et** un
test (`src/test/frontiere-serveur.test.ts`, qui suit les imports de proche en proche) refusent qu'un
fichier client l'atteigne, même par un intermédiaire.

## Base de données

Le BFF possède **neuf tables et rien d'autre** : opérateurs, catalogue de permissions, rôles et leurs
liaisons, journal d'audit, règles d'alerte, notifications, vues sauvegardées. Clients, comptes SMPP,
connecteurs, CDR et soldes appartiennent à la passerelle et se lisent à travers l'API Admin **à chaque
affichage** — les recopier ici créerait une seconde vérité qui divergerait en silence, et un cockpit
qui montre un état périmé est pire qu'un cockpit en panne : il inspire confiance.

Les identifiants sont des **UUIDv7 générés par PostgreSQL 18**, qui expose `uuidv7()` en fonction
native — un seul mécanisme, côté base, sans extension.

`audit_log` est **partitionnée par mois** : détacher un mois pour l'archivage est instantané, là où un
`DELETE` massif réécrirait la table. Drizzle ne sait pas déclarer cela, donc la mécanique
(partitions, partition par défaut, fonction de maintenance sous verrou consultatif) vit dans
`drizzle/0001_audit_log_partitions.sql`, écrite à la main. `pnpm db:migrate` repousse l'horizon de
trois mois à chaque déploiement.

`pnpm db:migrate` est une **étape de déploiement, à lancer une fois** — pas une étape de démarrage
d'instance. Le migrator de Drizzle lit son journal puis applique dans une transaction, sans verrou :
deux instances qui démarreraient ensemble sur une base vierge exécuteraient la même migration en
parallèle et échoueraient sur un type déjà existant.

Il n'y a **volontairement pas** de script `drizzle-kit push` : il applique un diff sans laisser de
trace, ce qui rendrait l'état de la production indéductible de l'historique — et détruirait le
partitionnement d'`audit_log`.

## Tests

Une pyramide, et l'ordre des étages est délibéré :

- **Unitaires** (`pnpm test`) — la boucle de travail. Quelques centaines de millisecondes, aucune
  dépendance externe. C'est là que vivent la logique du BFF, les permissions et les mappings.
- **Base de données** (`pnpm test:db`) — un PostgreSQL 18 éphémère par Testcontainers, pour ce
  qu'aucun mock ne peut prouver : que le SQL écrit à la main fait ce qu'il annonce.
- **Bout en bout** (`pnpm e2e`) — Playwright contre `pnpm build && pnpm start`, donc contre ce qui
  sera réellement servi. Il couvre des **parcours**, jamais des cas limites : une suite e2e qu'on
  n'ose plus croire est pire qu'une suite absente.

`pnpm coverage` exécute les projets `unit` et `db` **en une passe**. C'est la seule mesure qui
reflète la réalité : le code qui touche la base est exercé par le second, et le mesurer sur le
premier seul le déclarerait mort. Les seuils sont dans `vitest.config.ts` — 85 % de lignes sur le
dépôt, et **par fichier** sous `src/server/`, là où vivent les gardes et l'audit. Un seuil agrégé y
serait décoratif : un nouveau module de permissions à 40 % passerait derrière un client à 95 %.

### L'invariant (a), outillé

`src/test/invariants.ts` fournit l'oracle qui vérifie qu'un corps de message ne sort jamais de
l'onglet qui l'affiche — ni log, ni URL, ni erreur, ni trace. Il est **branché sur les chemins déjà
livrés** (traduction d'erreur, client Admin, URL sortantes), pas seulement sur des cas fabriqués :
un oracle qui ne testerait que lui-même donnerait l'illusion d'une garde pendant les jalons où il
n'y en aurait aucune.

Sa limite est écrite dans le module : il reconnaît une chaîne, donc il voit la troncature, le
découpage en segments et les encodages (base64, hexadécimal, pourcentage, `\uXXXX`), mais **il est
aveugle à un corps haché ou chiffré**. La garde réelle n'est pas ce scan : c'est que rien ne recopie
de texte libre venu de la passerelle.

## Contrat d'API

Le dépôt ne copie aucun schéma : il consomme le package versionné
`@martialanouman/gateway-api-contracts`, publié depuis `go-gateway`. Un endpoint manquant se corrige
par une PR **là-bas**, jamais par un contournement ici.

En développement, le mock Prism sert le contrat sans dépendre de la passerelle — ce qui est
nécessaire, une partie des opérations n'étant pas encore implémentée en amont. `GATEWAY_MODE`
tranche : `mock` parle à Prism (`pnpm mock`), `live` à la vraie passerelle, avec OAuth2
`client_credentials` et mTLS. Le réglage n'a pas de valeur par défaut, dans un sens comme dans
l'autre : servir des données inventées en les croyant vraies est aussi grave que l'inverse.

Le client typé vit sous `src/server/gateway/` et **nulle part ailleurs** — voir « Où sont les choses »
pour la façon dont l'invariant (d) est tenu. Le jeton obtenu est un jeton
**machine** à scopes fixes, qui porte `content:read` en permanence : il ne représente pas l'opérateur
connecté, et aucune restriction par opérateur ne peut donc être déléguée à la passerelle
(invariant c).

### Accès au registre

Le package est publié sur GitHub Packages, qui exige une authentification même en lecture.

- **En local**, le jeton du CLI `gh` avec le scope `read:packages`, posé dans la config *utilisateur*
  (voir « Démarrer »). Le `.npmrc` du dépôt ne contient que la redirection de scope : pnpm refuse —
  à raison — d'expanser une variable d'environnement dans un credential venant d'un fichier commité,
  puisque ce fichier suit le dépôt jusque dans ses forks.
- **En CI**, le `GITHUB_TOKEN` du run, auquel le package accorde la lecture (*Package settings →
  Manage Actions access → `go-gateway-bo`*). Aucun PAT stocké en secret : un secret long-vécu expire
  un matin sans prévenir et se révoque mal. Le workflow accorde `packages: read`.

## Dépendances

Chaque dépendance est une dette : préférer la bibliothèque déjà présente. Avant tout ajout, vérifier
la version et l'API à jour via `ctx7`, puis lancer `pnpm vuln`.

Trois protections sont actives et **ne doivent pas être désarmées par confort** :

- **Scripts d'installation refusés par défaut.** Un paquet qui en a besoin s'autorise nommément dans
  `allowBuilds` (`pnpm-workspace.yaml`), avec sa justification.
- **Actions GitHub épinglées sur un condensat de commit**, la version en commentaire de fin de ligne.
  Un tag est mutable : quiconque obtient le droit de le déplacer sur un dépôt d'action exécute son
  code dans notre CI, avec nos jetons. Ne pas revenir à `@v7` par confort de relecture — c'est
  Dependabot qui fait avancer ces condensats, en un lot hebdomadaire relisible
  (`.github/dependabot.yml`), et le commentaire qui les garde lisibles. Dependabot ne couvre
  **délibérément pas** `npm` : il ouvrirait des PR que la quarantaine ci-dessous existe pour empêcher.
- **Quarantaine des versions fraîchement publiées.** `minimumReleaseAge: 1440` : une version publiée
  il y a moins de 24 h ne s'installe pas, et `minimumReleaseAgeStrict` fait échouer la résolution
  plutôt que de la contourner en silence. Ce n'est pas un défaut de pnpm — retirer ces deux lignes
  supprime la protection entièrement. Ne pas exempter un paquet dans `minimumReleaseAgeExclude` pour
  installer une version sortie il y a quelques heures : c'est le scénario même que la quarantaine
  couvre. Seule exception, un correctif de sécurité qui ne peut pas attendre.

### Avis `pnpm audit` triés

`pnpm vuln` échoue sur tout avis non listé dans `auditConfig.ignoreGhsas`. Un avis n'y entre qu'avec
son raisonnement d'exposition écrit — **et seulement après avoir vérifié qu'il n'est pas corrigeable**.
Un avis qu'un `overrides` résout n'a rien à faire dans cette liste : c'est ce qui a été fait pour les
cinq avis apportés par Prism et drizzle-kit (`lodash` et `uuid` sous `postman-collection`, `esbuild`
sous `@esbuild-kit/core-utils`), corrigés par trois entrées ciblées de `overrides` dans
`pnpm-workspace.yaml` plutôt qu'ignorés.

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
