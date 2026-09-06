# Tableau de bord Admin — Passerelle SMS

Cockpit d'exploitation interne de la passerelle SMS : clients, comptes SMPP, connecteurs, routage,
conformité, facturation. **Un binaire Go** qui embarque une **SPA React** et joue le rôle de **BFF**
vers l'API Admin de la passerelle.

Outil interne, 100 à 300 opérateurs, thème sombre, desktop-first. Ce n'est **pas** un portail
client : les clients n'ont aucun accès à la plateforme.

## Où en est le dépôt

**Dix-neuf des quatre-vingts steps sont livrées** au 06/09/2026. Ce paragraphe est un repère, pas
une source : `tasks/todo.md` fait foi, et se lit en trente secondes.

Ce qui tourne — le socle des deux toolchains, le schéma PostgreSQL et ses migrations, le catalogue
de permissions et **toute l'authentification côté serveur** : mot de passe argon2id,
anti-brute-force partagé entre instances, session scellée, TOTP, passkeys, garde de permission et
journal d'audit. Les routes livrées sont celles que déclare `api/openapi-bff.yaml`.

Ce qui n'existe pas encore — **aucun écran métier**. Le client est la coquille peinte au chargement
à froid, un accueil qui affiche l'état vide de sa propre absence, et la page de charte servie sur
`/_design` ; les écrans de connexion arrivent en step-027.
`/ws` est monté mais refuse, faute de hub (step-043). Un `make dev` donne donc un BFF qui sait
authentifier et un client qui ne le lui demande pas encore.

## Démarrer

L'authentification à GitHub Packages vient **en premier** : sans elle, l'installation des contrats
échoue sur un 401 qui ne se nomme pas.

```bash
# Une fois par poste. Le jeton du CLI `gh` suffit, et le credential va dans la configuration
# utilisateur — pnpm refuse, à raison, d'expanser une variable dans un `.npmrc` commité.
gh auth refresh --hostname github.com -s read:packages
pnpm config set "//npm.pkg.github.com/:_authToken" "$(gh auth token)"

pnpm -C web install
cp .env.example .env       # puis remplir — le fichier documente chaque variable
docker compose up -d       # PostgreSQL 18 + Redis
make migrate               # applique les migrations
make bootstrap             # sème permissions et rôles ; crée le compte propriétaire
make mock                  # Prism sert le contrat Admin sur :4010, autre terminal
make dev                   # BFF (:3001) + Vite (:3000) — l'application est sur :3000
```

Go et Node sont requis **en développement** (versions dans `go.mod` et `.nvmrc`). En production, ni
l'un ni l'autre : le binaire embarque les assets et se suffit à lui-même.

Un `pnpm install` qui échoue en **401 ou 403 sur `npm.pkg.github.com`** a l'une de deux causes : le
jeton local n'a pas le scope `read:packages`, ou le package n'accorde pas la lecture à ce dépôt. La
réponse n'est jamais d'ajouter un PAT en secret — voir « Contrat d'API ».

### Configuration

`.env.example` **fait foi** : il liste exactement les variables que lit `internal/config` — un test
le tient — et documente chacune, ce qu'elle coûte à changer et ce qu'elle exige des autres
instances. Trois secrets n'ont **aucune valeur par défaut** et n'en auront jamais : une clé codée en
dur serait publique. Ce qu'une rotation coûte diffère largement de l'un à l'autre, et le fichier le
dit variable par variable — le lire **avant** d'en changer une.

Le serveur refuse de démarrer si une variable obligatoire manque, en la nommant. Un démarrage réussi
suivi d'une erreur à la première requête laissait croire que l'installation était bonne.

**Les bases sont vivantes** : sans PostgreSQL joignable et migré, le binaire refuse de lier son
port — il compare la version du schéma d'abord — et toute porte qui le lance échoue avec lui.

## Commandes

`make help` **fait foi** — la lancer plutôt que croire une liste. Trois cibles ne se devinent pas :

- **`make check`** enchaîne les portes de la CI. **Obligatoire avant toute PR**, et il ne suffit
  pas : `pr-title`, CodeQL, `code_quality` et le `--frozen-lockfile` de la CI n'y sont pas, et
  `govulncheck`, `pnpm audit` et `go test -race` peuvent y répondre autrement qu'en CI.
