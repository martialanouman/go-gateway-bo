# Tableau de bord Admin — Passerelle SMS

Cockpit d'exploitation interne de la passerelle SMS : clients, comptes SMPP, connecteurs, routage,
conformité, facturation. **Un binaire Go** qui embarque une **SPA React** et joue le rôle de **BFF**
vers l'API Admin de la passerelle.

> ## ⚠️ Dépôt remis à neuf
>
> Le dépôt bascule d'un socle TanStack Start vers un **BFF Go + SPA React**, décidé le 01/08/2026 et
> amendé dans la spécification (§1.3, §4, §7). **Tout le code a été supprimé** — le BFF TypeScript,
> le client React de la v1.0, et les trois premières steps Go d'une première tentative.
>
> **Ce qui reste** : la spécification, le plan (`tasks/plan.md`), le découpage en 75 steps
> (`tasks/todo.md`), les fichiers de step de M0, la charte graphique, et l'échafaudage de projet
> (accès au registre, protections de dépendances, `docker-compose.yml`). Aucune ligne d'application.
>
> **Ce README décrit la cible.** Les commandes qui n'existent pas encore y sont signalées `(cible)` ;
> le reste du document décrit l'état visé, pas l'état livré. Depuis step-002, `make build` produit le
> **déployable** : le client est copié dans `internal/webassets/dist/` puis embarqué, et le binaire
> sert la SPA seul, sans Node. Depuis step-001, les deux moitiés
> tournent : `make dev` lance le BFF et Vite, et la CI a ses portes client. Depuis step-000, le
> socle Go existe : `make dev/build/check` et les portes granulaires tournent.
> La première tentative a payé six défauts d'outillage, tous invisibles en local : ils
> sont inscrits dans les steps qui les rencontrent (`tasks/plan.md` §2.1), et la leçon transverse est
> qu'un vert local ne dit rien des workflows — **pousser tôt vaut mieux que relire**.

## Démarrer

```bash
# Une fois par poste. Les contrats viennent de GitHub Packages, qui exige une authentification même
# en lecture. Le jeton du CLI `gh` suffit ; le credential va dans la config utilisateur et non dans
# le dépôt — pnpm refuse d'expanser une variable dans un `.npmrc` commité, voir `.npmrc`.
gh auth refresh --hostname github.com -s read:packages
pnpm config set "//npm.pkg.github.com/:_authToken" "$(gh auth token)"

pnpm -C web install
cp .env.example .env       # puis remplir les secrets — voir plus bas
docker compose up -d       # PostgreSQL 18 + Redis
make migrate               # applique les migrations                        (cible, step-005)
make bootstrap             # sème les permissions et crée le premier compte (cible)
make mock                  # Prism sert le contrat sur :4010, autre terminal
make dev                   # BFF (:3001) + Vite (:3000) — l'application est sur :3000
```

Les lignes marquées `(cible)` arrivent avec leur step et rendent `No rule to make target` d'ici là —
jamais un vert silencieux.

Go et Node sont tous deux requis **en développement**. En production, ni l'un ni l'autre : le binaire
embarque les assets et se suffit à lui-même.

### Des secrets sans valeur par défaut

La signature de session, le sel d'anti-brute-force et le chiffrement des secrets TOTP n'ont **aucun
repli**, et c'est délibéré — une clé codée en dur serait publique, donc n'importe qui signerait une
session. `openssl rand -base64 48` fait le travail.

Contrairement à la v1.0, **le serveur refuse de démarrer** si une variable obligatoire manque, en la
nommant (step-000). Un démarrage réussi suivi d'une erreur à la première requête d'authentification
laissait croire que l'installation était bonne.

La clé qui chiffre les secrets TOTP au repos mérite une attention à part : **la perdre rend illisibles
tous les seconds facteurs**, codes de récupération compris.

### Le premier compte s'obtient par `make bootstrap`

C'est la **seule** façon d'entrer dans une installation neuve — les comptes suivants se créent depuis
l'écran de gestion des opérateurs, sous une permission et avec un audit. La commande lit ses valeurs
dans l'environnement et non en arguments, qu'un `ps aux` afficherait, puis refuse de s'exécuter à
nouveau dès qu'un opérateur existe.

