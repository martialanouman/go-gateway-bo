# Découpage en steps — Tableau de bord Admin (BFF Go + SPA React)

Dérivé de `plan.md`, lui-même dérivé de `../docs/specification-technique-tableau-de-bord.md` (v2.1).
**Un fichier `steps/step-NNN.md` = une PR** : petite, reviewable, laisse le dépôt vert une fois
mergée. Découpage par jalon (M0…M9) ; numérotation par blocs de 20, pour laisser de la marge
d'insertion.

**L'ordre de cette liste fait foi, pas le numéro** — sauf quand la ligne « Dépend de » d'un fichier de
step le contredit : **les dépendances déclarées priment toujours**. Les sections groupent par jalon
**et par phase** — un jalon peut se clore après le début du suivant, et `M1` le fait : ses écrans
reposent sur la coquille de `M2`. D'où deux sections `M1` et deux sections `M2`, et **plus aucune note
qui déplace une ligne** : la séquence se lit de haut en bas, telle qu'elle s'exécute. **Une ligne
cochée est à la place où elle est passée**, pas à celle qu'on lui avait prévue — la liste est un plan
devant, un enregistrement derrière.
`TestAucuneStepNEstListeeAvantUneDontElleDepend` confronte les deux règles — il refuse une step listée
avant une step dont sa fiche déclare dépendre.

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
| WebAuthn | `go-webauthn/webauthn` | v0.18.0 |
| TOTP | `pquerna/otp` | v1.5.0 |
| Redis Pub/Sub | `redis/go-redis/v9` | v9.21.0 |
| Hachage | `golang.org/x/crypto/argon2` | — |
| Assets embarqués | `embed` (stdlib) | — |
| **BDD** | `cucumber/godog` + `stretchr/testify` | v0.16.0 / v1.12.1 |
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
- **Aucun commentaire évident** : du code auto-documenté, et des commentaires réservés au *pourquoi*.
  Voir `plan.md` §1.7.
- **Cinq états de contenu** partout : chargement · vide · aucun résultat · module désactivé · erreur.
  Jamais un blanc, jamais une erreur déguisée en vide.

---

## M0 — Fondations & double toolchain
- [x] step-000 — Socle Go : module, `cmd/dashboard`, chi, configuration validée au démarrage, arrêt propre
- [x] step-001 — SPA Vite + TanStack Router : squelette d'application, coquille peinte au chargement à froid
- [x] step-002 — Binaire unique : `embed.FS` + fallback SPA **ordonné après `/api`**
- [x] step-003 — Contrat Admin : `oapi-codegen`, client Go (OAuth2 + mTLS), mock Prism
- [x] step-004 — Contrat BFF : `api/openapi-bff.yaml` → types serveur Go **et** types client TS
- [x] step-005 — PostgreSQL : `pgx`, migrations, les tables du §3.1, `audit_log` partitionné
- [x] step-006 — Catalogue de permissions : source Go, génération TS, test de divergence bloquant
- [x] step-007 — Harnais BDD : `godog`, `testify`, testcontainers, Vitest, Playwright, CI à deux toolchains
- [x] step-009 — Contrat Admin en **4.0.2** : deux majeures depuis 2.5.0, diff du YAML relu §
- [x] step-008 — Charte : tokens portés de la v1.0, `/_design`, contraste AA vérifié

§ **Numéro hors bloc, et position tenue par les faits.** Le bloc M0 est `000-019` ; `009` a été
insérée après coup pour solder une dette de contrat, et **planifiée juste après `003`**. Elle n'y est
pas passée : mesuré le 02/08 à 09:26 UTC, la quarantaine `minimumReleaseAge` de la 4.0.0 courait
jusqu'à 17:46 UTC et `pnpm` la refusait encore — la step était matériellement infaisable ce jour-là.
Elle a été mergée le **08/08/2026 à 17:23 UTC**, entre `007` et `008`, et c'est la place qu'elle
occupe ici.

