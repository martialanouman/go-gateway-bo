# Plan d'exécution — Tableau de bord Admin (BFF Go + SPA React)

**Composant :** Tableau de bord Admin / Exploitation — binaire Go unique embarquant une SPA React
**Statut :** Plan d'exécution v2.0 — réécrit le 01/08/2026 pour la bascule Go
**Méthode :** fondations, puis tranche verticale prouvée, puis un écran à la fois — mock-first.
**Document compagnon :** `../docs/specification-technique-tableau-de-bord.md` (le quoi et le pourquoi ;
ce document est le comment et dans quel ordre).
**Découpage en PRs :** `todo.md` (l'ordre fait foi) + `steps/step-NNN.md`.

> Chaque jalon (`M0`…`M9`) précise : **Objectif**, **Dépend de**, **Livrables**, **Nouvelles
> dépendances**, **Hors périmètre** et **Critères d'acceptation** (des tests, pas des opinions). Pas
> d'estimation en jours : on pilote à l'acceptation. Les **conventions transverses (§1)** fixent une
> fois pour toutes les points récurrents — les jalons y renvoient au lieu de les redéfinir.

---

## 0. Pourquoi ce plan est réécrit

La v1.0 exécutait la spec sur TanStack Start. Elle a livré 17 steps avant que l'arbitrage ne soit
refait, le 01/08/2026, et amendé dans la spec (§1.3, §4, §7).

**Ce que la mesure a montré, et qui a décidé.** Le dépôt n'utilisait aucune primitive serveur du
framework : zéro `createServerFn`, zéro `createMiddleware`, zéro server route. Le BFF était déjà
composé de handlers HTTP nus, déclarés hors du routage par fichiers — parce qu'une server route
aurait dû importer `src/server/` depuis `src/routes/`, ce que la règle de lint de l'invariant (d)
interdit. **Le framework avait été défait de l'intérieur, délibérément et pour une bonne raison.**

Le rendu serveur, lui, ne servait personne : la console est intégralement derrière un login, §1.2
n'énonce aucun budget de premier affichage, et la garde de session avait dû quitter `beforeLoad`
faute de pouvoir s'exécuter à l'hydratation.

Et la charge réelle du composant n'est pas de rendre des pages. C'est de **tenir des sockets** (trois
flux amont agrégés en une socket descendante par opérateur, §4.2) et d'**évaluer des règles en tâche
de fond** (offset persisté, §6.8). Deux choses qu'un modèle requête/réponse ne modélise pas, et que
des goroutines à cycle de vie explicite modélisent directement.

> **Ce plan n'est pas une table rase du code.** Le client React — coquille, écrans, primitives,
> tokens de la charte — est **porté**, pas réécrit : la cible *est* React + TanStack Router + Query
> + Base UI. Ce qui est réécrit, c'est le BFF. Voir §2.

### 0.1 La boucle par step

Une step = **une session ciblée = une PR petite et verte**. Le détail de la boucle, la règle
d'arbitrage et la **Definition of Done** vivent dans `CLAUDE.md` — **c'est le seul exemplaire**. Elle
a été recopiée dans trois documents par le passé, et deux copies ont continué à prescrire une règle
que la troisième avait retirée.

### 0.2 Règle d'or du séquencement

On prouve la **tranche verticale** (§3) le plus tôt possible, puis chaque jalon ajoute une surface
sans casser les précédentes. Une surface non encore implémentée est une **route déclarée qui rend un
état vide explicite** (§1.9) — jamais une page blanche, jamais une entrée de menu qui ne mène nulle
part.

### 0.3 Les 5 invariants (tests bloquants, verts à vie)

**(a)** le corps d'un message ne s'affiche jamais sans `content:read`, chaque affichage est audité, et
il n'apparaît dans aucune trace, log, URL ni export — **structurellement garanti par les DTO de
sortie** (§1.11), posé à `M0`, gagné à `M5` ;
**(b)** aucun secret d'identifiant n'est jamais réaffiché — `M3` ;
**(c)** l'autorisation est appliquée côté serveur, le rendu UI n'est jamais la garde — `M1` ;
**(d)** le navigateur ne parle jamais directement à l'API Admin — `M0` ;
**(e)** le tableau de bord n'est jamais sur le chemin critique du plan de données — `M2`, revérifié à `M9`.

---

## 1. Conventions transverses (à fixer AVANT M0)

Ces choix sont fixés une fois ; tous les jalons s'y conforment.

### 1.1 Dépôt, langages, layout

Deux moitiés, un seul déployable. Le layout est celui d'un projet Go qui embarque un client web.

```
cmd/dashboard/          le binaire : câblage, embed.FS des assets, arrêt propre
internal/
  bff/                  handlers HTTP, gardes de permission, écriture d'audit
  config/           configuration validée au démarrage
  auth/                 session, argon2id, TOTP, WebAuthn
  gateway/              client généré vers l'API Admin (OAuth2 + mTLS)
  hub/                  hub WebSocket : 3 flux amont → 1 socket par opérateur
  alerting/             évaluateur métier à offset persisté
  store/                pgx + requêtes typées + migrations
  permissions/          LE catalogue — source unique, génère le TypeScript
api/openapi-bff.yaml    le contrat du BFF : engendre les types Go et TS
web/                    le client React
  src/routes/ src/components/ src/lib/ src/styles/
docs/                   la spécification technique
tasks/                  plan.md · todo.md · steps/
```

- **Go :** version figée dans `go.mod` et dans la CI.
- **Node :** ≥ 22 LTS pour la moitié client, figé dans `.nvmrc`. **Gestionnaire :** `pnpm`. Lockfile
  commité.
- **TypeScript :** `strict`, plus `noUncheckedIndexedAccess` et `verbatimModuleSyntax`.
- **Tout ce qui touche un secret, la base ou l'API Admin vit sous `internal/`** — et `internal/` est
  inatteignable depuis l'extérieur du module par construction du langage. L'invariant (d) cesse
  d'être une règle de lint pour devenir une propriété du compilateur.

### 1.2 Bibliothèques imposées

Aucune autre bibliothèque pour ces rôles sans décision d'équipe.

**Moitié Go** — versions relevées sur `proxy.golang.org` le 01/08/2026 :

| Rôle | Bibliothèque | Version |
|---|---|---|
| Routeur HTTP | `go-chi/chi/v5` | v5.3.1 |
| WebSocket | `coder/websocket` | v1.8.15 |
| PostgreSQL | `jackc/pgx/v5` | v5.10.0 |
| Génération OpenAPI | `oapi-codegen/oapi-codegen/v2` | v2.8.0 |
| WebAuthn | `go-webauthn/webauthn` | v0.17.4 |
| TOTP | `pquerna/otp` | v1.5.0 |
| Redis Pub/Sub | `redis/go-redis/v9` | v9.21.0 |
| Hachage | `golang.org/x/crypto/argon2` | — |
| Assets embarqués | `embed` (stdlib) | — |
| BDD (scénarios Gherkin) | `cucumber/godog` | v0.16.0 |
| Assertions | `stretchr/testify` | v1.11.1 |

**Moitié client** — versions installées, à revérifier via `ctx7` à chaque bump :

| Rôle | Bibliothèque | Version |
|---|---|---|
| Socle | `react` / `react-dom` | 19.2.8 |
| Bundler | `vite` | 8.1.5 |
| Routage | `@tanstack/react-router` + `@tanstack/router-plugin` | 1.170.x |
| État serveur | `@tanstack/react-query` | 5.101.4 |
| Primitives UI | `@base-ui/react` | 1.6.0 |
| Client HTTP typé | `openapi-fetch` | 0.17.0 |
| Contrat | `@martialanouman/gateway-api-contracts` | **2.5.0** |
| Mock d'API | `@stoplight/prism-cli` | 5.16.0 |
| Tests | `vitest` + `@playwright/test` | 4.1.10 / 1.62.0 |
| Langage | `typescript` | 7.0.2 |
| Lint + format | `@biomejs/biome` | 2.5.5 |

**Non encore installées** — graphiques, virtualisation, éditeur. La version se relève via `ctx7`
**au moment de l'ajout**, jamais ici : ce tableau serait périmé avant d'être lu.

> **Règle d'or outillage.** Côté JS, `ctx7` avant tout ajout ou bump. Côté Go, `proxy.golang.org` ou
> `pkg.go.dev`. **Ne jamais deviner un numéro de version ni une signature** — elles changent entre
> majeures, et une signature inventée compile parfois.

Pas de framework CSS utilitaire : les tokens de la charte et le CSS de composant suffisent.

### 1.3 La frontière BFF ⟷ client

C'est la convention la plus structurante du dépôt, et elle change de nature avec Go.

- Le client parle **uniquement** aux routes du BFF. Jamais à l'API Admin (**invariant d**).
- Le jeton machine (OAuth2 client_credentials), le certificat mTLS et la connexion PostgreSQL vivent
  sous `internal/` — **le langage interdit de les importer depuis ailleurs**. Là où la v1.0 posait
  une règle de lint désactivable, la v2.0 a une erreur de compilation.
- Conséquence à garder en tête : le jeton du BFF porte `content:read` en permanence. **Seul le BFF**
  peut restreindre la lecture d'un corps par opérateur — d'où l'invariant (c) et le test
  d'énumération des routes.

### 1.4 Modèle d'erreur & codes

- L'API Admin renvoie une enveloppe plate `{ code, message, errors[] }`. Le BFF la **traduit en
  erreur typée** et la **réexpose dans la même forme** à son propre client : une seule forme d'erreur
  dans tout le produit.
- `code` est un contrat partagé avec la passerelle : ne jamais le réinventer côté tableau de bord.
- `errors[]` alimente les erreurs champ par champ des formulaires. Un formulaire qui affiche un
  message global alors que `errors[]` est renseigné est un défaut.
- Cinq états de contenu (§1.9) ≠ erreurs : « module désactivé » et « aucun résultat » ne passent
  jamais par le chemin d'erreur.
- **`ServiceUnavailable` n'est pas `ModuleDisabled`.** Le contrat 2.x a introduit une réponse
  *« une dépendance est injoignable ou a expiré ; réessayer quand elle se rétablit »*. C'est une
  **erreur** — donc `ErrorState`, avec Réessayer. Un module éteint est une **absence de
  fonctionnalité** — donc `ModuleDisabled`, et jamais une erreur (règle d'or). Les confondre
  afficherait « réessayez » sur quelque chose qui ne reviendra pas, ou masquerait une panne réelle
  derrière une dégradation propre. Le mapping les sépare explicitement (step-003, step-160).

### 1.5 Conventions de données

- **UUIDv7** partout, cohérent avec la plateforme.
- **Pagination par curseur** partout où le contrat l'impose. Aucune UI « page 4 sur 120 ».
- **Crédits = entiers**, jamais une devise formatée.
- Dates en ISO 8601 UTC sur le fil ; affichage localisé en français, fuseau affiché quand il compte.
- Les identifiants techniques ne se traduisent **jamais** et se rendent en mono, verbatim du payload :
  `link_status`, `breaker_state`, `max_sessions`, `balance_scope`, `half_open`, `query_sm`.

### 1.6 Conventions temps réel

- **Une seule socket** par opérateur, multiplexée par sujet : `metrics.traffic`, `metrics.connectors`,
  `sessions.events`, `notifications`, `billing.alerts`.
- Enveloppe figée : `{ topic, ts, data }`. Le client envoie `{"action":"subscribe","topics":[...]}` au
  montage et `unsubscribe` au démontage.
- Côté passerelle, **trois flux distincts** consommés **une seule fois** par l'instance porteuse du
  bail, republiés en Redis Pub/Sub, rediffusés par chaque instance (§4.1 de la spec).
- **Instantané REST au chargement, puis flux.** Le point pulsant ne s'affiche qu'en direct ; au-delà
  de la tolérance de 2–5 s, l'écran bascule en « données périmées » — il n'invente jamais une valeur.
- Redis Pub/Sub est **au mieux une fois** : acceptable pour de l'affichage, jamais pour une détection.
- **Une goroutine par socket cliente, une par flux amont, un `context` qui les relie.** Toute
  goroutine du hub doit se terminer sur annulation du contexte — un test de fuite le vérifie.

### 1.7 Langue & copie

- Copie d'interface en **français**, troisième personne, **conséquence d'abord**.
- **Le code est en anglais** : identifiants Go et TypeScript, noms de packages, de types, de champs et
  de fonctions. Le narratif — commentaires, scénarios BDD, copie produit — est en **français**.
- « Sécurisé » n'est jamais une promesse : on dit ce que la protection couvre et où s'arrête la
  frontière d'accès.
- **Commentaires avec parcimonie.** Un commentaire ne redit jamais ce que le code dit déjà. Il ne
  subsiste que là où le code ne peut pas parler : un **pourquoi** contre-intuitif, un arbitrage dont
  l'alternative évidente est fausse, une contrainte externe invérifiable sur place. Partout ailleurs,
  la réponse est un meilleur nom ou une fonction extraite.

  > Mesuré le 01/08/2026 sur la v1.0 : **38 % du BFF était du commentaire** (3 448 lignes sur 8 912),
  > 29 % côté composants. Une part portait un vrai « pourquoi » et se relit avec profit ; le reste
  > paraphrasait la ligne suivante, et **le critère 2 de la DoD existe précisément parce que certains
  > de ces commentaires mentaient** sur le code qu'ils surplombaient. Moins de commentaires, c'est
  > moins de prose à maintenir en cohérence avec l'implémentation.
- Casse phrase pour libellés, titres et boutons ; micro-labels en capitales ; les pilules de statut
  gardent le `snake_case` de l'API.

### 1.8 Configuration & secrets

- Toute la configuration par variables d'environnement, validée **au démarrage** — échec bruyant, pas
  de valeur par défaut silencieuse en production.
- `.env.example` documenté et à jour ; `.env` jamais commité.
- Secrets requis : identifiants OAuth2 de l'API Admin, certificat mTLS, secret de signature de
  session, secret du webhook Alertmanager, DSN PostgreSQL, URL Redis.
- Aucun secret ne traverse la frontière §1.3, n'entre dans un log, un toast, une URL ou un audit.

### 1.9 Convention « surface non encore livrée »

Une route déclarée mais non implémentée rend un **état vide explicite** nommant le jalon prévu, et son
entrée de navigation est visible. Jamais une page blanche, jamais un lien mort, jamais un écran
inventé. Les cinq états : `Loading` (squelette de la vraie mise en page) · `Empty` (rien encore +
comment créer) · `NoResults` (filtres trop étroits + comment élargir) · `ModuleDisabled` (dégradation
propre, **jamais** une erreur) · `ErrorState` (réalité HTTP + « vos données locales restent
affichées » + Réessayer).

**Nouveau avec la SPA** : le **chargement à froid** est un sixième moment, pas un sixième état. Le
document servi doit peindre le squelette de la coquille avant que React démarre. Sans ça, coller une
URL ouvre sur un `<body>` vide — ce que le contrat à cinq états n'autorise nulle part. C'est une
exigence de la step-001, pas un réglage de confort.

### 1.10 Le catalogue de permissions est un contrat — et il traverse deux langages

Les ~44 clés sont **fixes**, versionnées avec les releases, non éditables par un admin. Les rôles sont
des paquets éditables de ces clés.

**La source unique est `internal/permissions/`, en Go.** Le TypeScript consommé par le client en est
**généré**, et un test de la CI échoue si le fichier généré diverge de sa source. C'est le seul
mécanisme qui tienne : la v1.0 avait un module TypeScript partagé par les deux moitiés, et cette
commodité disparaît quand le serveur change de langage. Une divergence silencieuse entre le catalogue
serveur et le catalogue client afficherait des contrôles que le serveur refuse — exactement le défaut
que la charte interdit.

Ajouter une permission se fait toujours à trois endroits **dans la même PR** : le catalogue Go, la
garde serveur qui l'exige, et le tableau des rôles par défaut (§6.10 de la spec).

### 1.11 Tout handler déclare son DTO de sortie

**C'est la convention qui porte l'invariant (a).** Une réponse HTTP est un struct Go déclaré, jamais
une `map[string]any`, jamais un type de domaine marshalé directement. Un champ absent du struct **ne
peut pas** être émis.

Conséquences :
- Le corps d'un message n'a de champ que dans le seul DTO de l'écran qui l'affiche.
- La règle est vérifiable mécaniquement : un test refuse `map[string]any` et l'embedding de struct
  dans un type de réponse.
- Ce qui était une discipline à tenir sur 133 endpoints devient une propriété que le compilateur et
  un test unique garantissent.

---

### 1.12 Le contrat bouge pendant le développement — le suivre est une tâche, pas un réflexe

`@martialanouman/gateway-api-contracts` est publié à chaque merge sur `main` de `go-gateway` touchant
`api/**`. Dix versions en une semaine (1.0.0 → **2.5.0**), dont une **majeure**. Ce dépôt en est
consommateur, pas propriétaire : il subit le rythme d'un autre.

**La règle.** Relever la version disponible **au début de chaque step qui touche le contrat**, et
consigner l'écart dans la PR. Ne jamais bumper au milieu d'une step : un changement de contrat au
milieu d'une implémentation rend indiscernables les échecs dus au code et ceux dus au contrat.

**Un bump se traite comme du travail**, avec sa propre étape : régénérer, laisser la compilation
montrer les ruptures des deux côtés, corriger, et **relire le diff du YAML** — parce que tout ne casse
pas la compilation. Une contrainte de validation resserrée (`additionalProperties: false`, un
`maximum`, un `enum` réduit) passe le typage et échoue à l'exécution.

> **Ce que la 2.x a réellement changé**, relevé le 01/08/2026 en comparant les deux YAML :
> les **133 opérations sont identiques** — aucune ajoutée, aucune retirée. La majeure porte sur les
> formes :
> - `idempotency_key` (uuid) devient **obligatoire** sur la recharge et le transfert de crédits ;
> - `direction` y est restreinte à `enum: [mt]` — ce qui **aligne enfin le contrat sur la spec**, dont
>   le §6.11 dit depuis le début que le MO est un compteur et non un solde ;
> - `additionalProperties: false` sur les corps de requête : tout champ superflu est rejeté ;
> - un plafond `maximum: 1000000000` sur `credits` ;
> - les réponses **401, 403, 404, 409, 422** sont désormais déclarées par opération ;
> - le schéma **`ServiceUnavailable`** apparaît (voir §1.4).
>
> Aucun de ces points n'aurait été vu en lisant seulement le numéro de version, et quatre sur six ne
> font pas échouer la compilation.

---

## 2. Ce qui est porté, ce qui est réécrit

La bascule ne détruit pas le travail de la v1.0. Elle en garde la moitié qui ne dépendait pas de la
pile serveur.

| Existant | Volume | Sort |
|---|---|---|
| `src/components/` — primitives, coquille, cinq états | ~4 000 lignes | **Porté** vers `web/src/` |
| `src/routes/*.tsx` — écrans livrés | ~2 300 lignes | **Porté**, rebranché sur le BFF Go |
| `src/styles/` — tokens de la charte v1.0 | ~2 200 lignes | **Porté** tel quel |
| `src/server/` — le BFF et ses tests | ~18 000 lignes | **Réécrit** en Go |
| `src/lib/permissions.ts` | 351 lignes | **Devient généré** depuis `internal/permissions/` |
| `__root.tsx`, `vite.config.ts`, entrée Start | ~150 lignes | **Remplacés** |

**« Porté » ne veut pas dire « acquis ».** Un écran porté n'est vert que quand il tourne contre son
handler Go, avec ses tests de composant et le parcours de bout en bout qui le traverse. C'est pourquoi
la progression repart à zéro : **rien n'est livré tant que ce n'est pas vert sur la nouvelle pile**,
y compris ce qui n'a pas changé d'une ligne.

Le portage n'est jamais une step à lui seul, sauf pour les fondations d'interface (M0, M2) qui n'ont
pas de moitié serveur. Partout ailleurs il est **la moitié client d'une tranche verticale** : le
handler Go et l'écran qui le consomme arrivent dans la même step.

---

## 3. La tranche verticale de référence

Le tableau de bord n'a pas de « squelette » au sens d'un pipeline : sa tranche verticale, c'est la
chaîne complète navigateur → BFF → contrat → passerelle, avec autorisation et audit.

```
Login + MFA ──► session BFF ──► /auth/me (permissions résolues)
                                      │
                                      ▼
                            AppShell + écran Clients
                                      │
                       RequirePermission("customers:write")
                                      │
                                      ▼
              client Go typé (OAuth2 + mTLS) ──► Admin API ──► audit_log
```

**Elle est acquise à la fin de `M3`, step-061** : un opérateur se connecte, franchit le MFA, voit
l'écran Clients rendu selon ses permissions, crée un client, et l'action laisse une ligne d'audit.
À partir de là, chaque écran suivant n'est plus qu'une répétition du même trajet.

> **Pourquoi les clients et pas les groupes** : `list-customers` / `create-customer` /
> `suspend-customer` sont **déjà implémentées** côté passerelle, alors que `list-customer-groups` ne
> l'est pas encore (§15). La tranche verticale doit être prouvée contre la **vraie** passerelle, pas
> seulement contre le mock.

---

## 4. Vue d'ensemble des jalons

| Jalon | Objectif | Débloque |
|---|---|---|
| **M0** | Fondations : binaire Go, SPA, deux contrats, base, double toolchain | tout |
| **M1** | Authentification, MFA, permissions, audit | toute écriture |
| **M2** | Coquille applicative + temps réel (hub WS, HA) | tous les écrans |
| **M3** | Clients, comptes SMPP, identifiants | **la tranche verticale prouvée** |
| **M4** | Exploitation : trafic, connecteurs, sessions | le cockpit d'incident |
| **M5** | CDR Explorer, trace, corps gardé, export | l'investigation |
| **M6** | Routage : routes, numéros exacts, scripts Monaco | le composant distinctif |
| **M7** | Conformité : opt-out, numéros entrants, anti-spam | l'exploitation conforme |
| **M8** | Facturation, contenu, RGPD | la monétisation et l'effacement |
| **M9** | Alerting, audit, accessibilité, déploiement HA | la mise en production |

---

## 5. M0 — Fondations & double toolchain

**Objectif :** un dépôt qui compile des deux côtés, se teste, démarre ses dépendances, parle aux deux
contrats, et produit **un binaire qui sert la SPA**.
**Dépend de :** —
**Steps :** 000 → 008

**Livrables**
- Module Go, `cmd/dashboard`, routeur chi, configuration validée au démarrage (§1.8), arrêt propre.
- SPA Vite + TanStack Router, portage de `web/`, **squelette de coquille peint au chargement à froid**
  (§1.9), et le fallback SPA **ordonné après `/api`** — un `/api/*` inconnu rend 404, jamais du HTML.
- `embed.FS` : `go build` produit un binaire autonome qui sert l'application.
- Client Admin Go généré par `oapi-codegen` sur `openapi-admin.yaml`, OAuth2 client_credentials avec
  jeton mis en cache, mTLS, traduction de l'enveloppe d'erreur (§1.4). Mock Prism et bascule
  réel/mock par environnement.
- `api/openapi-bff.yaml` : le contrat du BFF, engendrant les types serveur Go **et** les types client
  TypeScript. Un seul contrat, deux bouts typés.
- PostgreSQL 18 + `pgx`, les six tables du §3.1, migrations commitées, `audit_log` partitionné par
  mois, `docker-compose.yml` (PostgreSQL + Redis).
- `internal/permissions/` : le catalogue Go, la génération du TypeScript, et le test de divergence.
- Tokens de la charte portés + page `/_design`, polices auto-hébergées.
- Harnais **BDD** : `godog` + `testify` + testcontainers côté Go, Vitest + Testing Library et
  Playwright côté client ; CI à **deux toolchains** ; le test de DTO qui portera l'**invariant (a)**
  (§1.11). Un premier `.feature` en français traverse le harnais de bout en bout — sans quoi on ne
  saurait pas qu'il tourne.

**Nouvelles dépendances :** toutes celles du §1.2 sauf WebAuthn, TOTP, Redis, graphiques, Monaco.

**Hors périmètre :** aucun écran métier, aucune authentification, aucun WebSocket.

**Critères d'acceptation**
- Poste neuf : `docker compose up`, migrations, `make dev` suffisent — et la procédure est écrite.
- `go build` produit un binaire qui sert l'application **sans Node installé**.
- Un appel typé (`list-customers`) réussit contre le mock **et** contre la passerelle réelle.
- Un `GET /api/inconnu` rend **404**, pas l'`index.html` — vérifié sur le binaire, pas en dev.
- Coller une URL profonde peint le squelette de la coquille, jamais un blanc.
- Modifier le catalogue Go sans régénérer le TypeScript **fait rougir la CI**.
- Un handler qui rend une `map[string]any` fait rougir le test de DTO.
- `/_design` rend la charte complète ; contraste AA vérifié automatiquement.

### Checkpoint M0
- [ ] Les deux suites passent, le binaire démarre, la CI est verte sur les deux toolchains.
- [ ] Les invariants (a) et (d) ont chacun leur test **et il a été muté**.

---

## 6. M1 — Authentification, permissions & audit

**Objectif :** savoir qui est connecté, ce qu'il a le droit de faire, et garder trace de ce qu'il fait.
**Dépend de :** M0 — et, pour ses quatre dernières steps, `041`, `042` et `040` de M2 (voir §14).
**Steps :** 020 → 029

**Livrables**
- Catalogue des ~44 permissions et les **neuf rôles par défaut** du §6.10, seedés et idempotents.
- Login email/mot de passe (**argon2id**), anti-brute-force partagé entre instances, session BFF
  signée, `/auth/me` renvoyant l'union des permissions.
- MFA **TOTP** (anti-rejeu, codes de récupération) et **WebAuthn/passkey** (`rpID`/`origin` vérifiés
  côté serveur, compteur de signature).
- `RequirePermission(key)` en middleware chi + écriture systématique d'`audit_log` + **MFA
  obligatoire** pour les rôles privilégiés.
- Écrans Login, MFA, enrôlement du second facteur, administration des opérateurs et des rôles —
  **portés** et rebranchés sur les handlers Go.

**Nouvelles dépendances :** `go-webauthn/webauthn`, `pquerna/otp`, `golang.org/x/crypto/argon2`.

> **Argon2id et non scrypt.** La v1.0 avait retenu `node:crypto.scrypt` pour éviter une dépendance
> native sous Node. En Go, `golang.org/x/crypto/argon2` est du Go pur : la contrainte
> d'approvisionnement qui avait décidé disparaît, et le motif recommandé redevient accessible.

**Hors périmètre :** l'écran de consultation du journal d'audit (M9) ; l'authentification de la
passerelle elle-même (côté `go-gateway`, voir §15).

**Critères d'acceptation**
- Table de vérité des neuf rôles vérifiée, **y compris les exclusions** : `ops` sans
  `suppressions:delete`, `script_author` sans `scripts:publish`, `support_readonly` sans
  `content:read`, `account_manager` sans `billing:topup`.
- **Invariant (c)** : le test d'énumération des routes échoue si une route de mutation n'a ni garde de
  permission ni écriture d'audit. Il lit le routeur comme une **valeur**, jamais le texte source.
- Une session non-MFA ne peut atteindre aucune écriture ni `content:read`.
- Aucun secret ni corps ne se retrouve dans `audit_log` (payload piégé).
- Le premier administrateur peut **entrer** : installation → login → enrôlement → console, sans
  impasse.
- Parcours de bout en bout login → MFA (TOTP et passkey) → console.

### Checkpoint M1
- [ ] Retirer une garde de permission au hasard fait rougir la suite. **Vérifié, pas supposé.**
- [ ] Le parcours de bout en bout tourne contre le binaire, sans rien de simulé dans le produit.

---

## 7. M2 — Coquille applicative & temps réel

**Objectif :** la coquille dans laquelle tous les écrans se branchent, et le temps réel qui les
alimente — en topologie multi-instance.
**Dépend de :** la moitié serveur de M1 (`020 → 026`), pas M1 entier — voir §14.
**Steps :** 040 → 047

**Livrables**
- `AppShell` porté (rail groupé, barre supérieure, pile de toasts), arborescence complète de routes en
  états vides explicites (§1.9), `Page` et `Toolbar`, `usePermission` / `PermissionGate`.
- Primitives Base UI portées et habillées par les tokens, plus les **cinq états de contenu**.
- Hub WebSocket Go : les trois flux amont agrégés en une socket multiplexée, filtrage d'abonnement par
  permission, **files bornées par client**, une goroutine par socket, arrêt sur annulation de contexte.
- **HA** : bail Redis, un seul consommateur amont, republication Pub/Sub, rediffusion par instance,
  bascule automatique.
- Client WS React (`useTopic`, comptage de références, reconnexion, `isLive`/`isStale`) et centre de
  notifications persisté.
- Arrêt propre : drain des sockets, déploiement roulant sans session perdue.

**Nouvelles dépendances :** `coder/websocket`, `redis/go-redis/v9`.

**Hors périmètre :** les widgets de trafic (M4) ; l'évaluateur d'alertes (M9).

**Critères d'acceptation**
- Deux instances : un seul consommateur amont ; tuer le porteur du bail bascule sans trou perceptible ;
  un client de l'instance B reçoit ce que consomme l'instance A.
- Un sujet non autorisé par les permissions est refusé à l'abonnement.
- **Invariant (e)** : la chute d'un flux amont dégrade l'affichage (état périmé, horodatage) sans
  vider l'écran ni faire tomber les autres sujets.
- Un client lent voit ses messages jetés ; la mémoire du serveur reste bornée.
- **Aucune goroutine ne fuit** : un test de fuite ferme 500 sockets et vérifie le retour à l'état
  initial.
- Chaque route déclarée rend un état explicite : aucune page blanche.

### Checkpoint M2
- [ ] Scénario deux instances rejoué en CI, pas seulement en local.
- [ ] Le squelette de chargement à froid tient toujours après l'ajout de l'AppShell.

---

## 8. M3 — Clients, comptes SMPP & identifiants

**Objectif :** prouver la tranche verticale (§3) et livrer le socle du domaine à deux niveaux.
**Dépend de :** M2 · **Steps :** 060 → 066

**Livrables** — groupes de clients (CRUD, filtre transverse), clients (liste, filtres, création, fiche,
suspension **en cascade** chiffrée, sender IDs), comptes SMPP (canaux, politique de sender ID,
bascules `query_sm`/`cancel_sm`, webhooks, quotas, `max_sessions` avec **badge d'écart**), identifiants
(**exactement deux cartes** masquées, secret montré **une seule fois**, rotation avec fenêtre de grâce,
révocation avec impact chiffré, diagnostic d'échec de bind).

**Hors périmètre :** déconnexion forcée des sessions (M4) ; facturation du client (M8).

**Critères d'acceptation**
- **La tranche verticale passe contre la passerelle réelle** (§3), pas seulement contre le mock.
- **Invariant (b)** : le secret apparaît exactement une fois ; après fermeture de la modale il est
  introuvable dans le DOM, l'état, le cache Query et les logs. Aucune action « révéler » n'existe.
  **Le DTO de rotation est le seul à porter le champ** — et un test le vérifie.
- Suspendre un client affiche l'impact chiffré avant confirmation et le propage aux comptes.
- Baisser `max_sessions` sous le nombre de binds vivants avertit, n'est pas bloqué, affiche le badge
  d'écart, et la copie dit que les binds vivants ne sont **pas** coupés.

---

## 9. M4 — Exploitation temps réel

**Objectif :** le cockpit qu'on ouvre pendant un incident.
**Dépend de :** M2 (temps réel), M3 (comptes) · **Steps :** 080 → 086

**Livrables** — trafic (instantané REST, widgets, graphiques conformes à la charte §07, flux WS,
bascule de plage 5 min WS / 1 h / 24 h REST, ventilations, drill-down CDR), connecteurs (CRUD à
divulgation progressive, pool de binds, politique de reconnexion, santé **par bind** avec
`link_status` et `breaker_state` **séparés**, rebind), sessions (table virtualisée, mises à jour en
**deltas**, réconciliation périodique, déconnexion forcée nommée et auditée).

**Nouvelles dépendances :** bibliothèque de graphiques et virtualisation — **version relevée à
l'ajout**, §1.2.

**Critères d'acceptation**
- Un connecteur dont certains binds sont `up` et d'autres `down` s'affiche correctement : aucun état
  unique inventé, aucun indicateur fusionné.
- `link_status: up` + `breaker_state: open` se rend comme un état normal, pas comme une contradiction.
- En plage 1 h ou 24 h, aucun abonnement WS n'est actif ; en 5 min, le point pulsant apparaît.
- Un événement de session met à jour la table **sans refetch global** ; un delta manqué est rattrapé
  par la réconciliation.
- La ventilation par groupe égale la somme des comptes membres.

---

## 10. M5 — CDR Explorer & trace

**Objectif :** l'outil d'investigation — et l'écran où l'invariant (a) se gagne.
**Dépend de :** M4 (drill-down), M1 (permissions) · **Steps :** 100 → 104

**Livrables** — recherche filtrable, **pagination par curseur**, table virtualisée, vues sauvegardées,
URL partageable ; fiche message **composée côté BFF** ; visualiseur de trace en cascade de spans ;
corps gardé par `content:read`, audité, avec quatre états explicites (non stocké / expiré / effacé /
non autorisé) et la mention « lecture journalisée » **avant** le clic ; export CSV asynchrone gouverné.

**Critères d'acceptation**
- **Invariant (a)**, test bloquant : le corps n'apparaît dans aucun log, URL, message d'erreur, cache
  persisté, export CSV ni attribut de trace — y compris sur un payload amont piégé. **Le DTO de la
  fiche message est le seul à porter le champ**, et le retirer casse l'écran plutôt que de le laisser
  fuir ailleurs.
- Sans `content:read` : état « non autorisé » et **aucun appel réseau** au contenu.
- Avec : le corps s'affiche et **exactement une** ligne d'audit `content.read` est écrite.
- Pagination par curseur stable sur un jeu qui s'enrichit ; aucune UI de numéro de page.
- L'export tronqué **le dit** ; le lien expire.

---

## 11. M6 — Routage & scripts

**Objectif :** le composant distinctif (§8 de la spec).
**Dépend de :** M4 (connecteurs) · **Steps :** 120 → 126

**Livrables** — routes (table par priorité, réordonnancement souris **et clavier**, éditeur, testeur de
regex), simulateur avec **bandeau de précédence** (numéro exact > script > déclaratif), numéros exacts
(CRUD **par MSISDN**, lookup, import MNP en masse), Monaco chargé paresseusement avec contrat
`resolveRoute`, versions, publication séparée de l'écriture, retour arrière, santé par script, règles
de réécriture de sender ID aux quatre portées.

**Hors périmètre :** l'exécution de script côté navigateur — elle a lieu dans le bac à sable de la
passerelle, jamais ici.

**Critères d'acceptation**
- Le bandeau de précédence apparaît dans les trois cas et énonce que la conformité continue de
  s'appliquer.
- `script_author` ne peut pas publier, et l'écran explique pourquoi.
- Publier sur une portée déjà pourvue nomme le script remplacé et applique l'unicité.
- Le réordonnancement est faisable **au clavier**.
- Monaco n'est pas chargé sur les autres écrans — **et le chunk survit à un déploiement roulant**
  (§17).

---

## 12. M7 — Conformité

**Objectif :** rendre l'opt-out lisible, diagnosticable, et sa levée difficile.
**Dépend de :** M1 (permissions), M3 (comptes) · **Steps :** 140 → 146

**Livrables** — suppressions (liste **scopée par canal** avec origine, création, import en masse,
mots-clés par pays), outil « pourquoi ce message a-t-il été bloqué ? » renvoyant **la portée
décideuse**, levée derrière `suppressions:delete`, numéros entrants (collisions STOP/START/HELP
signalées), file MO non routés groupée par cause, anti-spam (CRUD, test, file de revue, réputation).

**Critères d'acceptation**
- Un opérateur `ops` ne peut pas lever une suppression et **voit pourquoi** ; `compliance` le peut.
- La vérification renvoie toujours la portée décideuse, jamais un booléen nu.
- **Invariant (a)** : aucun corps de MO dans la file des non routés, même si l'amont en renvoie un.
- L'import rend un compte-rendu ligne à ligne ; aucune donnée de conformité ingérée en silence.

---

## 13. M8 — Facturation, contenu & RGPD

**Objectif :** monétisation lisible et effacement prouvable.
**Dépend de :** M3 (clients), M5 (corps et états de contenu) · **Steps :** 160 → 166
**⚠️ Dépendance externe forte :** voir §15.

**Livrables** — proxy fin sans état avec dégradation `ModuleDisabled` propre ; **deux cartes
distinctes** (solde MT qui bloque à zéro, compteur MO qui monte et ne bloque rien) ; recharge,
transfert, changement de portée **visible mais inerte** à solde non nul ; plans tarifaires et
fournisseurs (secrets masqués) ; politique de contenu avec **valeur effective** pour `inherit` ;
crypto-shred ; effacement RGPD **avec choix de cible**, job asynchrone, attestation, **opt-out
conservé**.

**Critères d'acceptation**
- Module désactivé → aucune erreur, aucun toast, un état dédié.
- Solde MT et compteur MO rendus comme deux objets sémantiquement différents.
- Après crypto-shred, l'onglet Corps affiche **« effacé »**, pas « non stocké ».
- Cible MSISDN : l'opt-out subsiste après effacement ; l'attestation n'est disponible qu'après
  achèvement réel du job.
- `account_manager` ne peut pas recharger ; le changement de portée reste inerte à solde non nul.

---

## 14. M9 — Alerting, audit & mise en production

**Objectif :** rendre l'outil exploitable en continu et le mettre en production sans SPOF.
**Dépend de :** tous les jalons précédents · **Steps :** 180 → 187

**Livrables** — `alert_rules` avec `evaluation_owner` **dérivé de la métrique, affiché et expliqué** ;
webhook Alertmanager entrant (mTLS ou secret partagé, isolé, idempotent) ; évaluateur Go des métriques
métier sur **source durable à offset persisté**, un seul évaluateur actif, lag exposé ; écran de
consultation du journal d'audit ; rétention (partitions détachées, sessions purgées) ; audit WCAG
2.1 AA et cinq parcours de bout en bout ; image de production, déploiement ≥2 instances avec affinité
WS, sondes, arrêt propre, **CSP à nonce par requête**, runbook.

**⚠️ step-183 (réconciliation Alertmanager) est bloquée** : aucune surface Alertmanager au contrat.

**Critères d'acceptation**
- Redémarrage de l'évaluateur au milieu d'un lot : les transitions manquées sont **rejouées**, aucune
  perdue ; une bascule ne produit ni trou ni tempête de doublons.
- Double livraison du même événement Alertmanager → une seule notification.
- Déploiement roulant à deux instances : **aucune session perdue**, reprise WS transparente, **et un
  onglet ouvert avant le déploiement charge encore ses chunks paresseux** (§17).
- **Le nonce CSP est bien par requête** : deux chargements successifs de l'`index.html` portent deux
  nonces différents. C'est le BFF qui sert le document, donc il peut l'injecter — un shell statique ne
  le pourrait pas.
- Aucune violation AA bloquante sur les cinq parcours.
- **Invariant (e)** réaffirmé dans le runbook.

---

## 15. Graphe de dépendances & parallélisation

```
M0 ─► M1 ⇄ M2 ─► M3 ─┬─► M4 ─► M5 ─┐
                     │             ├─► M9
                     ├─► M6 ───────┤
                     ├─► M7 ───────┤
                     └─► M8 ───────┘
```

`M3` est le point de bascule : avant, on outille et on prouve la chaîne ; après, chaque jalon ajoute
des écrans qui ne se marchent pas dessus.

**`M1` et `M2` s'imbriquent, ils ne se suivent pas** — d'où le `⇄`. La moitié serveur de `M1`
(020 → 026 : auth, MFA, permissions, audit, DTO) ne dépend de rien de `M2` et vient d'abord. Mais ses
quatre dernières steps sont des **écrans** : ils reposent sur les primitives (041), les cinq états
(042) et la coquille (040).

```
020…026  ─►  041 ─► 042 ─► 040  ─►  027 ─► 028 ─► 029  ─►  043…047  ─► M3
└ M1 serveur ┘   └─── M2 interface ───┘   └─ M1 écrans ─┘   └ M2 temps réel ┘
```

**Ce qui peut avancer en parallèle une fois `M3` acquis :** `M6`, `M7` et `M8` touchent des écrans,
des permissions et des endpoints **disjoints**. `M4` doit précéder `M5`. `M9` clôt et exige tout.

**Le chemin critique réel** est `M0 → M1(serveur) → M2(interface) → M1(écrans) → M2(temps réel) →
M3 → M4 → M5 → M9`.

---

## 16. Dépendance externe : l'état réel de la passerelle

**C'est la contrainte de planification la plus importante de ce document, et elle n'a pas bougé avec
la bascule.** Le contrat décrit **133 opérations** — chiffre mesuré le 01/08/2026 sur le YAML, les
documents hérités disaient 134. La passerelle n'en avait implémenté que **71 au 27/07/2026** ; les 62
restantes existent au contrat, sont servies par le mock, mais **ne répondaient pas encore en réel**.

> ⚠️ **Le ratio 71/133 date du 27/07 et n'a pas été revérifié contre la 2.5.0.** Le contrat a pris dix
> versions depuis, dont une majeure — l'implémentation amont a probablement avancé. **Le relever à
> l'ouverture de chaque jalon**, et corriger le tableau ci-dessous plutôt que de le croire.

| Jalon | Opérations manquantes | Jalon passerelle attendu |
|---|---|---|
| **M2** — hub WS | `stream-metrics`, `stream-sessions`, `stream-billing-alerts` | `M11` |
| **M3** — groupes, webhooks | `*-customer-group`, `*-webhook` | non planifié |
| **M4** — trafic, connecteurs, sessions | `get-traffic-metrics`, `get-connector-status`, `list-sessions`… | `M8`/`M11` |
| **M5** — CDR, contenu | `search-messages`, `get-message-trace`, `get-message-content` | `M10`/`M11` |
| **M6** — routes, sender rewrite | `reorder-routes`, `*-sender-rewrite-rule` | partiel / non planifié |
| **M8** — facturation, RGPD | les 13 opérations `billing` + `*-content-policy`, `gdpr-erase` | `M9`/`M10` |

**Ce que ça implique**

1. **Le mock-first n'est pas un confort, c'est la condition de faisabilité.** Sans Prism, `M2`, `M4`,
   `M5` et `M8` seraient bloqués pendant des mois.
2. **Chaque step touchant une opération non livrée se termine « verte contre le mock ».** Prévoir une
   passe d'intégration réelle par jalon — et la traiter comme du travail, pas comme une formalité.
3. **`M3` reste prouvable en réel dès aujourd'hui** pour les clients, comptes et identifiants — d'où
   le choix de la tranche verticale.
4. **Les opérations « non planifiées »** méritent une question à l'équipe passerelle **avant**
   d'attaquer le jalon, pas pendant.
5. **L'authentification opérateur de l'Admin API est encore un stub** côté passerelle. Le client Go
   est écrit pour OAuth2 + mTLS dès `M0` : c'est la cible, mais l'environnement de développement
   pourra être plus permissif. Ne jamais laisser cette permissivité atteindre la production (§1.8).

---

## 17. Le harnais de test — BDD

**La stratégie est le développement piloté par le comportement.** Un comportement s'écrit en Gherkin
avant d'exister, il échoue, puis on l'implémente. C'est le « test rouge d'abord » de la boucle de
travail, exprimé dans la langue du domaine plutôt que dans celle de l'implémentation.

### 17.1 Les scénarios sont la couche haute, pas toute la pyramide

```
   Scénarios Gherkin (godog)      ← le comportement observable du BFF
        │
   Tests unitaires Go             ← les mécanismes : hachage, curseurs, mappings, DTO
        │
   Tests de composant (Vitest)    ← états, permissions, clavier, copie
        │
   Parcours (Playwright)          ← cinq, contre le binaire
```

Un scénario décrit **ce que le produit fait** ; un test unitaire décrit **comment un mécanisme se
comporte aux limites**. Écrire un scénario pour vérifier qu'un curseur de pagination encode
correctement un horodatage est un abus — c'est un test unitaire. Écrire un test unitaire pour vérifier
qu'un opérateur `ops` ne peut pas lever une suppression est un abus symétrique — c'est un scénario.

### 17.2 Forme et emplacement

- **Gherkin en français** (`# language: fr` : `Contexte`, `Étant donné`, `Quand`, `Alors`). Le
  narratif est en français, le code en anglais (§1.7) — un scénario est du narratif.
- Le fichier `.feature` vit **à côté du package dont il décrit le comportement**, et ses définitions
  de step dans un `_test.go` du même package. Le comportement et l'implémentation se déplacent
  ensemble ; une feature orpheline se voit.
- Les scénarios tournent **contre le mock Prism** en amont, jamais contre la vraie passerelle — c'est
  la frontière du système sous test (§16).
- Côté client, **pas de second moteur Cucumber** : Vitest porte déjà `describe`/`it`. Les tests de
  composant prennent la forme Étant donné / Quand / Alors dans leur structure et leur intitulé, sans
  ajouter une dépendance et un langage de plus pour le même bénéfice.

### 17.3 Le mode d'échec à éviter, nommément

**Un scénario par critère d'acceptation fabrique la suite qu'on n'ose plus croire.** C'est le même
défaut que la Definition of Done décrit déjà pour les tests unitaires, et Gherkin l'aggrave : les
scénarios se lisent bien, donc on en écrit trop, donc plus personne ne les lit.

La règle est celle de la DoD : **chaque risque énuméré par la section « Tests » d'une step a une
preuve, de la forme qui lui convient** — scénario, test unitaire, mutation, parcours, ou constat écrit
sur place. Un critère d'acceptation n'appelle pas mécaniquement un scénario.

Trois symptômes qui disent qu'on a dérivé : un scénario dont les `Alors` portent sur une structure de
données plutôt que sur un effet observable ; un `Plan du scénario` à quinze lignes d'exemples qui
teste un mapping ; deux scénarios qui ne diffèrent que par une valeur.

### 17.4 Le reste du harnais

- **Go — unitaires** : gardes de permission, résolution de rôles, mappings de contrat, composition de
  la fiche message, dédoublonnage d'alertes, sérialisation des DTO. La majorité des tests, en nombre.
- **Go — intégration** : base jetable (testcontainers) ; scénario **deux instances** pour le hub WS et
  l'évaluateur ; **test de fuite de goroutines** sur le hub.
- **TypeScript — composants** (Testing Library) : états, permissions, accessibilité clavier, copie.
  Ils tapent le **mock**, jamais la passerelle.
- **Bout en bout (Playwright)** : cinq parcours seulement, **contre le binaire** — le seul moyen de
  vérifier ce qui sera réellement servi, fallback SPA et ordonnancement `/api` compris.
- **Tests d'invariants (bloquants, verts à vie)** : les cinq du §0.3. Celui de l'invariant (a) a deux
  moitiés — le test de DTO (§1.11), qui l'empêche par construction, et le scan transversal (logs,
  URLs, exports, cache persisté, attributs de trace), qui vérifie qu'aucun autre chemin ne le
  contourne. Ce sont des tests, pas des scénarios : ils décrivent une absence, et une absence ne
  s'écrit pas en Gherkin sans devenir illisible.
- **Contrat** : la génération fait échouer la compilation sur une divergence, des deux côtés. Un test
  vérifie en plus qu'aucun YAML de contrat n'est copié dans le dépôt.

### 17.5 La mutation reste obligatoire

Un scénario vert ne prouve rien de plus qu'un test vert. **Partout où le retrait d'une garde, d'un
refus, d'une redirection ou d'un verrou laisserait la suite verte, la mutation est exigée** — et elle
doit reproduire le défaut réel. La lisibilité du Gherkin rend cette vérification plus nécessaire, pas
moins : un scénario qui se lit juste inspire une confiance que rien n'a encore justifiée.

---

## 18. Risques & écarts ouverts

| Risque | Effet | Traitement |
|---|---|---|
| **63 opérations non livrées côté passerelle** (§16) | Quatre jalons développés sur mock | Mock-first assumé + passe d'intégration réelle par jalon, chiffrée comme du travail |
| **Réécriture de l'authentification** — argon2id, TOTP, WebAuthn, sessions | C'est l'endroit exact où naissent les failles ; ~18 000 lignes réécrites dont celles-là | Aucune step ne porte deux mécanismes ; chaque garde est **mutée** avant d'être crue ; la table de vérité des neuf rôles est rejouée à l'identique |
| **Catalogue de permissions à cheval sur deux langages** (§1.10) | Une divergence silencieuse affiche des contrôles que le serveur refuse | Source unique Go, génération, **test de divergence bloquant en CI** |
| **Fallback SPA vs `/api`** | Un `/api` inconnu rendrait 200 + HTML ; le client lit `response.ok` puis `.json()` et lèverait | Ordonnancement testé **sur le binaire**, pas en dev — critère d'acceptation de M0 |
| **Chargement à froid sans rendu serveur** | Un `<body>` vide sur URL collée viole le contrat à cinq états | Squelette de coquille dans le document servi, exigé en step-001 et vérifié en bout en bout |
| **Chunks paresseux + déploiement roulant** | Un onglet ouvert avant le déploiement échoue à charger Monaco **en plein incident** | Rétention d'assets inter-versions + rechargement sur désaccord de version, en step-186 |
| **CSP à nonce par requête** | Découverte tardive en production | C'est le BFF qui sert l'`index.html`, donc il peut l'injecter — vérifié explicitement en step-186 |
| **Le jeton BFF porte `content:read` en permanence** | Une garde manquante expose des corps | Invariant (c) + test d'énumération, non désactivable |
| **Redis Pub/Sub au mieux une fois** | Une alerte métier pourrait être perdue | Évaluateur sur source durable à offset persisté ; le WS ne sert jamais de détection |
| **Fuite de goroutines dans le hub** | Mémoire qui monte sous 300 sockets longue durée | Test de fuite en CI, critère d'acceptation de M2 |
| **Aucune surface Alertmanager au contrat** | Write-through et réconciliation impossibles | step-183 **bloquée** ; PR contrat côté `go-gateway` requise |

---

## 19. Questions ouvertes

- **Migrations Go** : l'outil n'est pas tranché (`golang-migrate`, `goose`, ou du SQL versionné maison).
  À décider en step-005, sur les critères : partitionnement d'`audit_log`, rejouabilité, et absence de
  dépendance native.
- **Requêtes typées** : `sqlc` génère depuis le SQL et convient au partitionnement ; à confirmer contre
  `pgx` nu en step-005.
- **Graphiques** : la spec dit « visx/Recharts ». À trancher en M4, sur la densité d'un cockpit sombre.
- **Opérations au contrat sans step passerelle** (groupes, webhooks, sender rewrite, `reorder-routes`) :
  question à l'équipe passerelle avant d'ouvrir `M3` et `M6`.
