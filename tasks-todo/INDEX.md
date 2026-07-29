# Index des steps — plan d'implémentation du tableau de bord Admin

Dérivé de `docs/plan-execution-tableau-de-bord.md` (lui-même dérivé de la spec v2.0). **Un fichier
`step-NNN.md` = une PR** : petite, reviewable, laisse le dépôt vert une fois mergée. Découpage par
jalon (M0…M9) ; numérotation par blocs de 20 (marge d'insertion), ordre = exécution.

Le **plan** donne le cadre : conventions transverses à figer avant M0, tranche verticale de
référence, critères de sortie par jalon, graphe de parallélisation et état réel de la passerelle.
Cet index donne le découpage en PRs. Les deux se lisent ensemble.

**Workflow :** on prend le prochain `step-NNN.md` dans `tasks-todo/`, on l'exécute (1 session = 1 PR),
puis on déplace le fichier dans `tasks-done/` (dernier commit de la PR). Un jalon est terminé quand
toutes ses steps sont dans `tasks-done/`.

Légende : `[x]` = fait (dans `tasks-done/`) · `[ ]` = à faire (dans `tasks-todo/`).

---

## Ce qu'on construit

Le **tableau de bord Admin** de la passerelle SMS : un cockpit d'exploitation interne (100–300
opérateurs, desktop-first, thème sombre) qui pilote clients, comptes SMPP, connecteurs, routage,
conformité et facturation. Il est **client de l'API Admin de la passerelle** — jamais de la base.

Le navigateur ne parle qu'au serveur TanStack Start (le **BFF**), qui parle à l'API Admin et à son
petit schéma PostgreSQL propre (opérateurs, rôles, audit, alertes, notifications, vues sauvegardées).

## Pile technique (versions vérifiées via `ctx7` / registre npm, 27/07/2026)

| Brique | Choix | Version |
|---|---|---|
| Framework | TanStack Start (React + TS, Vite, SSR + fonctions serveur) | `@tanstack/react-start` 1.168.x |
| Routage | TanStack Router (routage fichiers) | `@tanstack/react-router` 1.170.x |
| État serveur | TanStack Query | `@tanstack/react-query` 5.101.x |
| Primitives UI | Base UI (headless, accessible) habillé par les tokens de la charte | `@base-ui/react` 1.6.x |
| Accès DB | Drizzle ORM + drizzle-kit | `drizzle-orm` 0.45.x / `drizzle-kit` 0.31.x |
| Contrat API | `@martialanouman/gateway-api-contracts` (GitHub Packages) | **1.0.0** |
| Client HTTP typé | `openapi-fetch` sur les types générés du contrat | 0.17.x |
| Mock d'API | Prism (`@stoplight/prism-cli`) sur `openapi-admin.yaml` | 5.16.x |
| Temps réel | WebSocket + Redis Pub/Sub (`ioredis`) | 5.11.x |
| Graphiques | Recharts | 3.10.x |
| Tables | `@tanstack/react-virtual` | 3.14.x |
| Éditeur de script | Monaco | 0.56.x |
| MFA | `@simplewebauthn/server` + `/browser` (passkey), TOTP | 13.3.x |
| Tests | Vitest + Testing Library ; Playwright pour le bout en bout | 4.1.x / 1.62.x |
| Langage | TypeScript 7 (compilateur natif), `strict` | 7.0.x |
| Lint + format | Biome — un seul outil | 2.5.x |
| Hébergement | Nitro v2 via `@tanstack/nitro-v2-vite-plugin`, preset `node-server` | 1.155.x |
| Gestionnaire | **pnpm** | — |

> **Règle d'or outillage :** avant d'ajouter ou de mettre à jour une dépendance, ou d'utiliser une API
> de bibliothèque, passer par **`ctx7`** pour la version et la signature à jour. Ne jamais deviner un
> numéro de version ni une API depuis la mémoire.

## Les 5 invariants (tests bloquants, verts à vie)