**Le pari a tenu quand même.** step-003 s'était arrêtée à 2.5.0 pour cette même quarantaine ; ce qui
comptait était que le bump passe avant que M0 n'engendre du code contre 2.5.0, non qu'il passe un jour
donné. `step-004` ne dépendait pas de `009` et n'engendrait aucun code contre le contrat Admin :
l'argument du renvoi n'était pas entamé, et ce qui restait à payer n'a pas grossi. Vérifié à la
livraison — **le bump n'a touché aucun appelant** : les six opérations que les deux majeures modifient
ne sont appelées nulle part, `go build` est resté vert sur trois ruptures de type, et tout s'est payé
sur le seul `internal/gateway/client.gen.go`.

*(La version épinglée est **4.0.2** et non 4.0.0 : les trois `openapi-admin.yaml` de la série 4.0.x
sont identiques au sha256, et 4.0.3 était en quarantaine. Voir `steps/done/step-009.md`, DN-1.)*

*Jusqu'au 01/09/2026 cette ligne était écrite entre `003` et `004` — la place qu'elle **aurait dû**
occuper — et une note ‡ rattrapait l'écart. Deux notes racontaient donc l'ordre au lieu que la liste
le montre, et le marqueur ‡ servait déjà à autre chose en M9.*

## M1 (serveur) — Authentification, permissions & audit  (§6.9, §6.10, §3.1)
- [x] step-020 — Seed auth : les 44 clés de permission et les 9 rôles par défaut, idempotent ¶
- [x] step-021 — Login email/mot de passe (**argon2id**) + anti-brute-force partagé entre instances
- [x] step-022 — Session BFF (cookie signé) + `/auth/me` + `/auth/logout`
- [x] step-023 — MFA TOTP : enrôlement, vérification, codes de récupération
- [x] step-024 — MFA WebAuthn / passkey
- [x] step-025 — `RequirePermission` + journal d'audit + MFA obligatoire  *(invariant c)*
- [x] step-026 — DTO de sortie déclarés partout + test bloquant  *(invariant a, moitié structurelle)*
- [x] step-031 — Durcissement M1 : ce que la revue garde seule ◊◊
- [x] step-032 — Le harnais de test : conteneur, délai godog, authentificateur épinglé ◊◊

◊◊ **Deux steps ajoutées le 31/08/2026, et leur numéro ne suit pas leur position** — l'ordre de cette
liste fait foi. Elles ne dépendent d'aucun écran et paient des dettes du code déjà livré. Le bloc M1
est `020-039` ; `030` porte les écrans de `step-029` depuis la coupe du 23/09/2026. Précédent : `step-009`, insérée
après coup pour solder une dette de contrat.

¶ **Les `CREATE TABLE` appartiennent à step-005, pas à celle-ci.** Cette ligne s'intitulait « Schéma
auth » et revendiquait les mêmes tables que la fiche de step-005, qui ne lui cédait que le seed. Le
partage est tranché dans ce sens parce que le test exigé par step-005 — « base vierge, migrations
jouées, le schéma attendu existe » — est infalsifiable si les tables d'authentification n'y sont pas.
step-020 hérite donc d'un schéma déjà en place, et porte en plus la **vérification de version du
schéma au démarrage** : c'est la première step qui lit la base, donc la première où refuser de servir
sur un schéma en retard protège quelque chose. *(Arbitré le 02/08/2026, au début de step-005.)*

## M2 (interface) — Primitives portées & coquille applicative  (§4.1, §4.2)

> L'ordre est `041 → 042 → 048 → 040` : l'AppShell consomme les primitives et les cinq états de
> contenu, il ne les précède pas, et `048` rend leurs tests capables de rougir avant qu'elle les monte.

- [x] step-041 — Primitives lot 1 portées : bouton, champ, select, pilule de statut, tabs, table
- [x] step-042 — Primitives lot 2 portées : dialog, toast + les cinq états de contenu †
- [x] step-048 — Filet des primitives : toasts, classes peintes, états, gardes de câblage ◊◊◊
- [x] step-040 — AppShell : rail, barre supérieure, arborescence de routes en états vides

† **`menu` et `tooltip` ont quitté cette ligne le 08/09/2026**, en écrivant la fiche. Le kit de la
charte n'en porte aucun des deux, et son *open item* 4 désigne lui-même `step-084` comme la première
step que la règle des identifiants contraint. Aucun consommateur avant elle : `step-041` affiche
l'identifiant en mono sans substitution, et le rail de `step-040` est libellé seul, sans icône. Ce
qui manquait n'était pas le comportement — `@base-ui/react` exporte les deux — mais la référence
visuelle, et on ne la dessine pas à l'aveugle. Détail dans `steps/step-042.md`, « Hors périmètre ».

