# Découpage en steps — Tableau de bord Admin (BFF Go + SPA React)

Dérivé de `plan.md`, lui-même dérivé de `../docs/specification-technique-tableau-de-bord.md` (v2.1).
**Un fichier `steps/step-NNN.md` = une PR** : petite, reviewable, laisse le dépôt vert une fois
mergée. Découpage par jalon (M0…M9) ; numérotation par blocs de 20, pour laisser de la marge
d'insertion.

**L'ordre de cette liste fait foi, pas le numéro** — sauf quand la ligne « Dépend de » d'un fichier de
step le contredit : **les dépendances déclarées priment toujours**. Les sections groupent par jalon,
donc par thème ; un jalon peut se clore après le début du suivant, et c'est le cas de M1 (voir †).

Le **plan** donne le cadre : conventions transverses, tranche verticale, critères de sortie par jalon,
graphe de parallélisation, état réel de la passerelle. Cet index donne le découpage en PRs. Les deux
se lisent ensemble.

**Workflow :** on prend le prochain `steps/step-NNN.md`, on l'exécute en 1 session = 1 PR — **BDD
strict, scénario rouge d'abord** —, puis revue en sous-agents relancée tant qu'il reste un blocage,
Definition of Done verte, déplacement du fichier dans `steps/done/` (dernier commit de la PR), PR
ouverte et mergée dès que la CI est verte. Le détail de la boucle et la règle d'arbitrage sont dans
`CLAUDE.md`.

Légende : `[x]` = livré (dans `steps/done/`) · `[ ]` = à faire (dans `steps/`).

---

## Ce qu'on construit

Le **tableau de bord Admin** de la passerelle SMS : un cockpit d'exploitation interne (100–300
opérateurs, desktop-first, thème sombre) qui pilote clients, comptes SMPP, connecteurs, routage,
conformité et facturation. Il est **client de l'API Admin de la passerelle** — jamais de la base.

Le navigateur ne parle qu'au **BFF Go**, qui parle à l'API Admin et à son petit schéma PostgreSQL
propre (opérateurs, rôles, audit, alertes, notifications, vues sauvegardées). Le tout est **un seul
binaire** : le Go embarque les assets de la SPA.

## Pile technique

Versions Go relevées sur `proxy.golang.org` le 01/08/2026 ; versions JS telles qu'installées.
**Avant tout ajout ou bump : `ctx7` côté JS, `pkg.go.dev` côté Go. Jamais de version devinée.**

| Brique | Choix | Version |
|---|---|---|
| Langage serveur | Go | figé dans `go.mod` |
| Routeur HTTP | `go-chi/chi/v5` | v5.3.1 |
| WebSocket | `coder/websocket` | v1.8.15 |
| PostgreSQL | `jackc/pgx/v5` | v5.10.0 |
| Génération OpenAPI | `oapi-codegen/oapi-codegen/v2` | v2.8.0 |
| WebAuthn | `go-webauthn/webauthn` | v0.17.4 |
| TOTP | `pquerna/otp` | v1.5.0 |
| Redis Pub/Sub | `redis/go-redis/v9` | v9.21.0 |
| Hachage | `golang.org/x/crypto/argon2` | — |
| Assets embarqués | `embed` (stdlib) | — |
| **BDD** | `cucumber/godog` + `stretchr/testify` | v0.16.0 / v1.11.1 |
| Socle client | React + Vite | 19.2.8 / 8.1.5 |
| Routage | `@tanstack/react-router` + `router-plugin` | 1.170.x |
| État serveur | `@tanstack/react-query` | 5.101.4 |
| Primitives UI | `@base-ui/react` | 1.6.0 |
| Client HTTP typé | `openapi-fetch` | 0.17.0 |
| Contrat API | `@martialanouman/gateway-api-contracts` | **4.0.2** |
| Mock d'API | `@stoplight/prism-cli` | 5.16.0 |
| Tests client | Vitest + Playwright | 4.1.10 / 1.62.0 |
| Langage client | TypeScript, `strict` | 7.0.2 |
| Lint + format client | Biome | 2.5.5 |
| Gestionnaire client | **pnpm** | — |

Graphiques, virtualisation et éditeur ne sont pas encore installés : la version se relève **à
l'ajout**, pas ici.

## Les 5 invariants (tests bloquants, verts à vie)