- **(a)** Le **corps d'un message** ne s'affiche jamais sans `content:read`, et chaque affichage
  déclenche un appel audité. Il n'apparaît jamais dans une trace, un log ou une URL.
- **(b)** Aucun **secret d'identifiant** n'est jamais réaffiché : masqué en permanence, montré
  exactement une fois à la création ou à la rotation, aucune action « révéler ».
- **(c)** L'**autorisation est appliquée côté serveur** (fonction serveur / route BFF). Le rendu
  conditionnel de l'UI est un confort, jamais la garde.
- **(d)** Le **navigateur ne parle jamais directement à l'API Admin** : jeton machine, mTLS et scopes
  restent côté BFF.
- **(e)** Le tableau de bord n'est **jamais sur le chemin critique du plan de données** : sa panne
  dégrade la visualisation, jamais le débit de SMS ni la détection d'incident infra.

## Definition of Done (chaque PR)

`pnpm check` vert (typecheck · lint · test · vuln · build) • critères d'acceptation couverts
par des tests • aucun invariant (a…e) violé • copie FR conforme aux fondamentaux de contenu de la
charte (`.claude/skills/sms-gateway-design/README.md`) • clavier + libellés accessibles (WCAG 2.1 AA)
sur tout écran touché • PR petite et focalisée (une step).

## Conventions transverses

- **Le contrat est la source de vérité.** Le dépôt ne copie jamais un YAML : il consomme le package
  versionné. Tout manque côté passerelle se règle par une PR dans `go-gateway/api/`, pas par un
  contournement ici.
- **Mock-first.** Chaque écran se développe contre le mock Prism ; l'intégration à la vraie passerelle
  n'est requise que pour les steps qui le disent.
- **Langue.** Copie d'interface en **français** ; les identifiants techniques restent en anglais et en
  mono, verbatim du contrat (`link_status`, `breaker_state`, `max_sessions`, `balance_scope`).
- **Cinq états de contenu** distincts partout : chargement · vide · aucun résultat · module désactivé ·
  erreur. Jamais un blanc, jamais une erreur déguisée en vide.

---

## M0 — Fondations & outillage
- [x] step-000 — Scaffold TanStack Start (pnpm, TS strict, lint/format, CI)
- [x] step-001 — Contrat API : package, client Admin typé, mock Prism
- [x] step-002 — PostgreSQL 18 + Drizzle : schéma propre au BFF, migrations, docker-compose
- [x] step-003 — Design system : tokens de la charte + fondations de thème
- [x] step-004 — Harnais de test : Vitest, Testing Library, Playwright

## M1 — Authentification, permissions & audit  (§6.9, §6.10, §3.1)
- [x] step-020 — Schéma auth (operators, roles, permissions, jointures) + seeds
- [ ] step-021 — Login email/mot de passe + anti-brute-force
- [ ] step-022 — Session BFF (cookie signé) + `/auth/me` + gardes de route
- [ ] step-023 — MFA TOTP : enrôlement et vérification
- [ ] step-024 — MFA WebAuthn / passkey
- [ ] step-025 — Moteur de permissions côté serveur + journal d'audit + MFA obligatoire
- [ ] step-026 — Rendu UI par permission + écrans Login & MFA
- [ ] step-027 — Gestion des opérateurs et des rôles (CRUD)

## M2 — Coquille applicative & temps réel  (§4.1, §4.2, §5.2)
- [ ] step-040 — AppShell : rail de navigation, barre supérieure, layout, routage fichiers
- [ ] step-041 — Primitives UI lot 1 : bouton, champ, select, pilule de statut, tabs, table
- [ ] step-042 — Primitives UI lot 2 : dialog, menu, tooltip, toast + les cinq états de contenu
- [ ] step-043 — Hub WebSocket BFF : trois flux passerelle agrégés en une socket client
- [ ] step-044 — HA : Redis Pub/Sub entre instances BFF
- [ ] step-045 — Client WS React : abonnement par sujet, reconnexion, remise en état
- [ ] step-046 — Centre de notifications

