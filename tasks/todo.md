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
- **Commentaires avec parcimonie** : seulement là où le code ne peut pas parler. Voir `plan.md` §1.7.
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
- [ ] step-032 — Le harnais de test : conteneur, délai godog, authentificateur épinglé ◊◊

◊◊ **Deux steps ajoutées le 31/08/2026, et leur numéro ne suit pas leur position** — l'ordre de cette
liste fait foi. Elles ne dépendent d'aucun écran et paient des dettes du code déjà livré. Le bloc M1
est `020-039` ; `030` reste réservé au plan de coupe de `step-029`. Précédent : `step-009`, insérée
après coup pour solder une dette de contrat.

¶ **Les `CREATE TABLE` appartiennent à step-005, pas à celle-ci.** Cette ligne s'intitulait « Schéma
auth » et revendiquait les mêmes tables que la fiche de step-005, qui ne lui cédait que le seed. Le
partage est tranché dans ce sens parce que le test exigé par step-005 — « base vierge, migrations
jouées, le schéma attendu existe » — est infalsifiable si les tables d'authentification n'y sont pas.
step-020 hérite donc d'un schéma déjà en place, et porte en plus la **vérification de version du
schéma au démarrage** : c'est la première step qui lit la base, donc la première où refuser de servir
sur un schéma en retard protège quelque chose. *(Arbitré le 02/08/2026, au début de step-005.)*

## M2 (interface) — Primitives portées & coquille applicative  (§4.1, §4.2)

> L'ordre est `041 → 042 → 040` : l'AppShell consomme les primitives et les cinq états de contenu, il
> ne les précède pas.

- [ ] step-041 — Primitives lot 1 portées : bouton, champ, select, pilule de statut, tabs, table
- [ ] step-042 — Primitives lot 2 portées : dialog, menu, tooltip, toast + les cinq états de contenu
- [ ] step-040 — AppShell : rail, barre supérieure, arborescence de routes en états vides

## M1 (écrans) — Login, MFA, opérateurs & rôles  (§6.9, §6.10, §5.1)

**M1 se clôt ici, après le début de M2 — et cette section existe pour que la liste le montre, au lieu
de l'annoter.** Ce sont des écrans : ils reposent sur les primitives (`041`), les cinq états de
contenu (`042`) et la coquille (`040`). La v1.0 avait annoncé « M1 entier avant M2 » et cet ordre
était **littéralement inexécutable** — l'écran de login déclarait dépendre des primitives et des cinq
états.

*Jusqu'au 01/09/2026, ces trois lignes vivaient dans la section M1 au-dessus de M2, et une note les
renvoyait ici. Lire la liste dans l'ordre — ce que ce document demande en toutes lettres — rendait
donc une séquence fausse sur **cinq positions**, et seule la ligne « Dépend de » de `step-027.md`
rattrapait l'erreur. Les trois steps de M2 qui la précèdent n'ont pas encore de fiche : pour elles,
rien ne l'aurait rattrapée.*

- [ ] step-027 — Écrans Login & MFA, branchés sur le BFF Go
- [ ] step-028 — Écran d'enrôlement du second facteur
- [ ] step-029 — Gestion des opérateurs et des rôles

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
| **62 des 133 opérations du contrat ne sont pas encore implémentées** côté passerelle. | M2, M4, M5 et M8 se développent contre le mock ; une passe d'intégration réelle par jalon. | `plan.md` §16 |


---

## Dettes ouvertes

**Écrites dans les fiches qui les ont créées, et rappelées ici parce qu'« une fiche archivée n'est
ouverte par personne »** — la phrase est du dépôt, écrite trois fois. Jusqu'au 31/08/2026 le mot
« dette » n'apparaissait **pas une seule fois dans ce fichier**, et une seule fois dans `plan.md`
(§1.12, pour en déclarer une **soldée**). Les **soixante-trois** lignes ci-dessous vivaient dans
dix-sept fiches de `steps/done/`, dans `plan.md` §18-19, et dans des commentaires de code.

Treize d'entre elles manquaient à la première rédaction de ce registre — dont le trou d'audit du
proxy et l'absence de vérification d'attestation WebAuthn. Un registre qui se déclare complet et ne
l'est pas enseigne qu'il faut aller voir ailleurs, ce qui est exactement le défaut qu'il corrige.

Le registre est **complet, pas sélectif** : un registre partiel enseigne qu'il faut aller voir
ailleurs. Une dette payée se **barre sur place**, jamais ne s'efface — une ligne effacée se rouvre en
silence. `TestChaqueDetteNommeUnPorteurQuiExisteEtResteAFaire` refuse un porteur qui n'existe pas et
un porteur déjà coché.