- **(a)** Le **corps d'un message** ne s'affiche jamais sans `content:read`, et chaque affichage
  déclenche un appel audité. Il n'apparaît dans aucune trace, log, URL ni export. **Porté par les DTO
  de sortie** : un champ absent du struct ne peut pas être émis.
- **(b)** Aucun **secret d'identifiant** n'est jamais réaffiché : masqué en permanence, montré
  exactement une fois à la création ou à la rotation, aucune action « révéler ».
- **(c)** L'**autorisation est appliquée côté serveur**. Le rendu conditionnel de l'UI est un confort,
  jamais la garde.
- **(d)** Le **navigateur ne parle jamais directement à l'API Admin** : jeton machine, mTLS et scopes
  restent sous `internal/`, que le langage rend inatteignable de l'extérieur du module.
- **(e)** Le tableau de bord n'est **jamais sur le chemin critique du plan de données** : sa panne
  dégrade la visualisation, jamais le débit de SMS ni la détection d'incident infra.

## Definition of Done

**Elle vit dans `CLAUDE.md`, et nulle part ailleurs.** Elle a été recopiée dans trois documents par le
passé, et deux copies ont continué à prescrire une règle que la troisième avait retirée.

## Conventions transverses

- **Le contrat est la source de vérité.** Le dépôt ne copie jamais un YAML : il consomme le package
  versionné. Tout manque côté passerelle se règle par une PR dans `go-gateway/api/`.
- **Le contrat bouge vite** — dix-sept versions en douze jours, dont trois majeures (relevé le
  08/08/2026). Relever la version disponible **au début de chaque step qui le touche**, jamais au
  milieu. Voir `plan.md` §1.12.
- **Mock-first.** Chaque écran se développe contre le mock Prism ; l'intégration réelle n'est requise
  que pour les steps qui le disent.
- **Langue.** Code en **anglais**, narratif en **français** — commentaires, scénarios Gherkin, copie.
  Un libellé français peut tenir lieu d'identifiant technique, jamais le remplacer : la valeur
  verbatim reste affichée à côté, en mono et atteignable au clavier. Voir la charte.
- **Commentaires avec parcimonie** : seulement là où le code ne peut pas parler. Voir `plan.md` §1.7.
- **Cinq états de contenu** partout : chargement · vide · aucun résultat · module désactivé · erreur.
  Jamais un blanc, jamais une erreur déguisée en vide.

---

## M0 — Fondations & double toolchain
- [x] step-000 — Socle Go : module, `cmd/dashboard`, chi, configuration validée au démarrage, arrêt propre
- [x] step-001 — SPA Vite + TanStack Router : squelette d'application, coquille peinte au chargement à froid
- [x] step-002 — Binaire unique : `embed.FS` + fallback SPA **ordonné après `/api`**
- [x] step-003 — Contrat Admin : `oapi-codegen`, client Go (OAuth2 + mTLS), mock Prism
- [x] step-009 — Contrat Admin en **4.0.2** : deux majeures depuis 2.5.0, diff du YAML relu §
- [x] step-004 — Contrat BFF : `api/openapi-bff.yaml` → types serveur Go **et** types client TS ‡
- [x] step-005 — PostgreSQL : `pgx`, migrations, les tables du §3.1, `audit_log` partitionné
- [x] step-006 — Catalogue de permissions : source Go, génération TS, test de divergence bloquant
- [x] step-007 — Harnais BDD : `godog`, `testify`, testcontainers, Vitest, Playwright, CI à deux toolchains
- [x] step-008 — Charte : tokens portés de la v1.0, `/_design`, contraste AA vérifié

§ **Numéro hors bloc, position délibérée — et le pari a tenu.** step-003 s'est arrêtée à 2.5.0 parce
que la quarantaine de `minimumReleaseAge` refusait plus récent ; elle a expiré d'elle-même
(`plan.md` §1.12). La step est passée avant que M0 n'engendre du code contre 2.5.0, et c'est ce qui a
rendu le bump gratuit : **livré le 08/08/2026, il n'a touché aucun appelant** — les six opérations que
les deux majeures modifient ne sont appelées nulle part, et `go build` est resté vert sur trois
ruptures de type. Payé sur le seul `internal/gateway/client.gen.go`, comme annoncé.

*(La version épinglée est **4.0.2** et non 4.0.0 : les trois `openapi-admin.yaml` de la série 4.0.x
sont identiques au sha256, et 4.0.3 était en quarantaine. Voir `steps/done/step-009.md`, DN-1.)*