## Durcissement — constats de l'audit du 16/09/2026  (M1)

- [x] step-033 — Audit atomique des actions locales  *(invariant c)*
- [x] step-034 — Verrous d'essais sous concurrence, coût d'argon2id borné
- [x] step-035 — Filet de mutation M1, refus qui nomment ce qui manque
- [x] step-036 — Durcissement HTTP et configuration : origine des mutations, en-têtes, échéance
- [x] step-037 — Élagage
- [x] step-038 — Commentaires : corriger les faux, ramener les blocs

◊◊◊ **Sept steps issues de l'audit du 16/09/2026**, placées avant les écrans de M1 : `step-029` ajoute
des mutations qui doivent naître avec l'audit transactionnel de `033`, `step-027` est le premier écran
à envoyer un `POST` et suppose le contrôle d'origine de `036`, et `step-040` monte les toasts que `048`
teste. Les numéros sont les derniers libres des blocs M1 (`030` alors réservé) et M2. Chaque constat
est au registre des dettes ci-dessous, avec sa step.

## M1 (écrans) — Login, MFA, opérateurs & rôles  (§6.9, §6.10, §5.1)

**M1 se clôt ici, après le début de M2 — et cette section existe pour que la liste le montre, au lieu
de l'annoter.** Ce sont des écrans : ils reposent sur les primitives (`041`), les cinq états de
contenu (`042`) et la coquille (`040`). La v1.0 avait annoncé « M1 entier avant M2 » et cet ordre
était **littéralement inexécutable** — l'écran de login déclarait dépendre des primitives et des cinq
états.

*Jusqu'au 01/09/2026, ces trois lignes vivaient dans la section M1 au-dessus de M2, et une note les
renvoyait ici. Lire la liste dans l'ordre — ce que ce document demande en toutes lettres — rendait
donc une séquence fausse sur **cinq positions**, et seule la ligne « Dépend de » de `step-027.md`
rattrapait l'erreur. Les trois steps de M2 qui la précèdent n'avaient alors pas de fiche : pour
elles, rien ne l'aurait rattrapée. **Elles en ont une depuis le 08/09/2026**, et la porte les lit —
vérifié en inversant une dépendance dans chacun des trois en-têtes.*

- [x] step-027 — Écrans Login & MFA, branchés sur le BFF Go
- [x] step-049 — Socle de formulaires : React Hook Form, Zod engendré, `Field` en adaptateur ¤
- [x] step-028 — Écran d'enrôlement du second facteur
- [x] step-029 — Gestion des opérateurs et des rôles : les routes du BFF
- [x] step-030 — Écrans Opérateurs et Rôles
- [ ] step-050 — Lien d'accès à usage unique : activation et réinitialisation par e-mail
- [ ] step-039 — Les facteurs de son propre compte

¤ **`step-049` porte un numéro du bloc M2 et se lit ici** — l'ordre de cette liste fait foi. C'est un
socle de primitives, pas un écran, et il doit précéder les **deux** écrans de formulaire qui restent
à M1 : sans lui, `step-028` et `step-029` écrivent une deuxième et une troisième fois le cousu main
de `step-027`, et la migration coûte trois écrans au lieu de deux. Elle est née du constat que les
bornes du contrat — `maxLength` en tête — **n'atteignent pas le client** : `openapi-typescript` les
jette, le serveur les redit à la main, et le contrôle de format livré par `step-027` avait inventé sa
règle. *(Arbitré le 20/09/2026, en revue de `step-027`.)*

`step-028` avant `step-029` : la v1.0 avait rendu le second facteur obligatoire alors qu'aucun écran ne
permettait de l'enrôler — le premier administrateur se serait connecté, serait arrivé au challenge, et
n'aurait eu aucun moyen d'en sortir. **Administrer des opérateurs suppose d'abord de pouvoir entrer.**

`usePermission` / `PermissionGate` sont livrés par **`step-040`** et non par `step-027` : le rail de
navigation filtre ses entrées par permission dès qu'il existe. La `step-027` les **consomme** et porte
la règle de la charte : un contrôle interdit est désactivé et expliqué, jamais masqué.