### Sécurité et correction

| Dette | Effet si elle dure | Porteur |
|---|---|---|
| ~~Trois comparaisons à temps constant ne sont gardées que par la revue : `hmac.Equal` du sceau de cookie, la boucle non court-circuitée des codes de récupération, `subtle.ConstantTimeCompare`.~~ | Remesuré les 30 et 31/08/2026, **les trois séparément** : les remplacer par une comparaison naïve laisse à chaque fois **les quatorze paquets verts**. Un refactor bien intentionné rouvre un oracle temporel sans un seul test rouge. **Payée** : trois portes structurelles nominatives, une par paquet, chacune vue rouge par sa mutation. | step-031 |
| ~~`minimumTOTPEncryptionKeyLength` compte des **caractères**, pas de l'entropie.~~ | « Trente-deux `a` de suite passent. » Le README recommande un CSPRNG ; rien ne l'applique. C'est la clé qui chiffre les secrets TOTP au repos. **Payée** : borne de variété — douze symboles distincts — dans `requiredSecret`, donc sur les trois secrets, pas seulement celui-ci. | step-031 |
| ~~Trois branches de course ne sont exercées par rien : `!consumed`, `!elevated` de `VerifyMfa`, `!found` de l'enrôlement.~~ | Des chemins de sécurité atteignables par deux requêtes en vol, dont rien ne dit qu'ils refusent. **Payée par un constat mesuré**, la troisième issue que la DoD accepte : les trois refus se neutralisent sans un seul rouge, et la couverture ne peut pas le dire — les scénarios lancent le binaire en sous-processus. | step-031 |
| Un refus de permission (403) ne laisse **aucune trace** côté serveur. | `internal/bff` ne reçoit aucun `*slog.Logger`, et le journal d'audit ne porte que les succès. Une enquête qui demande « qui a tenté ce qu'il ne pouvait pas faire » n'a pas la donnée, et elle ne se reconstruit pas. | step-029 |
| Un 500 du BFF ne laisse aucune trace côté serveur. | Un `password_hash` corrompu en base fait refuser la connexion sans que rien ne le dise. | step-060 |
| Aucun journal n'atteint `internal/mfa` ni `internal/auth`. | Un secret illisible et un hachage de code abîmé sont **silencieux** ; le symptôme est un code de récupération légitime qui échoue. La tranche 403 de step-029 s'en exclut nommément. | step-060 |
| Le premier enrôlement d'un second facteur est libre pour toute session de premier facteur. | Sur un déploiement neuf, un mot de passe volé pendant cette fenêtre vaut un compte complet, second facteur compris. Assumé — problème d'amorçage classique du MFA. | step-029 |
| Aucune politique de mot de passe hors bootstrap. | La seule du produit ne s'applique qu'au premier opérateur ; le second se crée sans contrainte. | step-029 |
| Les sessions ne sont pas révoquées activement à la désactivation d'un opérateur. | Un compte désactivé garde ses sessions ouvertes jusqu'à leur échéance. | step-029 |
| Un rôle personnalisé homonyme d'un rôle par défaut est **basculé en `is_default`**, sa description écrasée et ses attributions ramenées à la liste du code. | « Le rapport le compte, donc ce n'est pas silencieux, mais c'est **destructeur par défaut**. » `seed.go` nomme lui-même le porteur : « la seconde moitié de la question léguée à step-029, qui décidera si l'écran interdit ces neuf noms ou ce qu'il fait d'une collision ». | step-029 |
| Un authentificateur WebAuthn au compteur cassé verrouille l'opérateur sur **tous** ses facteurs. | Cinq assertions refusées ferment aussi le TOTP et les codes de récupération, un quart d'heure. Le découpler rouvrirait le trou que **DN-7** ferme — le verrou d'essais partagé entre méthodes ; la sortie est la réinitialisation par un administrateur. | step-029 |
| Aucun index n'impose, pour les cérémonies WebAuthn, « un seul défi vivant par session et par objet ». | Deux ouvertures concurrentes ne se voient pas : un double-clic peut faire consommer le défi de l'autre onglet et refuser une cérémonie légitime. **À mesurer avant d'y toucher** — tension avec la CTE qui éteint le précédent. | step-187 |
| Rien ne purge `webauthn_challenges`. | Croissance non bornée sur une session qui ouvre des cérémonies. | step-187 |
| Aucune durée de rétention n'existe nulle part ; `audit_log` croît sans borne. | Le §3.1 renvoie à un document compagnon absent du dépôt. | step-187 |
| Les sessions expirées ne sont jamais purgées. | Même famille : une table qui ne décroît pas. | step-187 |
| La validation des **requêtes** entrantes contre le schéma n'est pas faite à l'exécution. | Le contrat borne les réponses, pas ce qui entre. | step-060 |
| `oauth2.reuseTokenSource` : l'attente est bornée mais **pas annulable**. | Un `tokenUrl` en trou noir sérialise les appels concurrents jusqu'au plafond. | step-060 |
| Les scopes `cdr:export_bulk` et `msisdn:reveal` sont absents du jeton machine. | « Le symptôme sera un **403 de la passerelle** sur du code qui compile. » | step-104 |
| `cdr:export_bulk` n'est catalogué nulle part au contrat amont. | À corriger par une PR dans `go-gateway/api/`, jamais en le devinant ici. | step-104 |
| Nonce CSP par requête, rétention d'assets inter-versions, sondes de disponibilité. | « Découverte tardive en production. » Un onglet ouvert avant un déploiement échoue à charger ses chunks **en plein incident**. | step-186 |
| Quatre lignes d'infrastructure qu'aucune porte ne garde : `config.ConnectTimeout` dans `openSQL`, la position du verrou en tête de transaction, le `ConnectTimeout` de `pgx.Connect` dans `Seed`, `IsoLevel: pgx.ReadCommitted`. | « Aucune porte ne rougit », vérifié plutôt que supposé — et pour le `ConnectTimeout` du `Seed`, il n'y a rien à retirer : la borne n'est **pas posée**, c'est un constat et non un correctif. Précédent : step-021 renvoie déjà une mesure d'infra à step-186. | step-186 |
| `pg_advisory_xact_lock` de `CreateFirstOperator` n'est exercé par aucun test. | « Deux exécutions concurrentes se croisent trop rarement pour qu'un test qui les lance prouve quoi que ce soit. » Ce n'est donc pas une mutation verte mesurée, c'est une absence de preuve possible. | **sans porteur** — step-021 n'en nomme aucun, et le premier déploiement à plusieurs instances est le seul lieu où la course devient observable. |
| Le pool est détaché du contexte d'arrêt, et **sa fermeture non plus n'est gardée**. | « Aucune porte, faute d'une requête assez lente pour traverser `SIGTERM` » : ce que la ligne change — une déconnexion annoncée plutôt que découverte — n'est visible d'aucun test du dépôt, et retirer la fermeture laisse tout vert parce que le processus s'arrête juste après. | step-047 |
| Le scénario du `rp_id` en adresse IP ne garde pas l'**ordre** : construire avant `net.Listen`. | « L'ordre est tenu par un commentaire et par rien d'autre. » | step-186 |
| Aucune surface Alertmanager au contrat. | Write-through et réconciliation non implémentables ; step-183 **bloquée**, step-180 dégradée. | step-183 |
| `suspend-smpp-account` déclarée au contrat mais non implémentée. | L'UI passe par le PATCH tant que l'opération n'existe pas. | step-063 |
| Pas de lecture unitaire de CDR : la fiche d'un message se compose côté BFF. | Composition et cache à la charge du BFF. | step-101 |
| **62 des 133 opérations du contrat** ne sont pas implémentées côté passerelle — ratio mesuré le 27/07/2026, **jamais revérifié depuis**. | M2, M4, M5 et M8 se développent contre le mock. `plan.md` §16 dit de le relever à l'ouverture de chaque jalon ; M2 s'ouvre, et sa première step dans l'ordre est celle qui doit le relever. *(§18 écrit 63 là où §16 compte 62 : la contradiction est dans la source.)* | step-041 |
| Le **scan transversal** de l'invariant (a) n'existe pas : logs, URL, exports, cache persisté, attributs de trace. | La moitié structurelle est livrée (step-026) ; celle qui vérifie qu'aucun **autre chemin** ne contourne l'invariant ne l'est pas. | step-103 |
| Les secrets d'identifiants de bind ne sont gardés par rien — invariant (b). | Aucune porte n'empêche un secret d'être réaffiché ; la règle « montré exactement une fois » tient par la discipline. | step-066 |
| `GET /audit-log` filtrera sur `target_type` **sans index**. | La table est partitionnée par mois : un filtre par cible balaiera chaque partition retenue. | step-184 |
| **Aucune attestation WebAuthn n'est vérifiée** : aucun registre de métadonnées, modèle d'authentificateur non contrôlé. `WithExclusions` n'est gardé par rien non plus. | Une passkey posée par un authentificateur logiciel arbitraire est acceptée comme une clé matérielle. | **sans porteur** — step-024 l'écrit sous « ce qui n'est pas testé » sans en nommer un. |
| Le **trou d'audit du proxy** : pour une action proxyfiée vers la passerelle, `Record` écrit **après** le succès, hors transaction commune. | Une panne entre les deux perd la trace, et l'action reste faite. « M3 en héritera — le découvrir alors coûterait une passe. » | step-060 |
| `MaxConnsPerHost` n'est pas posé sur le client de la passerelle. | Rien ne borne les connexions ouvertes vers l'API Admin — « le seul cadran qui limiterait la pression de l'**invariant (e)** ». | step-060 |
| `Proxy` n'est pas posé, là où `http.DefaultTransport` pose `ProxyFromEnvironment`. | Divergence silencieuse d'avec le défaut : un `HTTPS_PROXY` d'environnement est ignoré sans que rien ne le dise. | step-060 |
| `idempotency_key` est engendré non-pointeur et sans `omitempty`. | « L'oublier compile et envoie l'UUID zéro, **qui a l'air valide** » — la passerelle le prendrait pour une clé. Renvoi de step-003 : « la step qui les appellera ». | step-160 |
| La calibration argon2id a été mesurée sur un poste de développement. | Les paramètres de coût ne valent que pour cette machine. « À rejouer au premier déploiement réel (step-186). » | step-186 |
| ~~Une constante `Key` déclarée **sans entrée au catalogue** ne fait rougir aucune porte.~~ | « Compile, deux suites vertes, absente du TS engendré. Go ne signale pas une constante exportée inutilisée. » Le catalogue est gardé contre les rôles, pas contre ses propres constantes. **Payée** : `TestAucuneConstanteNeManqueAuCatalogue` part de la portée du paquet, que l'orpheline n'atteint pas. | step-031 |
| ~~Le hachage factice de `VerifyDummy` **en tant qu'appel**, et la cible de durée d'argon2id : aucune porte.~~ | L'oracle d'énumération que le hachage factice ferme repose sur un appel que rien n'exige. **Payée** — la moitié « appel » l'était depuis step-021 sans que le registre le sache ; la cible de durée l'est par un plancher remonté au profil retenu. | step-031 |
| La borne de démarrage du binaire est passée de 5 s à 30 s. | « **Aucun test ne rougit si la valeur revient à 5 s**, vérifié plutôt que supposé. » Jumelle exacte du délai godog, et sans filet comme lui. | step-032 |
| Un administrateur qui édite un rôle par défaut verra **son édition défaite au déploiement suivant**, et « la seconde sortie ne marche pas en l'état ». | Première moitié de la question léguée par DN-8 de step-020 ; la seconde est la collision de noms ci-dessus. | step-029 |
| Le préfixe `__Host-` du cookie n'est vu par **aucun scénario**. | Le harnais porte ses cookies à la main et accepterait n'importe quel nom. Seul un vrai navigateur applique le préfixe. | step-027 |
| La fenêtre d'oubli du compteur glissant est écrite **deux fois** — `internal/store/counters.go` et `internal/store/logins.go`. | Changer la politique d'oubli sans toucher les deux donne au premier et au second facteur **deux politiques anti-brute-force différentes**, et le commentaire qui dit « la même valeur, délibérément » devient faux en silence. Rien ne casse. | **sans porteur** — replier la requête bi-dimension remanierait le chemin consulté avant tout argon2id, pour un gain de forme. Non-attribution rendue le 30/08/2026, avec sa mesure. |