‡ **step-004 est passée devant step-009, et la position ci-dessus est restée la bonne.** Mesuré le
02/08 à 09:26 UTC : la quarantaine de 4.0.0 courait jusqu'à 17:46 UTC et `pnpm` la refusait encore —
step-009 était matériellement infaisable. step-004 ne dépendait pas d'elle et n'engendrait aucun code
contre le contrat Admin, donc l'argument du renvoi § n'était pas entamé. Vérifié à la livraison : ce
qui restait à payer au bump n'avait effectivement pas grossi.

## M1 — Authentification, permissions & audit  (§6.9, §6.10, §3.1)
- [x] step-020 — Seed auth : les 44 clés de permission et les 9 rôles par défaut, idempotent ¶
- [x] step-021 — Login email/mot de passe (**argon2id**) + anti-brute-force partagé entre instances
- [x] step-022 — Session BFF (cookie signé) + `/auth/me` + `/auth/logout`
- [ ] step-023 — MFA TOTP : enrôlement, vérification, codes de récupération
- [ ] step-024 — MFA WebAuthn / passkey
- [ ] step-025 — `RequirePermission` + journal d'audit + MFA obligatoire  *(invariant c)*
- [ ] step-026 — DTO de sortie déclarés partout + test bloquant  *(invariant a, moitié structurelle)*
- [ ] step-027 — Écrans Login & MFA, branchés sur le BFF Go †
- [ ] step-028 — Écran d'enrôlement du second facteur †
- [ ] step-029 — Gestion des opérateurs et des rôles †

† **Ces trois steps s'exécutent après `041`, `042` et `040` de M2**, dans cet ordre :

```
M2 · 041  primitives lot 1  →  M2 · 042  overlays + cinq états
                            →  M2 · 040  AppShell (+ usePermission / PermissionGate)
                            →  M1 · 027  login, MFA, garde de route
                            →  M1 · 028  enrôlement du second facteur
                            →  M1 · 029  opérateurs & rôles
```

Ce sont des écrans, et ils reposent sur des fondations qui vivent en M2. La v1.0 avait annoncé
« M1 entier avant M2 » et cet ordre était **littéralement inexécutable** : l'écran de login déclarait
dépendre des primitives et des cinq états. La leçon est conservée telle quelle.

`step-028` avant `step-029` : la v1.0 avait rendu le second facteur obligatoire alors qu'aucun écran ne
permettait de l'enrôler — le premier administrateur se serait connecté, serait arrivé au challenge, et
n'aurait eu aucun moyen d'en sortir. **Administrer des opérateurs suppose d'abord de pouvoir entrer.**

`usePermission` / `PermissionGate` sont livrés par **`step-040`** et non par `step-027` : le rail de
navigation filtre ses entrées par permission dès qu'il existe. La `step-027` les **consomme** et porte
la règle de la charte : un contrôle interdit est désactivé et expliqué, jamais masqué.

¶ **Les `CREATE TABLE` appartiennent à step-005, pas à celle-ci.** Cette ligne s'intitulait « Schéma
auth » et revendiquait les mêmes tables que la fiche de step-005, qui ne lui cédait que le seed. Le
partage est tranché dans ce sens parce que le test exigé par step-005 — « base vierge, migrations
jouées, le schéma attendu existe » — est infalsifiable si les tables d'authentification n'y sont pas.
step-020 hérite donc d'un schéma déjà en place, et porte en plus la **vérification de version du
schéma au démarrage** : c'est la première step qui lit la base, donc la première où refuser de servir
sur un schéma en retard protège quelque chose. *(Arbitré le 02/08/2026, au début de step-005.)*

## M2 — Coquille applicative & temps réel  (§4.1, §4.2, §5.2)

> **Les trois premières steps précèdent les trois dernières de M1** (voir † ci-dessus), et entre elles
> l'ordre est `041 → 042 → 040` : l'AppShell consomme les primitives et les cinq états de contenu, il
> ne les précède pas.