## M2 (temps réel) — Hub WebSocket, HA, notifications  (§5.2)
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
| **30 des 133 opérations du contrat ne sont pas encore implémentées** côté passerelle. | M3, M4, M6 et M8 se développent en partie contre le mock ; une passe d'intégration réelle par jalon. | `plan.md` §16 |


---

## Dettes payées

**Les dettes ouvertes ne vivent plus ici : elles sont dans [`debts/`](../debts/), une par fichier.**
Ce tableau garde celles qui étaient déjà soldées au moment de la bascule — le déplacer aurait fait un
dossier dont deux fichiers sur cinq n'auraient été que de l'archive.

Pourquoi la forme a changé : une ligne retirée d'un tableau de plusieurs centaines de lignes ne se
voit pas en revue. Un plancher sur le nombre de lignes tentait de le tenir, mais il était prélevé sur
la donnée même qu'il gardait — il valait 60 pour 80 lignes le jour où on l'a remesuré. Un fichier
supprimé, lui, apparaît nommément dans un diff.

`debts/README.md` porte la convention ; `internal/bddtest/porteurs_test.go` la tient.

| Dette | Effet si elle dure | Porteur |
|---|---|---|
| ~~Trois comparaisons à temps constant ne sont gardées que par la revue : `hmac.Equal` du sceau de cookie, la boucle non court-circuitée des codes de récupération, `subtle.ConstantTimeCompare`.~~ | Remesuré les 30 et 31/08/2026, **les trois séparément** : les remplacer par une comparaison naïve laisse à chaque fois **les quatorze paquets verts**. Un refactor bien intentionné rouvre un oracle temporel sans un seul test rouge. **Payée** : trois portes structurelles nominatives, une par paquet, chacune vue rouge par sa mutation. | step-031 |
| ~~`minimumTOTPEncryptionKeyLength` compte des **caractères**, pas de l'entropie.~~ | « Trente-deux `a` de suite passent. » Le README recommande un CSPRNG ; rien ne l'applique. C'est la clé qui chiffre les secrets TOTP au repos. **Payée** : borne de variété — douze symboles distincts — dans `requiredSecret`, donc sur les trois secrets, pas seulement celui-ci. | step-031 |
| ~~Trois branches de course ne sont exercées par rien : `!consumed`, `!elevated` de `VerifyMfa`, `!found` de l'enrôlement.~~ | Des chemins de sécurité atteignables par deux requêtes en vol, dont rien ne dit qu'ils refusent. **Payée par un constat mesuré**, la troisième issue que la DoD accepte : les trois refus se neutralisent sans un seul rouge, et la couverture ne peut pas le dire — les scénarios lancent le binaire en sous-processus. | step-031 |
| ~~**62 des 133 opérations du contrat** ne sont pas implémentées côté passerelle — ratio mesuré le 27/07/2026, **jamais revérifié depuis**.~~ **Relevé le 12/09/2026 : 30 sur 133.** | L'amont avait avancé de 32 opérations. **M2 et M5 cessent d'être des jalons sur mock** — les trois flux du hub WebSocket et les trois opérations du CDR Explorer sont livrées. Restent M3, M4, M6 et M8, ce dernier réduit à la politique de contenu. La contradiction 62/63 entre §16 et §18 s'éteint avec les deux chiffres. Détail dans `plan.md` §16. | ~~step-041~~ ✔ |
| ~~Une constante `Key` déclarée **sans entrée au catalogue** ne fait rougir aucune porte.~~ | « Compile, deux suites vertes, absente du TS engendré. Go ne signale pas une constante exportée inutilisée. » Le catalogue est gardé contre les rôles, pas contre ses propres constantes. **Payée** : `TestAucuneConstanteNeManqueAuCatalogue` part de la portée du paquet, que l'orpheline n'atteint pas. | step-031 |
| ~~Le hachage factice de `VerifyDummy` **en tant qu'appel**, et la cible de durée d'argon2id : aucune porte.~~ | L'oracle d'énumération que le hachage factice ferme repose sur un appel que rien n'exige. **Payée** — la moitié « appel » l'était depuis step-021 sans que le registre le sache ; la cible de durée l'est par un plancher remonté au profil retenu. | step-031 |
| ~~La borne de démarrage du binaire est passée de 5 s à 30 s.~~ | « **Aucun test ne rougit si la valeur revient à 5 s**, vérifié plutôt que supposé. » **Payée** : revenue à 5 s, sur une mesure et non un pari — le démarrage le plus lent de la suite est de 295 ms sur le runner, 504 ms sur un M4 Pro. La mesure qui l'avait élargie décrivait un monde où trois conteneurs démarraient de front, et ce monde n'existe plus. Ce que 30 s coûtaient n'était pas l'attente mais le diagnostic : sur le job en échec de la PR 52, chaque scénario les a attendues pour rien. | step-032 |
| ~~**L'audit d'une action locale s'écrit hors de sa transaction** : `audited` passe par `Record` sur le pool, une fois l'action validée. Enrôlement TOTP, enregistrement et retrait de passkey, élévation, connexion, déconnexion.~~ | Un audit en échec rend 500 et laisse l'action faite, sans trace : avec `replace=true`, l'ancien TOTP est détruit et le nouveau secret jamais montré. Relevé par l'audit du 16/09/2026. **Payée pour cinq des six** : `audited` devient `API.event`, qui ne fait que poser l'adresse ; l'événement entre en paramètre des écritures de `internal/store`, qui l'écrivent dans leur propre transaction (`Sessions.Create`, `Sessions.Elevate`, `MFA.Enroll`, `Webauthn.Register`, `Webauthn.Remove`). Trois scénarios le prouvent, partitions du journal détachées : l'action est refusée et n'a pas eu lieu. **La déconnexion reste dehors, et c'est écrit sur le handler** — un opérateur qui se croit parti et reste connecté court un risque plus grave qu'une déconnexion absente du journal. | step-033 |
| ~~`RecordTx` n'a pas de témoin, les audits de `Logout` et de `passkey.register` ne sont comptés par aucun scénario, et le pas d'adresse ne vérifie que `IS NOT NULL`.~~ | Trois mutations lancées le 16/09/2026 restent vertes : `RecordTx` rend `nil`, l'audit est placé dans un `if false {}`, une adresse forgée constante est écrite. **Payée**, et les trois mutations rougissent désormais : le témoin lit la ligne **dans** la transaction, avant l'annulation (`RecordTx` qui rend `nil` → « la ligne n'a jamais été écrite : l'annulation ne prouve rien ») ; deux scénarios comptent `operator.logout` et `passkey.register` **après** l'action ; le pas d'adresse compare `host(ip_address)` à l'adresse que le décor a présentée (adresse forgée → « l'événement porte l'adresse "203.0.113.9", attendue "127.0.0.1" »). | step-033 |
| ~~**Le verrou d'essais vérifie puis agit** : `LockFor` lit, argon2id tourne, l'échec n'est compté qu'ensuite. Premier et second facteur.~~ | Une rafale franchit le seuil de cinq tout entière : autant d'essais que de requêtes simultanées, TOTP compris pour qui détient le mot de passe. Le commentaire de la migration 00004 est faux sous concurrence. **Payée** : l'essai est réservé atomiquement avant d'être vérifié, sur l'adresse et sur l'opérateur ; trente requêtes simultanées n'en consomment que cinq, mesuré par scénario. | step-034 |
| ~~**Aucune borne de concurrence sur argon2id**, à 64 MiB par vérification, adresse inconnue comprise ; dix vérifications par essai de code de récupération.~~ | Environ deux cents connexions simultanées, sans identifiants, font tuer une instance pour manque de mémoire. **Payée** : dix places partagées par `auth.Hold`, une seule pour les dix hachages d'un code de récupération, et un 503 rédigé quand elles manquent. | step-034 |
| ~~**La seule défense CSRF est `SameSite=Lax`**, et le décodeur engendré accepte un corps JSON en `text/plain`.~~ | Un sous-domaine voisin compromis déclenche les mutations `/api` avec le cookie de l'opérateur, sans pré-vol. **Payée** : contrôle d'origine sur toute méthode non sûre de `/api` — `Sec-Fetch-Site` d'abord, repli sur `Origin`, les deux absents valant refus — et `application/json` exigé dès qu'un corps est annoncé. Les deux vérifications ont été retirées **séparément**, chacune rougissant ses seuls scénarios. | step-036 |
| ~~La coquille, les assets et `/api` sont servis sans `nosniff`, `X-Frame-Options` ni `Referrer-Policy`.~~ | Encadrement par une page du même site ; aucune seconde barrière hors CSP. **Payée** par un seul montage à la racine, donc sans route future à ne pas oublier ; un scénario lit les trois en-têtes sur les trois surfaces. | step-036 |
| ~~Un `DASHBOARD_TRUSTED_PROXIES` absent est accepté en silence.~~ | Derrière le load balancer, cinq mots de passe faux bloquent **tous** les opérateurs quinze minutes, indéfiniment renouvelable. **Payée** : la variable est obligatoire, et `none` est la façon d'écrire « aucun proxy » — vide ne se distinguait pas d'un oubli. Posée dans les quatre décors. | step-036 |
| ~~Aucune échéance ne borne une requête `/api` ; seul `ReadHeaderTimeout` est posé.~~ | Un corps envoyé à un octet par minute tient une goroutine et un descripteur sans limite. **Payée pour le corps** : échéance de lecture de 5 s, scénario à connexion brute, mutation rouge. **Non payée pour la requête entière** : l'échéance de contexte existe — elle ferme l'acquisition au pool, que `pgxpool` ne borne pas — mais la retirer laisse les 95 scénarios verts, mesuré. Le constat est écrit là où elle vit. | step-036 |
| ~~Une URL de configuration rejetée est citée avec ses identifiants ; `DASHBOARD_WEBAUTHN_ORIGIN` accepte `http://` partout ; `DASHBOARD_GATEWAY_MODE=mock` n'est contrôlé par rien.~~ | Un secret part dans les logs ; une erreur de configuration dégrade la production sans que le démarrage le dise. **Les trois payées** : `RedactURL` masque les identifiants côté config **et** côté passerelle ; `http://` n'est accepté que sur une adresse de bouclage ; et `mock` n'est accepté que si la passerelle en est une aussi — ce qui l'empêche d'atteindre la production sans variable supplémentaire. | step-036 |
| ~~**Six gardes de M1 se retirent sans un rouge**~~ : le 401 d'une passkey inconnue, quatre contrôles de forme de `mfa.go`, la panne de résolution de `guard.go:122`, la boucle de `KeepAuditPartitions`, l'échéance de `ConsumeChallenge`, `Strict()` du sceau (vert **trois fois sur quatre** — l'audit annonçait onze sur douze ; refait sur cent mille tirages en step-035). | **Payée.** Dix-sept mutations rejouées le 19/09/2026, chacune vue rouge avec `-count=1` ; le tableau est dans la fiche. Deux chiffres de l'audit ont été refaits et les deux étaient faux. | step-035 |
| ~~**Quatre refus disent autre chose que ce qui s'est passé**~~ : « reconnectez-vous » sur une session élevée, l'horloge TOTP pour une passkey, un 409 de procédure pour un code faux, un 401 pour une cérémonie refusée. | **Payés**, et deux statuts avec eux : la cérémonie refusée passe en 400, la passkey inconnue en 404. Sur **ces deux opérations**, le 401 ne reste que pour une session réellement close. **Le problème survit ailleurs** : `POST /auth/mfa/verify` rend 401 sur cinq sites, dont trois sur une session vivante — un code faux y déconnecte encore, `isUnauthenticated` lisant le statut sans le corps. Hors périmètre de step-035, qui ne portait que les quatre refus de l'audit. | step-035 |
| ~~Le conteneur PostgreSQL des scénarios meurt **parfois** sous la charge.~~ | **Payée par suppression du mécanisme, faute de pouvoir l'être par un réglage** : là où `DASHBOARD_TEST_DATABASE_URL` désigne un serveur — la CI le pose —, il n'y a plus de testcontainers du tout, donc plus trois conteneurs qui démarrent de front sur quatre cœurs, plus de port éphémère par paquet, plus de reaper. Le défaut n'a pu être reproduit ni en local (trois exécutions, dont une à `GOMAXPROCS=4`) ni en CI, et la sonde y a écarté la piste mémoire : 6,2 Gio restaient libres au pire moment. Ce qui est prouvé n'est donc pas « le remède corrige le défaut observé » mais « le mécanisme qui pouvait le produire n'est plus là ». | step-032 |
| ~~Le filet de performance des scénarios n'existe **à aucune valeur** du délai godog.~~ | **Payée** : `cmd/dashboard/performance_test.go` compare la lecture de session à `/api/health`, sonde qui ne touche ni la base ni la passerelle, mesurée en alternance dans le même run — un budget **relatif**, parce qu'un seuil en millisecondes sur un runner partagé rougit au hasard, et qu'une suite qui rougit au hasard cesse d'être lue. Muté : vert à +5 ms, rouge à +10 ms et +30 ms. Le délai du client, lui, redescend de 15 s à 8 s et reste ce qu'il est — une borne anti-suspension. | step-032 |
| ~~`descope/virtualwebauthn` est épinglée sur `go-webauthn v0.16.5`.~~ | **Tranchée : elle reste.** L'épinglage est réel et sans remède ici — il vit dans le `go.mod` de la dépendance, MVS retient 0.18.0, aucun `replace` n'y changerait rien. Ce qui se payait n'était pas la dépendance mais son mode d'échec illisible, et c'est lui qui est corrigé : `internal/mfa/webauthn_test.go` exerce les deux cérémonies sans base, sans HTTP et sans binaire, donc il rougit **avec** les scénarios le jour où la bibliothèque de test ne parle plus au serveur, et reste vert quand c'est le produit. Le repli de DN-12 — 150 lignes de crypto sur un chemin de sécurité — n'est pas pris. | step-032 |
| ~~L'`issuer` de l'URI `otpauth://` est codé en dur.~~ | Deux déploiements du même produit apparaissent sous le même nom dans le téléphone de l'opérateur. **Payée** : `DASHBOARD_PRODUCT_NAME`, obligatoire, lue par un scénario jusqu'au corps servi. | step-031 |
| ~~Le `displayName` WebAuthn est codé en dur.~~ | Même geste que l'`issuer` : une valeur de marque qui appartient à la configuration validée. **Payée** par la même variable — et gardée par un scénario, ce qu'elle n'était par rien : le recoder en dur laissait tout vert. | step-031 |
| ~~`QueryClientProvider` n'est monté ni dans le produit ni dans le harnais.~~ | Assumé : le monter maintenant serait du code sans utilisateur. Déclencheur écrit par step-007 : « la première step qui livrera un `useQuery` ». *(Porteur passé de step-027 à step-040 le 08/09/2026, en écrivant la fiche de step-040 : `usePermission` lit `/auth/me`, donc le déclencheur tire dans la coquille, une step **avant** le premier écran. step-027 reste le premier écran à parler au BFF ; elle n'est plus la première step à le faire.)* **Payée** : `createAppRouter` construit un `QueryClient` par routeur et le fournit par son `Wrap` (`web/src/router.tsx`) — dans le produit, et par la fabrique que les tests de routes empruntent, donc sans provider de harnais. | step-040 |
| ~~L'amortissement de testcontainers n'est pas fait ; `WithReuse` écarté nommément.~~ | **Payée sans rouvrir `WithReuse`** : c'est l'environnement qui désigne le serveur, et rien ne survit entre deux exécutions. Les bases taillées sur un serveur qui, lui, survit sont jetées **au démarrage** de chaque suite et non à la fin — à la fin, les pools qu'un cas n'a pas fermés reconnectent après le `WITH (FORCE)` et retiennent leur base. Compte mesuré stable à 175 sur trois passages, borné à une exécution. | step-032 |
| ~~Le raccourci `font:` réinitialise `font-variant-numeric`.~~ | **Payée par une garde sur le mécanisme, pas sur ses symptômes.** step-041 l'avait rebouchée là où elle mordait — `.ui-table` — et avait écrit que « le mécanisme reste ouvert : six autres règles posent un rôle proportionnel et le réinitialisent tout autant. Aucune ne porte de chiffre aujourd'hui ; un compteur dans un libellé, une plage dans un message d'aide, et la dette revient sans qu'aucune porte ne bouge. » C'est arrivé : les cinq états rendent « (504) » dans un corps de texte. La garde de `test/charte.test.ts` exige désormais `tabular-nums` partout où un rôle **proportionnel** est posé, les neuf rôles étant **dérivés de `typography.css`** plutôt que recopiés. Elle a trouvé **12 règles fautives** dans quatre feuilles ; vue rouge en retirant le correctif local de step-041, qui n'est donc plus le seul porteur. | step-042 |
| ~~La façade `components/ui/index.ts` verse **tout Base UI dans le chunk d'entrée** dès qu'un écran de production importe une seule primitive.~~ | **Dette annulée le 15/09/2026, le jour de son inscription : elle n'existait pas.** La première mesure — entrée à 453,78 Ko (147,44 gzip) via la façade contre 290,60 (93,03) en import profond — était juste, son attribution était fausse. `web/package.json` ne déclarait pas `sideEffects` : Rollup tient alors chaque module de `src/` pour susceptible d'en avoir, et un import depuis un baril tire **tous** ses modules. La déclaration posée, la façade rend **290,60 Ko / 93,03 gzip** — l'import profond à l'octet près —, et les 163 Ko partent dans le chunk de `/_design`, qui est leur place. Total inchangé dans les trois cas. Le script d'entrée n'avait **aucune borne**, ce qui est la raison pour laquelle 163 Ko avaient pu s'y loger sans un rouge ; il en a deux depuis, dans `chargement-a-froid.test.ts`. | **payée — step-042** |
| ~~Des tests de M1 qui ne gardent rien ou affirment faux~~ : « deux bits significatifs sur six » (deux fichiers), `TestLesTroisSecretsNeSeConfondentPas` qui teste un mapping, un test HKDF toujours vrai, « huit migrations » pour neuf ; `processAlive` lit EPERM comme la mort d'un processus. | **Payés.** Les **cinq** porteurs de l'arithmétique fausse corrigés — trois dans le code, deux dans des fiches archivées sous une autre formulation (« deux bits sur six ») que le premier grep ne voyait pas —, les deux tests qui ne gardaient rien renommés ou retirés, `processAlive` corrigé et tenu par un cas qui s'écarte sous root plutôt que de se déclarer vert. | step-035 |
| ~~**Les tests des primitives restent verts** quand la durée critique d'un toast, son `aria-label`, une classe peinte, la phrase d'un état d'erreur ou le câblage du plugin de tokens disparaît ; `useToast` ne passe jamais la priorité haute ; `blocked` n'exige pas d'explication.~~ | Mesuré le 16/09/2026 sur une partie d'entre eux. La coquille de step-040 monterait des primitives que rien ne garde. **Payée** : seize mutations, chacune vue rouge, consignées dans la fiche ; l'`aria-label` était identique au défaut de Base UI et a été retiré. | step-048 |
| ~~Du code sans usage ni consommateur planifié : `Dependencies` recopie `API`, des délégations pures du verrou, `Fields.Number`, un `fs.Stat` refait, trois paquets Prism jamais importés, trois refus morts d'`allowBuilds`.~~ | **Payée**, et un second audit du 19/09/2026 l'a élargie : quatre délégations de verrou au lieu de trois, `itoa`, l'alias `errorResponse`, `OwnerRole`, `Bootstrap.Complete`, `isTrusted`, le service `redis`, `page.tsx` et quatre props de primitives. Les onze tests qui ne tenaient qu'aux méthodes mortes basculent sur l'API vivante — qui n'avait aucun test —, trois mutations à l'appui. **Trois coupes annoncées sont écartées avec leur mesure** : la fusion `migrate`/`bootstrap` ferait disparaître les deux cibles de `make help`, les 74 tokens CSS sans `var()` sont un port de la charte, et les bornes du verrou goose figent contre une dérive amont. | step-037 |
| ~~**Onze commentaires faux**, et 29,8 % des lignes non vides en commentaires, dont 292 blocs de plus de huit lignes.~~ | Un commentaire faux se croit plus volontiers que le code ; un bloc de cinquante lignes ne se relit plus. **Payée** : les onze corrigés, plus douze autres trouvés en chemin — dont quatre qui ne surplombaient pas leur code. 28,7 % → 27,5 %, soit −626 lignes. **La cible de 24 % de l'audit était fausse** : posée sans déduire le noyau que le critère 4 protège, elle demanderait de retirer les constats « aucun test ne rougit si ceci disparaît ». L'écart est étayé dans la fiche. | step-038 |