Un `pnpm install` qui échoue en **401 ou 403 sur `npm.pkg.github.com`** a toujours l'une de ces deux
causes : le jeton local n'a pas le scope `read:packages`, ou le package n'accorde pas la lecture à ce
dépôt. La réponse n'est jamais d'ajouter un PAT en secret — voir « Contrat d'API ».

## Commandes

```bash
make dev        # BFF Go (:3001) + Vite (:3000), /api et /ws proxifiés vers le BFF
make build      # le déployable : client → internal/webassets/dist/ → go build → bin/dashboard
make build-go   # go build seul, sans reconstruire le client — la cible du job « Build Go », sans pnpm
make build-web  # vite build → web/dist
make check      # toutes les portes de la CI — OBLIGATOIRE avant toute PR
make help       # liste les cibles qui existent — c'est la cible par défaut
make clean      # supprime bin/, web/dist et les assets copiés dans internal/webassets/dist/
make generate   # client Go de l'API Admin depuis le contrat installé
                # les types TS et le catalogue de permissions s'y ajouteront (steps 004 et 006)
make mock       # Prism sur openapi-admin.yaml, sur :4010
make migrate    # migrations de la base                               (cible, step-005)

make test-go           # unitaires Go + scénarios godog, avec -race
make lint-go           # golangci-lint · make fmt-go applique le formatage
make vuln-go           # govulncheck
make lint-workflows    # actionlint, et l'agrégateur CI attend-il tous les jobs ?
make typecheck-web     # tsc --noEmit
make test-web          # Vitest
make lint-web          # Biome
make vuln-web          # pnpm audit
make check-routes      # l'arbre de routes commité est-il à jour et régénéré ?
make check-generated   # le client Go de l'API Admin commité est-il à jour et régénéré ?
make test / make lint  # les composites des deux toolchains
# `pnpm -C web e2e` — cible, arrive avec le harnais Playwright de step-007
```

Les linters passent par `go tool` et sont épinglés dans `go.mod` : rien à installer
sur un clone frais, et un scanner qui change sous les pieds ne rend pas un run
non reproductible.

`make check` enchaîne les portes que la CI lance en **jobs parallèles** — il n'y a donc pas d'ordre à
égaler. Deux raisons distinctes font qu'un vert local ne garantit pas une PR verte.

**Ce que `make check` ne rejoue pas du tout** : `pr-title.yml`, les deux règles du ruleset de `main` —
**CodeQL** et **code_quality** — qui bloquent une PR sans passer par le check `CI`, le
`pnpm install --frozen-lockfile` de la CI, qu'un `node_modules` désynchronisé du lockfile masque en
local, et le contrôle qui lance le binaire produit par `make build` pour comparer ce qu'il sert à la
sortie de Vite — il lie un port, que `make dev` occupe déjà sur un poste, donc il reste au job « Build
client et déployable ».

**Ce qu'il rejoue sans que le verdict soit le même** : `govulncheck` et `pnpm audit`, qui interrogent
des bases vivantes et peuvent changer d'avis sans qu'un fichier bouge ; et `go test -race`, qui tourne
ici sur darwin/arm64 et là-bas sur linux/amd64.

### Deux processus en développement, un seul en production

`make dev` lance le BFF Go et le serveur Vite côte à côte ; Vite proxifie `/api` et `/ws` vers le Go.
Il surveille les deux : si l'un s'arrête, l'autre est terminé et la commande sort en erreur — un Vite
qui survit au BFF servirait un proxy sans destination.
Ce n'est pas un compromis mais le point : le développement emprunte **le même chemin** que la
production, à ceci près que les assets viennent de Vite au lieu du binaire. La seule chose que `dev`
ne rejoue pas est l'embarquement des assets et l'ordre du fallback SPA — d'où les tests de bout en
bout qui tournent **contre le binaire**, jamais contre `dev`.

## Où sont les choses