- [ ] step-041 — Primitives lot 1 portées : bouton, champ, select, pilule de statut, tabs, table
- [ ] step-042 — Primitives lot 2 portées : dialog, menu, tooltip, toast + les cinq états de contenu
- [ ] step-040 — AppShell : rail, barre supérieure, arborescence de routes en états vides
- [ ] step-043 — Hub WebSocket Go : trois flux passerelle agrégés en une socket client
- [ ] step-044 — HA : bail Redis + Pub/Sub entre instances, bascule automatique
- [ ] step-045 — Client WS React : abonnement par sujet, reconnexion, `isLive` / `isStale`
- [ ] step-046 — Centre de notifications persisté
- [ ] step-047 — Arrêt propre : drain des sockets, déploiement roulant sans session perdue

## M3 — Clients, comptes SMPP & identifiants  (§6.14, §6.15)
- [ ] step-060 — Groupes de clients : CRUD + filtre transverse ← **première route du BFF qui appelle
      la passerelle** : elle porte l'extension du DTO `errorResponse` avec `errors[]` (§1.4), que
      step-003 avait laissée « en attente de la route qui la servira » en pointant à tort step-004
- [ ] step-061 — Clients : liste, filtres, création  ← **la tranche verticale est acquise ici**
- [ ] step-062 — Fiche client : identité, statut, suspension en cascade, sender IDs
- [ ] step-063 — Comptes SMPP : liste + création rattachée au client
- [ ] step-064 — Fiche compte : canaux, politique de sender ID, bascules SMPP, webhooks
- [ ] step-065 — Quotas, limites de débit et `max_sessions` (avertissement d'écart)
- [ ] step-066 — Identifiants : deux cartes masquées, secret une fois, rotation, révocation  *(invariant b)*

## M4 — Exploitation temps réel : trafic, connecteurs, sessions  (§6.3, §6.5)
- [ ] step-080 — Trafic : instantané REST, widgets et graphiques
- [ ] step-081 — Trafic : flux WS + bascule de plage (5 min / 1 h / 24 h)
- [ ] step-082 — Trafic : ventilations connecteur/client/compte/groupe + drill-down CDR
- [ ] step-083 — Connecteurs : CRUD à divulgation progressive, pool de binds, reconnexion
- [ ] step-084 — Connecteurs : santé par bind — `link_status` vs `breaker_state` — et rebind
- [ ] step-085 — Moniteur de sessions : table virtualisée + deltas WS
- [ ] step-086 — Sessions : déconnexion forcée + écart `max_sessions`

## M5 — CDR Explorer & trace  (§6.4, §6.12)
- [ ] step-100 — Recherche CDR : filtres, curseur, table virtualisée + vues sauvegardées
- [ ] step-101 — Fiche message composée côté BFF
- [ ] step-102 — Visualiseur de trace (cascade de spans)
- [ ] step-103 — Corps du message gardé par `content:read` + journal des accès  *(invariant a)*
- [ ] step-104 — Export CSV asynchrone gouverné ◊

◊ **Le jeton machine ne porte pas le scope que ces opérations exigent, et rien ne le dira.** Le contrat
exige `cdr:export_bulk` sur `create-message-export` et `get-message-export` (depuis la 4.0.0), et
`msisdn:reveal` pour un export non masqué. `internal/gateway/client.go` n'en demande aucun des deux :
step-009 l'a constaté et a **choisi** de ne pas élargir le jeton machine pour du code qui n'existait
pas encore. oapi-codegen n'engendrant rien du `security`, le symptôme sera un **403 de la passerelle**
sur du code qui compile — et le réflexe sera de chercher du côté de `RequirePermission()`, puisque
`cdr:export_bulk` est **aussi** une permission BFF (§6.10). Deux objets homonymes, deux couches : le
403 vient du jeton sortant, pas de la garde entrante. Décider en connaissance de cause, et corriger
au passage le manque amont — `cdr:export_bulk` est exigé par le contrat sans y être catalogué.

## M6 — Routage & scripts  (§6.1, §6.2, §6.7, §6.13)
- [ ] step-120 — Routes : table par priorité + réordonnancement souris et clavier
- [ ] step-121 — Éditeur de route : conditions, stratégie, cibles, route de repli
- [ ] step-122 — Simulateur de route + bandeau de précédence
- [ ] step-123 — Routage par numéro exact : CRUD, lookup, import MNP en masse
- [ ] step-124 — Éditeur Monaco : contrat `resolveRoute`, validation, test contre payload
- [ ] step-125 — Scripts : versions, publication, retour arrière, portée, santé en direct
- [ ] step-126 — Règles de réécriture de sender ID : CRUD + test

## M7 — Conformité : opt-out, numéros entrants, anti-spam  (§6.6, §6.7, §6.16)
- [ ] step-140 — Suppressions : liste scopée par canal + origine
- [ ] step-141 — Suppressions : création, import en masse, mots-clés par pays
- [ ] step-142 — Outil « pourquoi ce message a-t-il été bloqué ? » + avertissement structurel
- [ ] step-143 — Levée de suppression (`suppressions:delete`, confirmation, audit)
- [ ] step-144 — Numéros entrants : CRUD, affectation, mots-clés
- [ ] step-145 — File « MO non routés » + création de règle à la volée
- [ ] step-146 — Anti-spam : CRUD, test, file de revue, tendance de réputation

## M8 — Facturation, contenu & RGPD  (§6.11, §6.18)
- [ ] step-160 — Facturation : proxy fin + dégradation « module désactivé »
- [ ] step-161 — Solde MT vs compteur MO, `balance_scope`, grand livre
- [ ] step-162 — Recharge, transfert, changement de `balance_scope`
- [ ] step-163 — Plans tarifaires & fournisseurs de facturation (test de connexion)
- [ ] step-164 — Politique de contenu : plateforme et par client
- [ ] step-165 — Effacement du contenu seul (crypto-shred) + rotation de clé
- [ ] step-166 — Effacement RGPD (client / MSISDN) + suivi de job + attestation

## M9 — Alerting, audit & mise en production  (§6.8, §1.2, §4.1)
- [ ] step-180 — `alert_rules` : CRUD + UI de configuration
- [ ] step-181 — Webhook Alertmanager entrant + distribution des notifications
- [ ] step-182 — Évaluateur Go sur source durable à offset persisté
- [ ] step-183 — Réconciliation Alertmanager  ⚠️ **bloqué : surface absente du contrat**
- [ ] step-184 — Journal d'audit : écran de consultation
- [ ] step-187 — Rétention : partitions d'`audit_log` détachées, sessions mortes purgées ‡
- [ ] step-185 — Accessibilité WCAG 2.1 AA + cinq parcours Playwright contre le binaire
- [ ] step-186 — Déploiement HA (≥2 instances, affinité WS), **nonce CSP par requête**, durcissement

‡ Son numéro ne suit pas sa position, parce que **l'ordre de cette liste fait foi, pas le numéro**.
Elle se lit après l'écran de consultation et doit précéder la mise en production, qui ne doit pas
partir sans propriétaire de rétention. Elle est en revanche **indépendante de step-185**.

---

## Tout se réécrit

Le code de la v1.0 a été entièrement supprimé le 01/08/2026, client React compris. Aucune step ne
« porte » quoi que ce soit : la charte (`.claude/skills/sms-gateway-design/`) est la référence
visuelle, et les écrans se réécrivent contre elle.

**Six défauts d'outillage ont coûté trois steps à la première tentative, et sont désormais inscrits
dans les steps qui les rencontrent** — voir `plan.md` §2.1. Le plus coûteux d'entre eux n'était
observable que dans un run de CI : pousser tôt vaut mieux que relire.

---

## Écarts connus entre la spec et le contrat

À traiter par une PR dans `go-gateway/api/` — jamais par un contournement ici.

| Écart | Impact | Step concernée |
|---|---|---|
| §6.8 prévoit que le tableau de bord écrive la config Alertmanager « via l'API Admin », mais **aucune opération Alertmanager n'existe** au contrat. | Write-through et réconciliation non implémentables. | step-183 (bloquée), step-180 (dégradée) |
| `suspend-smpp-account` est déclarée au contrat mais **non implémentée** ; la suspension passe par `update-smpp-account` (PATCH `status`). | L'UI utilise le PATCH tant que l'opération n'est pas livrée. | step-063, step-064 |
| Pas de lecture unitaire de CDR : la fiche d'un message se **compose** côté BFF (`search-messages` filtré + `get-message-trace`). | Composition et cache à la charge du BFF. | step-101 |
| L'API Admin s'authentifie en **OAuth2 client_credentials + mTLS** avec un jeton *machine* portant des scopes fixes, dont `content:read`. | Seul le BFF peut restreindre la lecture de corps par opérateur — d'où l'invariant (c). | step-003, step-025, step-103 |
| **62 des 133 opérations du contrat ne sont pas encore implémentées** côté passerelle. | M2, M4, M5 et M8 se développent contre le mock ; une passe d'intégration réelle par jalon. | `plan.md` §16 |
