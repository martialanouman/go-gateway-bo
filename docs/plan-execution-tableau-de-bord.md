# Plan d'exécution — Implémentation du tableau de bord Admin

**Composant :** Tableau de bord Admin / Exploitation (TanStack Start, TypeScript, pnpm)
**Statut :** Plan d'exécution v1.0
**Méthode :** fondations, puis tranche verticale prouvée, puis un écran à la fois — mock-first.
**Document compagnon :** `specification-technique-tableau-de-bord.md` (le quoi et le pourquoi ; ce
document est le comment et dans quel ordre).
**Contexte outil :** implémentation assistée par **Claude Code CLI**.

> Chaque jalon (`M0`…`M9`) précise : **Objectif**, **Dépend de**, **Livrables**, **Nouvelles
> dépendances**, **Hors périmètre** et **Critères d'acceptation** (des tests, pas des opinions). Pas
> d'estimation en jours : on pilote à l'acceptation. Les **conventions transverses (§1)** fixent une
> fois pour toutes les points récurrents — les jalons y renvoient au lieu de les redéfinir.
>
> Le découpage en PRs vit dans `tasks-todo/INDEX.md` et `tasks-todo/step-NNN.md` (67 steps). Ce plan
> ne les répète pas : il donne le cadre, l'ordre et les critères de sortie.

---

## 0. Comment exécuter ce plan avec Claude Code CLI

### 0.1 La boucle par tâche

Une step = **une session Claude Code ciblée = une PR petite et verte**. Pour chaque step, donne à
l'agent : (1) le **contexte** (réf de spec `§6.x`, le contrat `@martialanouman/gateway-api-contracts`,
l'écran de référence dans le kit UI) ; (2) le **livrable** (le fichier `step-NNN.md`) ; (3) les
**critères d'acceptation** (la section « Tests » de la step). Demande d'**écrire les tests en même
temps que le code**. Termine par la Definition of Done (§0.4).

À la fin de la PR, `git mv tasks-todo/step-NNN.md tasks-done/` en dernier commit.

### 0.2 `CLAUDE.md` (à la racine, livré par step-000)

Claude Code le lit à chaque session : commandes, carte d'architecture, invariants, index docs.
Garde-le à jour — c'est le seul document lu systématiquement.

### 0.3 Règle d'or du séquencement

On prouve la **tranche verticale** (§2) le plus tôt possible, puis chaque jalon ajoute une surface
sans casser les précédentes. Une surface non encore implémentée est une **route déclarée qui rend un
état vide explicite** (§1.9) — jamais une page blanche, jamais une entrée de menu qui ne mène nulle
part.

### 0.4 Definition of Done (chaque PR)

`pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts • critères d'acceptation couverts
par des tests • aucun invariant (a…e) violé • copie française conforme aux fondamentaux de contenu du
design system • clavier et libellés accessibles (WCAG 2.1 AA) sur tout écran touché • PR focalisée
sur une step.

### 0.5 Les 5 invariants (tests bloquants, verts à vie)

**(a)** le corps d'un message ne s'affiche jamais sans `content:read`, chaque affichage est audité, et
il n'apparaît dans aucune trace, log, URL ni export — posé à `M0`, gagné à `M5` ;
**(b)** aucun secret d'identifiant n'est jamais réaffiché — `M3` ;
**(c)** l'autorisation est appliquée côté serveur, le rendu UI n'est jamais la garde — `M1` ;
**(d)** le navigateur ne parle jamais directement à l'API Admin — `M0` ;
**(e)** le tableau de bord n'est jamais sur le chemin critique du plan de données — `M2`, revérifié à `M9`.

### 0.6 Documents de référence (source de vérité)

Contrat : `@martialanouman/gateway-api-contracts` (`openapi-admin.yaml`, 134 opérations) — **jamais
copié dans ce dépôt**. Prose : `docs/specification-technique-tableau-de-bord.md`, le design system
(`.claude/skills/sms-gateway-design/README.md` + `ui_kits/admin-console/`), et le découpage en steps
(`tasks-todo/`).

---

## 1. Conventions transverses (à fixer AVANT M0)

Ces choix sont fixés une fois ; tous les jalons s'y conforment. Les changer plus tard est une décision
d'équipe.

### 1.1 Dépôt, langage, versions

- **Node :** ≥ 22 LTS, figé dans `.nvmrc` et dans la CI.
- **Gestionnaire :** `pnpm` (exigence §1.3 de la spec). Lockfile commité.
- **TypeScript :** `strict`, plus `noUncheckedIndexedAccess` et `verbatimModuleSyntax`.
- **Structure :** `src/routes/` (routage fichiers), `src/server/` (le BFF), `src/components/`,
  `src/lib/`, `src/styles/`. Tout ce qui touche un secret ou l'API Admin vit sous `src/server/`.

### 1.2 Bibliothèques imposées

Aucune autre bibliothèque pour ces rôles sans décision d'équipe. **Vérifier version et API via `ctx7`
avant tout ajout ou toute mise à jour** — ne jamais recopier une signature de mémoire.

| Rôle | Bibliothèque | Version vérifiée (27/07/2026) |
|---|---|---|
| Framework | `@tanstack/react-start` | 1.168.x |
| Routage | `@tanstack/react-router` | 1.170.x |
| État serveur | `@tanstack/react-query` | 5.101.x |
| Primitives UI | `@base-ui/react` | 1.6.x |
| ORM | `drizzle-orm` / `drizzle-kit` | 0.45.x / 0.31.x |
| Contrat | `@martialanouman/gateway-api-contracts` | **1.0.0** |
| Client HTTP typé | `openapi-fetch` | 0.17.x |
| Mock d'API | `@stoplight/prism-cli` | 5.16.x |
| Redis | `ioredis` | 5.11.x |
| Graphiques | `recharts` | 3.10.x |
| Virtualisation | `@tanstack/react-virtual` | 3.14.x |
| Éditeur | `monaco-editor` | 0.56.x |
| WebAuthn | `@simplewebauthn/server` + `/browser` | 13.3.x |
| Tests | `vitest` + `@playwright/test` | 4.1.x / 1.62.x |

Pas de framework CSS utilitaire : les tokens de la charte et le CSS de composant suffisent.

### 1.3 La frontière BFF ⟷ client

C'est la convention la plus structurante du dépôt.

- Le client parle **uniquement** aux fonctions serveur / routes du BFF. Jamais à l'API Admin
  (**invariant d**).
- Le jeton machine (OAuth2 client_credentials), le certificat mTLS et la connexion PostgreSQL vivent
  sous `src/server/` et **nulle part ailleurs**.
- Une **règle de lint** interdit l'import d'un module `src/server/gateway/**` ou `src/server/db/**`
  depuis un composant client. Elle est posée en step-001 et n'est jamais désactivée localement.
- Conséquence à garder en tête : le jeton du BFF porte `content:read` en permanence. **Seul le BFF**
  peut restreindre la lecture d'un corps par opérateur — d'où l'invariant (c) et le test
  d'énumération de routes de la step-025.

### 1.4 Modèle d'erreur & codes

- L'API Admin renvoie une enveloppe plate `{ code, message, errors[] }`. Le BFF la **traduit en
  erreur typée** (step-001) et la **réexpose dans la même forme** à son propre client : une seule
  forme d'erreur dans tout le produit.
- `code` est un contrat partagé avec la passerelle : ne jamais le réinventer côté tableau de bord.
- `errors[]` alimente les erreurs champ par champ des formulaires. Un formulaire qui affiche un
  message global alors que `errors[]` est renseigné est un défaut.
- Cinq états de contenu (§1.9) ≠ erreurs : « module désactivé » et « aucun résultat » ne passent
  jamais par le chemin d'erreur.

### 1.5 Conventions de données

- **UUIDv7** partout, cohérent avec la plateforme.
- **Pagination par curseur** partout où le contrat l'impose (CDR, grand livre, listes volumineuses).
  Aucune UI de type « page 4 sur 120 ».
- **Crédits = entiers**, jamais une devise formatée.
- Dates en ISO 8601 UTC sur le fil ; affichage localisé en français, fuseau affiché quand il compte
  (incident, audit).
- Les identifiants techniques ne se traduisent **jamais** et se rendent en mono, verbatim du payload :
  `link_status`, `breaker_state`, `max_sessions`, `balance_scope`, `half_open`, `query_sm`.

### 1.6 Conventions temps réel

- **Une seule socket** par opérateur, multiplexée par sujet : `metrics.traffic`, `metrics.connectors`,
  `sessions.events`, `notifications`, `billing.alerts`.
- Enveloppe figée : `{ topic, ts, data }`. Le client envoie `{"action":"subscribe","topics":[...]}` au
  montage et `unsubscribe` au démontage.
- Côté passerelle, **trois flux distincts** (`stream-metrics`, `stream-sessions`,
  `stream-billing-alerts`) sont consommés **une seule fois** par l'instance porteuse du bail, puis
  republiés en Redis Pub/Sub et rediffusés par chaque instance (§4.1 de la spec).
- **Instantané REST au chargement, puis flux.** Le point pulsant ne s'affiche qu'en direct ; au-delà
  de la tolérance de 2–5 s, l'écran bascule en « données périmées » — il n'invente jamais une valeur.
- Redis Pub/Sub est **au mieux une fois** : acceptable pour de l'affichage, jamais pour une détection
  (§6.8, jalon M9).

### 1.7 Langue & copie

- Copie d'interface en **français**, troisième personne, **conséquence d'abord**.
- « Sécurisé » n'est jamais une promesse : on dit ce que la protection couvre et où s'arrête la
  frontière d'accès.
- Casse phrase pour libellés, titres et boutons ; micro-labels en capitales ; les pilules de statut
  gardent le `snake_case` de l'API.
- Cinq états, cinq copies distinctes (§1.9).

### 1.8 Configuration & secrets

- Toute la configuration par variables d'environnement, validée **au démarrage** (échec bruyant, pas
  de valeur par défaut silencieuse en production).
- `.env.example` documenté et à jour ; `.env` jamais commité.
- Secrets requis : jeton/identifiants OAuth2 de l'API Admin, certificat mTLS, secret de signature de
  session, secret du webhook Alertmanager, DSN PostgreSQL, URL Redis.
- Aucun secret ne traverse la frontière §1.3, n'entre dans un log, un toast, une URL ou un audit.

### 1.9 Convention « surface non encore livrée »

Une route déclarée mais non implémentée rend un **état vide explicite** nommant le jalon prévu, et
son entrée de navigation est visible. Jamais une page blanche, jamais un lien mort, jamais un écran
inventé. Les cinq états sont : `Loading` (squelette de la vraie mise en page) · `Empty` (rien encore
+ comment créer) · `NoResults` (filtres trop étroits + comment élargir) · `ModuleDisabled`
(dégradation propre, **jamais** une erreur) · `ErrorState` (réalité HTTP + « vos données locales
restent affichées » + Réessayer).

### 1.10 Le catalogue de permissions est un contrat

Les ~40 clés du §3.1 sont **fixes**, versionnées avec les releases, non éditables par un admin. Les
rôles sont des paquets éditables de ces clés. Ajouter une permission se fait à trois endroits en même
temps : le seed du catalogue, la garde serveur qui l'utilise, et le tableau des rôles par défaut du
§6.10. Une permission seedée que personne ne vérifie est un mensonge d'interface.

---

## 2. La tranche verticale de référence

Le tableau de bord n'a pas de « squelette » au sens d'un pipeline : sa tranche verticale, c'est la
chaîne complète navigateur → BFF → contrat → passerelle, avec autorisation et audit.

```
Login + MFA ──► session BFF ──► /auth/me (permissions résolues)
                                      │
                                      ▼
                            AppShell + écran Clients
                                      │
                       requirePermission("customers:write")
                                      │
                                      ▼
              client typé (OAuth2 + mTLS) ──► Admin API ──► audit_log
```

**Elle est acquise à la fin de `M3`, step-061** : un opérateur se connecte, franchit le MFA, voit
l'écran Clients rendu selon ses permissions, crée un client, et l'action laisse une ligne d'audit.
À partir de là, chaque écran suivant n'est plus qu'une répétition du même trajet.

> **Pourquoi les clients et pas les groupes** : `list-customers` / `create-customer` /
> `suspend-customer` sont **déjà implémentées** côté passerelle, alors que `list-customer-groups` ne
> l'est pas encore (§15). La tranche verticale doit être prouvée contre la **vraie** passerelle, pas
> seulement contre le mock.

---

## 3. Vue d'ensemble des jalons

| Jalon | Objectif | Débloque |
|---|---|---|
| **M0** | Fondations : scaffold, contrat + mock, Drizzle, tokens, harnais de test | tout |
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

## 4. M0 — Fondations & outillage

**Objectif :** un dépôt qui compile, se lint, se teste, démarre ses dépendances et parle au contrat.
**Dépend de :** —
**Steps :** 000 → 004

**Livrables**
- Application TanStack Start (§1.1), scripts pnpm, CI GitHub Actions, `CLAUDE.md`, `.env.example`.
- Client Admin typé (`openapi-fetch` + types du contrat), OAuth2 client_credentials avec jeton mis en
  cache, mTLS, traduction de l'enveloppe d'erreur (§1.4), **règle de lint de la frontière §1.3**.
- Mock Prism sur `openapi-admin.yaml` (`pnpm mock`) et bascule réel/mock par environnement.
- `docker-compose.yml` (PostgreSQL 18 + Redis), schéma Drizzle des six tables du §3.1, migrations
  commitées, `audit_log` partitionné par mois.
- Tokens de la charte + page `/_design`, polices auto-hébergées.
- Harnais Vitest + Testing Library + Playwright, fabriques alimentées par les types du contrat,
  utilitaire de scan qui portera l'**invariant (a)**.

**Nouvelles dépendances :** toutes celles du §1.2 sauf Monaco, Recharts, SimpleWebAuthn (plus tard).

**Hors périmètre :** aucun écran métier, aucune authentification, aucun WebSocket.

**Critères d'acceptation**
- Poste neuf : `pnpm install && docker compose up && pnpm db:migrate && pnpm dev` suffit.
- Un appel typé (`list-customers`) réussit contre le mock **et** contre la passerelle réelle.
- La règle de lint échoue si un composant client importe le client Admin (**invariant d**).
- `/_design` rend la charte complète ; contraste AA vérifié automatiquement.
- CI verte : typecheck, lint, test, build, e2e de fumée.

---

## 5. M1 — Authentification, permissions & audit

**Objectif :** savoir qui est connecté, ce qu'il a le droit de faire, et garder trace de ce qu'il fait.
**Dépend de :** M0
**Steps :** 020 → 027

**Livrables**
- Catalogue des ~40 permissions et les **neuf rôles par défaut** du §6.10, seedés et idempotents.
- Login email/mot de passe (Argon2id, anti-brute-force partagé entre instances), session BFF signée
  et partagée, `/auth/me` renvoyant l'union des permissions.
- MFA **TOTP** (anti-rejeu, codes de récupération) et **WebAuthn/passkey** (`rpID`/`origin` vérifiés
  côté serveur, compteur de signature).
- `requirePermission(key)` + écriture systématique d'`audit_log` + **MFA obligatoire** pour les rôles
  privilégiés.
- Rendu UI par permission (contrôle **désactivé et expliqué**, jamais masqué), écrans Login et MFA,
  administration des opérateurs et des rôles.

**Nouvelles dépendances :** `@simplewebauthn/server` + `/browser`, bibliothèque TOTP, Argon2.

**Hors périmètre :** l'écran de consultation du journal d'audit (M9) ; l'authentification de la
passerelle elle-même (côté `go-gateway`, voir §15).

**Critères d'acceptation**
- Table de vérité des neuf rôles vérifiée, **y compris les exclusions** : `ops` sans
  `suppressions:delete`, `script_author` sans `scripts:publish`, `support_readonly` sans
  `content:read`, `account_manager` sans `billing:topup`.
- **Invariant (c)** : le test d'énumération des routes échoue si une route de mutation n'a ni garde de
  permission ni écriture d'audit.
- Une session non-MFA ne peut atteindre aucune écriture ni `content:read`.
- Aucun secret ni corps ne se retrouve dans `audit_log` (payload piégé).
- Parcours e2e login → MFA (TOTP et passkey) → console.

---

## 6. M2 — Coquille applicative & temps réel

**Objectif :** la coquille dans laquelle tous les écrans se branchent, et le temps réel qui les
alimente — en topologie multi-instance.
**Dépend de :** M1
**Steps :** 040 → 046

**Livrables**
- `AppShell` (rail groupé, barre supérieure, pile de toasts), arborescence complète de routes en
  états vides explicites (§1.9), `Page` et `Toolbar`.
- Primitives Base UI habillées par les tokens : formulaires, tabs, table, pilules de statut, dialogs,
  menus, tooltips, toasts, plus les **cinq états de contenu**.
- Hub WebSocket BFF : les trois flux amont agrégés en une socket multiplexée, filtrage d'abonnement
  par permission, files bornées par client.
- **HA** : bail Redis, un seul consommateur amont, republication Pub/Sub, rediffusion par instance,
  bascule automatique.
- Client WS React (`useTopic`, comptage de références, reconnexion, `isLive`/`isStale`) et centre de
  notifications persisté.

**Nouvelles dépendances :** `ioredis`.

**Hors périmètre :** les widgets de trafic (M4) ; l'évaluateur d'alertes (M9).

**Critères d'acceptation**
- Deux instances : un seul consommateur amont ; tuer le porteur du bail bascule sans trou perceptible ;
  un client de l'instance B reçoit ce que consomme l'instance A.
- Un sujet non autorisé par les permissions est refusé à l'abonnement.
- **Invariant (e)** : la chute d'un flux amont dégrade l'affichage (état périmé, horodatage) sans
  vider l'écran ni faire tomber les autres sujets.
- Un client lent voit ses messages jetés ; la mémoire du serveur reste bornée.
- Chaque route déclarée rend un état explicite : aucune page blanche.

---

## 7. M3 — Clients, comptes SMPP & identifiants

**Objectif :** prouver la tranche verticale (§2) et livrer le socle du domaine à deux niveaux.
**Dépend de :** M2
**Steps :** 060 → 066

**Livrables**
- Groupes de clients (CRUD, filtre transverse réutilisable), clients (liste, filtres, création, fiche,
  suspension **en cascade** chiffrée, sender IDs).
- Comptes SMPP : liste, création rattachée au client, canaux, politique de sender ID, bascules
  `query_sm`/`cancel_sm`, webhooks, quotas, `max_sessions` avec **badge d'écart**.
- Identifiants : **exactement deux cartes** masquées, secret montré **une seule fois**, rotation
  manuelle avec fenêtre de grâce et avertissement variable, révocation avec impact chiffré,
  diagnostic d'échec de bind.

**Nouvelles dépendances :** aucune.

**Hors périmètre :** la déconnexion forcée des sessions (M4) ; la facturation du client (M8).

**Critères d'acceptation**
- **La tranche verticale passe contre la passerelle réelle** (§2), pas seulement contre le mock.
- **Invariant (b)** : le secret apparaît exactement une fois ; après fermeture de la modale il est
  introuvable dans le DOM, l'état, le cache Query et les logs. Aucune action « révéler » n'existe.
- Suspendre un client affiche l'impact chiffré avant confirmation et le propage aux comptes.
- Baisser `max_sessions` sous le nombre de binds vivants avertit, n'est pas bloqué, et affiche le
  badge d'écart — la copie dit que les binds vivants ne sont **pas** coupés.

---

## 8. M4 — Exploitation temps réel

**Objectif :** le cockpit qu'on ouvre pendant un incident.
**Dépend de :** M2 (temps réel), M3 (comptes)
**Steps :** 080 → 086

**Livrables**
- Trafic : instantané REST, widgets, graphiques conformes à la charte §07, flux WS, bascule de plage
  (5 min WS / 1 h / 24 h REST), ventilations connecteur/client/compte/groupe, drill-down CDR.
- Connecteurs : CRUD à divulgation progressive, pool de binds, politique de reconnexion, santé **par
  bind** avec `link_status` (point) et `breaker_state` (pilule) **séparés**, rebind.
- Sessions : table virtualisée, mises à jour en **deltas**, réconciliation périodique, déconnexion
  forcée nommée et auditée.

**Nouvelles dépendances :** `recharts`, `@tanstack/react-virtual`.

**Hors périmètre :** le CDR Explorer (M5).

**Critères d'acceptation**
- Un connecteur dont certains binds sont `up` et d'autres `down` s'affiche correctement : aucun état
  unique inventé, aucun indicateur fusionné.
- `link_status: up` + `breaker_state: open` se rend comme un état normal, pas comme une contradiction.
- En plage 1 h ou 24 h, aucun abonnement WS n'est actif ; en 5 min, le point pulsant apparaît.
- Un événement de session met à jour la table **sans refetch global** ; un delta manqué est rattrapé
  par la réconciliation.
- La ventilation par groupe égale la somme des comptes membres.

---

## 9. M5 — CDR Explorer & trace

**Objectif :** l'outil d'investigation — et l'écran où l'invariant (a) se gagne.
**Dépend de :** M4 (drill-down), M1 (permissions)
**Steps :** 100 → 104

**Livrables**
- Recherche filtrable, **pagination par curseur**, table virtualisée, vues sauvegardées, URL
  partageable.
- Fiche message **composée côté BFF** (`search-messages` filtré + `get-message-trace`), chronologie,
  décision de facturation.
- Visualiseur de trace en cascade de spans, étapes en échec ou lentes signalées.
- Corps gardé par `content:read`, audité, avec quatre états explicites (non stocké / expiré / effacé /
  non autorisé) et la mention « lecture journalisée » **avant** le clic ; journal des accès au contenu.
- Export CSV asynchrone gouverné : `cdr:export_bulk`, plafond de lignes annoncé et appliqué, masquage
  MSISDN par rôle, TTL d'artefact, audit.

**Nouvelles dépendances :** aucune.

**Hors périmètre :** la politique de contenu et les effacements (M8).

**Critères d'acceptation**
- **Invariant (a)**, test bloquant : le corps n'apparaît dans aucun log, URL, message d'erreur, cache
  persisté, export CSV ni attribut de trace — y compris sur un payload amont piégé.
- Sans `content:read` : état « non autorisé » et **aucun appel réseau** au contenu.
- Avec : le corps s'affiche et **exactement une** ligne d'audit `content.read` est écrite.
- Pagination par curseur stable sur un jeu qui s'enrichit ; aucune UI de numéro de page.
- L'export tronqué **le dit** ; le lien expire.

---

## 10. M6 — Routage & scripts

**Objectif :** le composant distinctif (§8 de la spec) : observer, ouvrir la route, écrire et publier
un script sans quitter l'outil.
**Dépend de :** M4 (connecteurs)
**Steps :** 120 → 126

**Livrables**
- Routes : table par priorité, réordonnancement souris **et clavier**, éditeur (conditions, stratégie,
  éditeur de cibles **adapté à la stratégie**, route de repli, testeur de regex).
- Simulateur avec **bandeau de précédence** : numéro exact > script > déclaratif, et la mention que le
  court-circuit ne saute **que la résolution de route**.
- Numéros exacts : CRUD **par MSISDN** (la clé est le MSISDN), lookup « où partirait ce numéro, et
  pourquoi », import MNP en masse sous `routes:import`.
- Monaco chargé paresseusement, contrat `resolveRoute` documenté, validation en ligne, exécuteur de
  payload, garde-fous du bac à sable affichés ; versions, publication séparée de l'écriture, retour
  arrière, affectation de portée, santé en direct par script.
- Règles de réécriture de sender ID aux quatre portées, avec précédence visible et test.

**Nouvelles dépendances :** `monaco-editor`.

**Hors périmètre :** l'exécution de script côté navigateur — elle a lieu dans le bac à sable de la
passerelle, jamais ici.

**Critères d'acceptation**
- Le bandeau de précédence apparaît dans les trois cas et énonce que la conformité continue de
  s'appliquer.
- `script_author` ne peut pas publier, et l'écran explique pourquoi (revue par `ops`).
- Publier sur une portée déjà pourvue nomme le script remplacé et applique l'unicité.
- Le réordonnancement est faisable **au clavier**.
- Monaco n'est pas chargé sur les autres écrans.

---

## 11. M7 — Conformité

**Objectif :** rendre l'opt-out lisible, diagnosticable, et sa levée difficile.
**Dépend de :** M1 (permissions), M3 (comptes)
**Steps :** 140 → 146

**Livrables**
- Suppressions : liste **scopée par canal** avec origine (`mo_stop`/`admin`/`import`/`regulator`),
  création, import en masse avec compte-rendu, mots-clés par pays.
- Outil « pourquoi ce message a-t-il été bloqué ? » renvoyant **la portée décideuse**, plus
  l'avertissement structurel sur les comptes alphanumériques sans numéro entrant.
- Levée derrière la permission dédiée `suppressions:delete`, confirmation, audit, avertissement
  renforcé pour l'origine `regulator`.
- Numéros entrants (dédié/partagé, mots-clés, collisions avec STOP/START/HELP signalées), file MO non
  routés regroupée par cause avec création de règle à la volée.
- Anti-spam : CRUD, test contre exemple, file de revue auditée, tendance de réputation.

**Nouvelles dépendances :** aucune.

**Hors périmètre :** l'effacement RGPD (M8), qui conserve l'opt-out.

**Critères d'acceptation**
- Un opérateur `ops` ne peut pas lever une suppression et **voit pourquoi** ; `compliance` le peut.
- La vérification renvoie toujours la portée décideuse, jamais un booléen nu.
- **Invariant (a)** : aucun corps de MO dans la file des non routés, même si l'amont en renvoie un.
- L'import rend un compte-rendu ligne à ligne ; aucune donnée de conformité ingérée en silence.

---

## 12. M8 — Facturation, contenu & RGPD

**Objectif :** monétisation lisible et effacement prouvable.
**Dépend de :** M3 (clients), M5 (corps et états de contenu)
**Steps :** 160 → 166
**⚠️ Dépendance externe forte :** voir §15 — la passerelle n'a livré ni sa facturation (`M9`) ni son
module contenu/RGPD (`M10`).

**Livrables**
- Proxy fin sans état, avec dégradation `ModuleDisabled` propre quand le module est éteint.
- **Deux cartes distinctes** : solde MT (bloque à zéro) et compteur MO (monte, ne bloque rien), avec
  la phrase explicite du §6.11 ; `balance_scope` affiché en permanence, grand livre paginé.
- Recharge par direction, transfert, changement de portée **visible mais inerte** tant qu'un solde
  n'est pas à zéro.
- Plans tarifaires, fournisseurs externes avec test de connexion (secrets masqués).
- Politique de contenu plateforme et par client, avec **valeur effective** affichée pour `inherit` ;
  crypto-shred `content:erase` ; effacement RGPD **avec choix de cible** (client / MSISDN), job
  asynchrone, attestation, **opt-out conservé**.

**Nouvelles dépendances :** aucune.

**Hors périmètre :** la lecture d'un corps (M5).

**Critères d'acceptation**
- Module désactivé → aucune erreur, aucun toast, un état dédié.
- Solde MT et compteur MO rendus comme deux objets sémantiquement différents.
- Après crypto-shred, l'onglet Corps du CDR Explorer affiche **« effacé »**, pas « non stocké ».
- Cible MSISDN : l'opt-out subsiste après effacement ; l'attestation n'est disponible qu'après
  achèvement réel du job.
- `account_manager` ne peut pas recharger ; le changement de portée reste inerte à solde non nul.

---

## 13. M9 — Alerting, audit & mise en production

**Objectif :** rendre l'outil exploitable en continu et le mettre en production sans SPOF.
**Dépend de :** tous les jalons précédents
**Steps :** 180 → 186

**Livrables**
- `alert_rules` avec `evaluation_owner` **dérivé de la métrique, affiché et expliqué**.
- Webhook Alertmanager entrant (mTLS ou secret partagé, isolé, idempotent) et distribution des
  notifications avec dédoublonnage sur transition.
- Évaluateur BFF des métriques métier sur **source durable à offset persisté**, un seul évaluateur
  actif, lag exposé.
- ⚠️ **step-183 (réconciliation Alertmanager) est bloquée** : aucune surface Alertmanager au contrat.
- Écran de consultation du journal d'audit, utilisable avec `audit:read` seul.
- Audit WCAG 2.1 AA et cinq parcours Playwright de bout en bout.
- Image de production, déploiement ≥2 instances avec affinité WS, sondes, arrêt propre, CSP compatible
  Monaco, runbook.

**Nouvelles dépendances :** outil d'audit d'accessibilité (axe).

**Hors périmètre :** l'observabilité applicative détaillée du BFF lui-même.

**Critères d'acceptation**
- Redémarrage de l'évaluateur au milieu d'un lot : les transitions manquées sont **rejouées**, aucune
  perdue ; une bascule ne produit ni trou ni tempête de doublons.
- Double livraison du même événement Alertmanager → une seule notification.
- Déploiement roulant à deux instances : **aucune session perdue**, reprise WS transparente.
- Aucune violation AA bloquante sur les cinq parcours.
- **Invariant (e)** réaffirmé dans le runbook : une panne du tableau de bord ne dégrade que la
  visualisation ; l'alerting infra continue via Alertmanager.

---

## 14. Graphe de dépendances & parallélisation

```
M0 ─► M1 ─► M2 ─► M3 ─┬─► M4 ─► M5 ─┐
                      │             ├─► M9
                      ├─► M6 ───────┤
                      ├─► M7 ───────┤
                      └─► M8 ───────┘
```

`M3` est le point de bascule : avant, on outille et on prouve la chaîne ; après, chaque jalon ajoute
des écrans qui ne se marchent pas dessus.

**Ce qui peut avancer en parallèle une fois `M3` acquis :** `M6` (routage), `M7` (conformité) et `M8`
(facturation/contenu) touchent des écrans, des permissions et des endpoints **disjoints**. `M4` doit
précéder `M5` (le drill-down vient du trafic). `M9` clôt et exige tout le reste.

**Le chemin critique réel** est `M0 → M1 → M2 → M3 → M4 → M5 → M9` : c'est lui qu'il faut protéger
des dérives. `M6`, `M7` et `M8` sont des branches latérales.

---

## 15. Dépendance externe : l'état réel de la passerelle

**C'est la contrainte de planification la plus importante de ce document.** Le contrat décrit
**134 opérations**, mais la passerelle n'en a implémenté que **71** au 27/07/2026 (elle est à son
jalon `M8`, résilience connecteurs). Les 63 restantes existent au contrat, sont servies par le mock,
mais **ne répondent pas encore en réel**.

| Jalon tableau de bord | Opérations manquantes | Jalon passerelle attendu |
|---|---|---|
| **M2** — hub WS | `stream-metrics`, `stream-sessions`, `stream-billing-alerts` | `M11` (steps 183-184) |
| **M3** — groupes | `list-customer-groups`, `get/create/update/delete-customer-group`, `list-group-customers`, `set-customer-group` | non planifié explicitement |
| **M3** — webhooks | `list/create/update/delete-webhook` | non planifié explicitement |
| **M3** — compte | `set-account-sender-id-policy`, `set-account-smpp-ops`, `suspend-smpp-account` | partiel |
| **M4** — trafic | `get-metrics-summary`, `get-traffic-metrics` | `M11` (step 182) |
| **M4** — connecteurs | `get-connector-status`, `rebind-connector`, `set-connector-reconnect-policy`, `set-connector-bind-pool` | `M8` (step 128, en cours) |
| **M4** — sessions | `list-sessions`, `list-account-sessions`, `disconnect-session` | `M8`/`M11` |
| **M5** — CDR | `search-messages`, `get-message-trace`, `create-message-export`, `get-message-export` | `M11` (steps 185-187) |
| **M5** — contenu | `get-message-content` | `M10` (step 163) |
| **M6** — routes | `reorder-routes` | partiel |
| **M6** — sender rewrite | `list/create/update/delete-sender-rewrite-rule`, `test-sender-rewrite-rule` | non planifié explicitement |
| **M8** — facturation | les 13 opérations `billing`/`rate-plan`/`balance` | `M9` (steps 148-149) |
| **M8** — contenu/RGPD | `*-content-policy`, `erase-customer-content`, `rotate-content-key`, `gdpr-erase`, `get-gdpr-erase-job` | `M10` (steps 162-166) |

**Ce que ça implique concrètement**

1. **Le mock-first n'est pas un confort, c'est la condition de faisabilité.** Sans Prism, `M2`, `M4`,
   `M5` et `M8` seraient bloqués pendant des mois.
2. **Chaque step touchant une opération non livrée se termine « verte contre le mock ».** Prévoir une
   passe d'intégration réelle par jalon, quand la passerelle rattrape — et la traiter comme du travail,
   pas comme une formalité : un mock ne reproduit ni la latence, ni les erreurs, ni les cas limites.
3. **`M3` reste prouvable en réel dès aujourd'hui** pour les clients, comptes SMPP et identifiants
   (§2) — d'où le choix de la tranche verticale sur les clients plutôt que sur les groupes.
4. **Les opérations « non planifiées explicitement »** (groupes de clients, webhooks, sender rewrite,
   `reorder-routes`) sont au contrat sans step passerelle identifiée. Elles méritent une question à
   l'équipe passerelle **avant** d'attaquer le jalon concerné, pas pendant.
5. **L'authentification opérateur de l'Admin API est encore un stub** côté passerelle (remplacé par
   `step-206`, jalon `M12`). Le client du BFF est écrit pour OAuth2 client_credentials + mTLS dès
   `M0` : c'est la cible, mais l'environnement de développement pourra être plus permissif. Ne jamais
   laisser cette permissivité atteindre une configuration de production (§1.8).

---

## 16. Le harnais de test (transversal)

- **Unitaires (Vitest)** — logique BFF, résolution de permissions, mappings de contrat, composition de
  la fiche message, dédoublonnage d'alertes. La majorité des tests.
- **Composants (Testing Library)** — états, permissions, accessibilité clavier, copie. Ils tapent le
  **mock**, jamais la passerelle.
- **Intégration** — base jetable (Testcontainers ou service CI) pour Drizzle ; scénario deux instances
  pour le hub WS et l'évaluateur.
- **Bout en bout (Playwright)** — cinq parcours seulement (§13), sur le mock, sans attente arbitraire.
- **Tests d'invariants (bloquants, verts à vie)** — les cinq du §0.5. Celui de l'invariant (a) est un
  **scan transversal** : logs, URLs, payloads d'export, cache persisté, attributs de trace.
- **Contrat** — le typage `openapi-typescript` fait déjà échouer la compilation sur une divergence.
  Un test vérifie en plus qu'aucun YAML de contrat n'est copié dans le dépôt.

---

## 17. Risques & écarts ouverts

| Risque | Effet | Traitement |
|---|---|---|
| **63 opérations non livrées côté passerelle** (§15) | Quatre jalons développés à l'aveugle sur mock | Mock-first assumé + passe d'intégration réelle par jalon, chiffrée comme du travail |
| **Aucune surface Alertmanager au contrat** (§6.8) | Write-through et réconciliation impossibles | step-183 explicitement **bloquée** ; PR contrat côté `go-gateway` requise ; step-180 dégradée et documentée |
| **Le jeton BFF porte `content:read` en permanence** | Une garde manquante expose des corps de messages | Invariant (c) + test d'énumération des routes (step-025), non désactivable |
| **Redis Pub/Sub au mieux une fois** | Une alerte métier pourrait être perdue si évaluée sur le flux | Évaluateur sur source durable à offset persisté (step-182) ; le WS ne sert jamais de détection |
| **Affinité WS au load balancer** | Un déploiement standard casse les sockets | Exigence documentée dans le runbook (step-186) et testée en déploiement roulant |
| **CSP vs Monaco** | Découverte tardive en production | Vérifié explicitement en step-186 |
| **Opérations au contrat sans step passerelle** (groupes, webhooks, sender rewrite, `reorder-routes`) | Attente indéfinie sur des écrans planifiés | Question à l'équipe passerelle avant d'ouvrir `M3`, `M6` |