```
cmd/dashboard/     le binaire : câblage, embed.FS des assets, arrêt propre
internal/          le BFF — seul endroit qui connaît secrets, jeton Admin et base
  bff/             handlers HTTP, gardes de permission, écriture d'audit
  config/          configuration validée au démarrage
  auth/            session, argon2id, TOTP, WebAuthn
  gateway/         client généré vers l'API Admin (OAuth2 + mTLS)
  hub/             hub WebSocket : 3 flux amont → 1 socket par opérateur
  alerting/        évaluateur métier à offset persisté
  store/           pgx, requêtes, migrations
  permissions/     LE catalogue — source unique, génère le TypeScript
api/               openapi-bff.yaml — engendre les types Go et TS
web/               le client React (src/routes, src/components, src/lib, src/styles)
docs/              la spécification technique
tasks/             plan.md · todo.md · steps/
```

**`internal/` porte l'invariant (d) par construction** : le langage interdit qu'un module extérieur
l'importe. Là où la v1.0 posait une règle de lint désactivable, il y a désormais une erreur de
compilation. Le risque résiduel n'est plus un import mais une **URL de l'API Admin codée en dur** dans
le client — un test la cherche dans le bundle.

## Base de données

Le BFF est propriétaire d'un petit schéma PostgreSQL : opérateurs, rôles et permissions, sessions,
journal d'audit, règles d'alerte, notifications, vues sauvegardées. **Il ne lit jamais la base de la
passerelle** : tout ce qui vient d'elle passe par l'API Admin.

`audit_log` est partitionné par mois. La création des partitions et leur **détachement** sont deux
responsabilités distinctes : la première est posée par step-005, la seconde appartient à step-187 —
partitionner sans jamais détacher n'apporte rien.

## Tests — BDD

Le comportement s'écrit en **Gherkin français** avant d'exister, il échoue, puis on l'implémente.

- **Scénarios `godog`** — le comportement observable du BFF. Le `.feature` vit à côté du package qu'il
  décrit. Ils tapent le **mock Prism**, jamais la vraie passerelle : le harnais le lance lui-même sur
  un port libre, et **échoue** — jamais ne se saute — si le contrat ou Prism manquent. Un
  `export PRISM_MOCK_BASE_URL=http://127.0.0.1:4010` leur fait réutiliser le mock de `make mock` au
  lieu d'en démarrer un à chaque lancement.
- **Unitaires Go** — les mécanismes aux limites : hachage, curseurs, mappings, sérialisation des DTO.
  La majorité des tests, en nombre.
- **Composants (Vitest + Testing Library)** — états, permissions, clavier, copie.
- **Bout en bout (Playwright)** — cinq parcours seulement, **contre le binaire**.

Le mode d'échec est nommé dans `tasks/plan.md` §17 : un scénario par critère d'acceptation fabrique la
suite qu'on n'ose plus croire, et Gherkin l'aggrave parce que ça se lit bien.

### Les invariants, outillés

L'invariant (a) — le corps d'un message ne fuit nulle part — tient par **construction** : une réponse
HTTP est un struct Go déclaré, et un champ absent du struct ne peut pas être émis. Un test refuse
`map[string]any` et l'embedding de struct dans un type de réponse ; un scan transversal vérifie
qu'aucun autre chemin (log, URL, export, cache, trace) ne le contourne.

## Contrat d'API

Le dépôt ne copie aucun schéma : il consomme le package versionné
`@martialanouman/gateway-api-contracts`, publié depuis `go-gateway`. Un endpoint manquant se corrige
par une PR **là-bas**, jamais par un contournement ici.

`oapi-codegen` en tire le client Go vers la passerelle. Un second contrat, `api/openapi-bff.yaml`,
décrit la frontière entre les deux moitiés de ce dépôt et engendre **les types serveur Go et les types
client TypeScript**. Un contrat, deux bouts typés, une divergence qui ne compile pas.

En développement, le mock Prism sert le contrat sans dépendre de la passerelle — ce qui est
nécessaire, **62 des 133 opérations n'étant pas encore implémentées en amont**. Le mode tranche entre
Prism et la vraie passerelle, et **n'a pas de valeur par défaut**, dans un sens comme dans l'autre :
servir des données inventées en les croyant vraies est aussi grave que l'inverse.

Le jeton obtenu est un jeton **machine** à scopes fixes, qui porte `content:read` en permanence : il ne
représente pas l'opérateur connecté, et aucune restriction par opérateur ne peut donc être déléguée à
la passerelle (invariant c).

### Accès au registre

Le package est publié sur GitHub Packages, qui exige une authentification même en lecture.