## M3 — Clients, comptes SMPP & identifiants  (§6.14, §6.15)
- [ ] step-060 — Groupes de clients : CRUD + filtre transverse
- [ ] step-061 — Clients : liste, filtres, création
- [ ] step-062 — Fiche client : identité, statut, suspension en cascade, sender IDs
- [ ] step-063 — Comptes SMPP : liste + création rattachée au client
- [ ] step-064 — Fiche compte : canaux, politique de sender ID, bascules SMPP, webhooks
- [ ] step-065 — Quotas, limites de débit et `max_sessions` (avertissement d'écart)
- [ ] step-066 — Identifiants : deux cartes masquées, secret une fois, rotation avec grâce, révocation

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
- [ ] step-104 — Export CSV asynchrone gouverné

## M6 — Routage & scripts  (§6.1, §6.2, §6.7, §6.13)
- [ ] step-120 — Routes : table par priorité + réordonnancement
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
- [ ] step-182 — Évaluateur BFF sur source durable à offset persisté
- [ ] step-183 — Réconciliation Alertmanager  ⚠️ **bloqué : surface absente du contrat**
- [ ] step-184 — Journal d'audit : écran de consultation
- [ ] step-187 — Rétention d'`audit_log` : détachement et purge des partitions échues †
- [ ] step-185 — Accessibilité WCAG 2.1 AA + parcours Playwright de bout en bout
- [ ] step-186 — Déploiement HA (≥2 instances, affinité WS) + durcissement production

† Ajoutée après coup : la step-002 a livré la création des partitions d'`audit_log`, rien ne les
détache ni ne les supprime — c'est pourtant l'unique raison d'avoir partitionné. Son numéro ne suit pas
sa position parce que **l'ordre de cette liste fait foi, pas le numéro** : elle se lit après l'écran de
consultation (step-184) et doit précéder la mise en production (step-186), qui ne doit pas partir sans
propriétaire de rétention. Elle est en revanche **indépendante de step-185** : l'ordre entre ces
deux-là est de convenance, pas une contrainte.

---

## Écarts connus entre la spec et le contrat `1.0.0`

Relevés à la rédaction du plan, à traiter par une PR dans `go-gateway/api/` — jamais par un
contournement ici.

| Écart | Impact | Step concernée |
|---|---|---|
| §6.8 prévoit que le tableau de bord écrive la config Alertmanager « via l'API Admin », mais **aucune opération Alertmanager n'existe** dans `openapi-admin.yaml` (134 opérations). | Le write-through et la réconciliation infra ne sont pas implémentables. | step-183 (bloquée), step-180 (dégradée) |
| `suspend-smpp-account` est déclarée au contrat mais **non implémentée** côté passerelle ; la suspension passe par `update-smpp-account` (PATCH `status`). | L'UI doit utiliser le PATCH tant que l'opération n'est pas livrée. | step-063, step-064 |
| Pas de lecture unitaire de CDR côté passerelle : la fiche d'un message se **compose** côté BFF (`search-messages` filtré + `get-message-trace`). | Composition et cache à la charge du BFF. | step-101 |
| L'API Admin s'authentifie en **OAuth2 client_credentials + mTLS** avec un jeton *machine* portant des scopes fixes (`admin:read`, `admin:write`, `content:read`…). | Le jeton du BFF détient `content:read` en permanence : **seul le BFF** peut restreindre la lecture de corps par opérateur — d'où l'invariant (c). | step-001, step-025, step-103 |
| **63 des 134 opérations du contrat ne sont pas encore implémentées** côté passerelle (métriques, CDR/trace, sessions, facturation, contenu/RGPD, groupes de clients, webhooks, sender rewrite). | M2, M4, M5 et M8 se développent contre le mock ; une passe d'intégration réelle est nécessaire par jalon. | §15 du plan d'exécution |