### Forme, confort et outillage

| Dette | Effet si elle dure | Porteur |
|---|---|---|
| Le conteneur PostgreSQL des scénarios meurt **parfois** sous la charge — mesuré le 27/08/2026 en relisant le journal du job en échec de la PR 52. | **Coût déjà encaissé**, et l'intermittence est ce qui le rend cher : il a fait rougir « Tests Go » en CI et **bloqué un bump de `kin-openapi` pendant huit jours** en faisant croire à une rupture de la bibliothèque. Le prix n'est pas l'inconfort d'une suite rouge, c'est une dépendance qu'on n'ose plus bumper. | step-032 |
| Le filet de performance des scénarios n'existe **à aucune valeur** du délai godog, passé de 2 s à 15 s. | « Une régression qui rendrait une route dix fois plus lente ne rougirait plus ici. Rien ne la garderait par ailleurs, **et c'était déjà vrai à deux secondes**. » Le délai est une borne anti-suspension, pas une assertion de performance : le porter à 15 s n'a rien créé, il a rendu visible ce qui manquait. | step-032 |
| `descope/virtualwebauthn` est épinglée sur `go-webauthn v0.16.5`. | Latente, pas active : « elle fonctionne contre 0.18.0 — les scénarios le montrent — mais un durcissement futur de la bibliothèque serveur **pourrait** la mettre en défaut, et le symptôme serait une suite rouge sans cause lisible dans le produit ». Repli chiffré : un authentificateur à la main, ~150 lignes. | step-032 |
| ~~L'`issuer` de l'URI `otpauth://` est codé en dur.~~ | Deux déploiements du même produit apparaissent sous le même nom dans le téléphone de l'opérateur. **Payée** : `DASHBOARD_PRODUCT_NAME`, obligatoire, lue par un scénario jusqu'au corps servi. | step-031 |
| ~~Le `displayName` WebAuthn est codé en dur.~~ | Même geste que l'`issuer` : une valeur de marque qui appartient à la configuration validée. **Payée** par la même variable — et gardée par un scénario, ce qu'elle n'était par rien : le recoder en dur laissait tout vert. | step-031 |
| Les **descriptions** des neuf rôles ne sont gardées que par la relecture. | **Quatre corrections sur trois** des neuf descriptions — `ops` deux fois, puis `compliance` et `billing_admin` —, à la main, sur trois passes de revue. L'écran des rôles affichera ces phrases telles quelles à un opérateur qui s'en servira pour décider. | step-029 |
| La valeur des durées de session (12 h absolue, 2 h d'inactivité) n'est gardée par rien. | Les changer laisse tout vert. C'est une **décision, pas un invariant** — ce que le porteur garde est l'affichage cohérent du décompte, pas la valeur. | step-027 |
| Aucune passkey ne porte de nom : la table est livrée sans colonne `name`. | « Celle enregistrée le 12 août » n'est pas un nom. Migration + champ au contrat. | step-028 |
| Laquelle proposer en premier, passkey ou TOTP : la décision n'est écrite nulle part. | Une décision d'écran laissée au hasard de l'implémentation. | step-028 |
| La réinitialisation du second facteur d'un autre opérateur est **promise par deux messages d'erreur en production**. | Ils deviendront faux si la step ne la livre pas. | step-029 |
| Le sort de `GET /permissions`, déclarée au §5.1 et sans appelant, n'est pas tranché. | Une opération au contrat que personne n'appelle : la trancher, et écrire la raison. | step-029 |
| `QueryClientProvider` n'est monté ni dans le produit ni dans le harnais. | Assumé : le monter maintenant serait du code sans utilisateur. Déclencheur écrit par step-007 : « la première step qui livrera un `useQuery` », c'est-à-dire le premier écran qui parle au BFF — dont la fiche re-nomme déjà la dette. | step-027 |
| L'amortissement de testcontainers n'est pas fait ; `WithReuse` écarté nommément. | Déclencheur écrit : le jour où un second paquet a besoin de PostgreSQL. | step-032 |
| Le binaire dans un conteneur **sans Node** n'est pas prouvé. | La preuve livrée est plus étroite que l'affirmation. | step-186 |
| Graphiques : `visx` contre `Recharts`, non tranché. | À décider sur la densité d'un cockpit sombre, pas en principe. | step-080 |
| Des opérations du contrat n'ont **aucune step passerelle** : groupes de clients, webhooks, sender rewrite, `reorder-routes`. | À poser à l'équipe passerelle **avant M3 et M6**, pas à découvrir en développant. | step-060 |
| `pgx` nu contre `sqlc` : décision **confirmée**, avec un déclencheur écrit qui la rouvrirait. | « Ce jour-là, `sqlc` reprend l'avantage et la décision se rouvre » — le déclencheur est un événement de mesure, « un `Scan` dont la mutation d'interversion de deux champs de même type reste verte ». Le premier critère était un proxy, reconnu tel. | **sans porteur** — un déclencheur mesurable, pas une step. |
| Le raccourci `font:` réinitialise `font-variant-numeric`. | « Réel pour les KPI de step-041 » : des chiffres tabulaires qui cessent de s'aligner dans un cockpit dense. | step-041 |
| Deux dettes de forme relevées en revue de step-008 et non corrigées. | Écrites sous « ce que la revue a signalé et que je n'ai pas corrigé » ; sans effet mesuré aujourd'hui. | step-041 |
| `request.Body == nil` dans `API.Login` : une garde **inatteignable par le routeur**, conservée. | Lui écrire un test demanderait de l'appeler hors de son routeur : il prouverait la garde et rien du produit. Le constat est écrit au-dessus de la ligne. | **sans porteur** — c'est une décision consignée, pas une dette à payer. La seule action possible serait de retirer la garde. |