- **En local**, le jeton du CLI `gh` avec le scope `read:packages`, posé dans la config *utilisateur*
  (voir « Démarrer »). Le `.npmrc` du dépôt ne contient que la redirection de scope : pnpm refuse — à
  raison — d'expanser une variable d'environnement dans un credential venant d'un fichier commité,
  puisque ce fichier suit le dépôt jusque dans ses forks.
- **En CI**, le `GITHUB_TOKEN` du run, auquel le package accorde la lecture (*Package settings →
  Manage Actions access → `go-gateway-bo`*). Aucun PAT stocké en secret : un secret long-vécu expire un
  matin sans prévenir et se révoque mal. Chaque job qui passe par `.github/actions/setup` accorde
  `packages: read` chez lui — les quatre portes client, « Tests Go » et « Build client et
  déployable » —, faute de quoi `pnpm install` échoue en 401 sur le registre.

## Dépendances

Chaque dépendance est une dette : préférer ce qui est déjà présent, et **la bibliothèque standard avant
tout**. Avant tout ajout, vérifier version et API à jour — `ctx7` côté JS, `pkg.go.dev` ou
`proxy.golang.org` côté Go. Jamais de version devinée : une signature inventée compile parfois.

**Côté Go** : `govulncheck` dans `make check`, et les CVE connues d'un candidat se vérifient **avant**
adoption, pas après.

**Côté client**, trois protections sont actives et **ne doivent pas être désarmées par confort** :

- **Scripts d'installation refusés par défaut.** Un paquet qui en a besoin s'autorise nommément dans
  `allowBuilds`, avec sa justification.
- **Actions GitHub épinglées sur un condensat de commit**, la version en commentaire de fin de ligne.
  Un tag est mutable : quiconque obtient le droit de le déplacer sur un dépôt d'action exécute son code
  dans notre CI, avec nos jetons. Ne pas revenir à `@v7` par confort de relecture — c'est Dependabot
  qui fait avancer ces condensats, en un lot hebdomadaire relisible.
- **Quarantaine des versions fraîchement publiées.** `minimumReleaseAge: 1440` : une version publiée il
  y a moins de 24 h ne s'installe pas, et `minimumReleaseAgeStrict` fait échouer la résolution plutôt
  que de la contourner en silence. Retirer ces deux lignes supprime la protection entièrement. Ne pas
  exempter un paquet pour installer une version sortie il y a quelques heures : c'est le scénario même
  que la quarantaine couvre. Seule exception, un correctif de sécurité qui ne peut pas attendre.

Un avis d'audit n'entre dans la liste des exceptions qu'avec son raisonnement d'exposition écrit — **et
seulement après avoir vérifié qu'il n'est pas corrigeable**. Un avis qu'un `overrides` résout n'a rien
à faire dans cette liste.

## Contribuer

Une **step = une PR**. Prendre le prochain fichier de `tasks/steps/` — **l'ordre de
[`tasks/todo.md`](./tasks/todo.md) fait foi**, pas le numéro —, l'implémenter en **BDD strict,
scénario rouge d'abord**, puis déplacer le fichier dans `tasks/steps/done/` en dernier commit.

Les portes de qualité tournent en **jobs parallèles** — cinq portes Go, cinq portes client, dont la
dernière a aussi la toolchain Go et construit le **déployable**. Deux jobs ont les deux toolchains :
celui-là, et « Tests Go », dont les scénarios lancent le mock Prism sur le contrat installé. Une porte
qui échoue n'empêche pas les autres de rendre leur verdict : on voit une erreur de compilation Go *et*
un test client rouge au même run. La protection de branche
exige le seul check **`CI`**, qui les agrège et reste valable quand une porte s'ajoute — mais en
contrepartie, un job absent du `needs:` de l'agrégateur le laisserait vert : la liste se tient dans
`ci.yml`, à côté des jobs.

Les conventions, invariants et la Definition of Done sont dans [`CLAUDE.md`](./CLAUDE.md) ; le cadre et
l'ordre dans [`tasks/plan.md`](./tasks/plan.md) ; le quoi et le pourquoi dans
[`docs/specification-technique-tableau-de-bord.md`](./docs/specification-technique-tableau-de-bord.md).