- **`make build`** produit le déployable : le client est copié dans `internal/webassets/dist/` puis
  embarqué. `make build-go` compile sans reconstruire le client.
- **`make e2e`** lance les parcours Playwright **contre le binaire**, jamais contre `make dev` :
  c'est le seul endroit qui exerce l'embarquement des assets et l'ordre du repli SPA. Hors de
  `make check`, et exige un PostgreSQL migré.

## Où sont les choses

`ls internal/` donne le livré du jour, et chaque paquet porte sa doc — `go doc ./internal/...`.
L'essentiel tient en une ligne : **`internal/` est le seul endroit qui connaît les secrets, le jeton
Admin et la base**, et le langage interdit qu'un module extérieur l'importe. Le navigateur ne parle
qu'au BFF ; le BFF parle à l'API Admin et à son propre petit schéma PostgreSQL, distinct de celui de
la passerelle.

```
cmd/            les quatre binaires : dashboard, migrate, bootstrap, permissionsgen
internal/       le BFF
api/            openapi-bff.yaml — engendre les types serveur Go et client TS
web/            le client React (règles propres dans web/CLAUDE.md)
docs/           la spécification technique
tasks/          plan.md · todo.md · steps/
```

## Contrat d'API

Le dépôt ne copie aucun schéma : il consomme `@martialanouman/gateway-api-contracts`, publié depuis
`go-gateway`. Un endpoint manquant se corrige par une PR **là-bas**, jamais par un contournement
ici. `oapi-codegen` en tire le client Go ; un second contrat, `api/openapi-bff.yaml`, décrit la
frontière entre les deux moitiés de ce dépôt et engendre **les types Go et TypeScript des deux
bouts** — une divergence ne compile pas.

Le mock Prism sert ce contrat sans dépendre de la passerelle, ce qui est **nécessaire** : une large
part des opérations n'existe encore qu'au contrat, côté passerelle — décompte à jour dans
`tasks/plan.md` §16. `DASHBOARD_GATEWAY_MODE` tranche entre le mock et la vraie passerelle, et **son
absence vaut `real`** : la lecture la plus stricte, qui exige tout le matériel OAuth2 et mTLS. Le
défaut inverse aurait servi des données inventées sans que rien ne le dise.

Le jeton obtenu est un jeton **machine** à scopes fixes : il ne représente pas l'opérateur connecté,
et aucune restriction par opérateur ne peut donc être déléguée à la passerelle.

### Accès au registre

GitHub Packages exige une authentification même en lecture. **En local**, le jeton du CLI `gh` avec
le scope `read:packages` (voir « Démarrer »). **En CI**, le `GITHUB_TOKEN` du run, auquel le package
accorde la lecture — *Package settings → Manage Actions access → `go-gateway-bo`*. Aucun PAT stocké
en secret : un secret long-vécu expire un matin sans prévenir et se révoque mal.

## Contribuer

**Une step = une PR.** Prendre le prochain fichier de `tasks/steps/` — **l'ordre de
[`tasks/todo.md`](./tasks/todo.md) fait foi**, pas le numéro —, l'implémenter en BDD strict,
**scénario rouge d'abord**, puis déplacer le fichier dans `tasks/steps/done/` en dernier commit.

Les portes de qualité tournent en jobs parallèles : une erreur de compilation Go et un test client
rouge se voient au même run. La protection de branche exige le seul check **`CI`**, qui les agrège —
en contrepartie, un job absent de son `needs:` le laisserait vert, et cette liste se tient dans
`.github/workflows/ci.yml`, à côté des jobs.

Les invariants, les conventions et la Definition of Done sont dans [`CLAUDE.md`](./CLAUDE.md) ; les
règles propres au client dans [`web/CLAUDE.md`](./web/CLAUDE.md) ; le cadre et l'ordre dans
[`tasks/plan.md`](./tasks/plan.md) ; le quoi et le pourquoi dans
[`docs/specification-technique-tableau-de-bord.md`](./docs/specification-technique-tableau-de-bord.md).
