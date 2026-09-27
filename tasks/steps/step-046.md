# step-046 — Centre de notifications persisté

> **Jalon :** M2 (§1.6 ; spec §3.1, §5.1, §5.2, §6.8) · **Statut :** À FAIRE
> **Dépend de :** step-045 · **Bloque :** aucune

## But
Une alerte de facturation n'existe aujourd'hui que le temps d'un toast : un opérateur absent de son
onglet ne la voit jamais. Désormais le porteur du bail l'écrit dans `notifications` avant de la
diffuser, un sujet `notifications` la pousse aux sockets qui ont le droit de la voir, et un panneau
de la barre supérieure en garde l'historique, avec l'état lu ou non lu de chaque opérateur.

## Décisions (arbitrées, ne pas rouvrir)
- **Une seule source réelle : `billing_alert_stream`.** Le webhook Alertmanager (step-181) et
  l'évaluateur (step-182) sont de M9 ; le premier est bloqué par la dette 024. Un centre sans
  écrivain resterait vide en production. *Arbitré le 27/09/2026 avec l'utilisateur.*
- **Le porteur du bail écrit, puis publie.** Seul consommateur de `billing-alerts`, il insère la
  ligne et publie ensuite sur Redis la trame `notifications`, qui porte l'`id` de la ligne. Base en
  échec : journal sans rien citer de la trame, aucune trame `notifications`, et `billing.alerts`
  passe quand même (invariant e). Aucun dédoublonnage : le bail garantit un consommateur, le flux
  amont ne rejoue rien.
- **Un historique d'affichage, au mieux une fois.** Une bascule du bail ou une base en panne laisse
  un trou, sans rattrapage : la spec confie la détection de `mo_floor_reached` à l'évaluateur sur
  source durable (§6.8), le flux ne sert que l'affichage. La copie ne présente jamais le centre
  comme exhaustif — l'infobulle du panneau le dit.
- **Les faits sont stockés, la copie est rendue à la lecture.** Migration : `kind text NOT NULL`
  (le schéma de `details`), `details jsonb`, `message` devient nullable, et
  `CHECK (message IS NOT NULL OR details IS NOT NULL)`. Une alerte de facturation s'écrit
  `kind = 'billing_alert'`, `details = {customerId, ownerType, ownerId, alert, balance}`, sans
  `message` ; `message` reste aux sources en texte libre de M9. `details` est **typé par `kind`** en
  Go et en union discriminée dans `api/openapi-bff.yaml` — jamais une `map[string]any`. Une nouvelle
  valeur d'`alert` côté passerelle ne crée pas de `kind` : le client la rend par son repli générique.
  Une formulation corrigée s'applique ainsi à tout l'historique, en un seul endroit, et les
  identifiants restent verbatim en mono (plan §1.5). *Arbitré le 27/09/2026 avec l'utilisateur.*
- **Sévérité : `warning` pour toute alerte de facturation.** `mo_floor_reached`, seule valeur émise,
  ne bloque rien — le MO reste remis, il cesse d'être débité (spec passerelle, l. 827). Une valeur
  inconnue prend aussi `warning` : visible sans crier, là où `info` rangerait un futur « disjoncteur
  ouvert » parmi les anecdotes. Aucune table tant qu'une seule valeur existe : son unique entrée
  vaudrait le repli, et aucune mutation ne la ferait tomber. Seule la passerelle connaît la
  conséquence d'une alerte ; la dette 060 porte le correctif au contrat.
- **La source décide de la visibilité.** Une table Go source → permission, fermée par défaut :
  `billing_alert_stream` → `billing:read` ; `alertmanager` et `bff_evaluator` → `alerts:read`. Une
  source absente est invisible de tous. *Arbitré le 27/09/2026 avec l'utilisateur.* Ses garde-fous :
  - un test exige que la table couvre exactement les valeurs du `CHECK` SQL sur `source` : retirer
    une entrée doit faire rougir quelqu'un ;
  - le filtre vit **dans la requête SQL** (`source = ANY($1)`), jamais après coup : un filtre
    applicatif rendrait des pages courtes ou vides sous la pagination par curseur ;
  - le hub filtre `notifications` **trame par trame**, sur les permissions que la revalidation
    rafraîchit déjà — le sujet lui-même est ouvert à tout opérateur authentifié ;
  - le panneau dit ce qui manque : sans `billing:read`, « Les alertes de facturation exigent
    `billing:read` » — un contrôle interdit est expliqué, jamais masqué.
- **Rôles : aucune clé ne change.** La table de vérité du §6.10 tient (`roles_test.go`), et aucun
  rôle par défaut ne détient `alerts:read` sans `billing:read` — vérifié le 27/09/2026 sur
  `internal/permissions/roles.go`. Les **descriptions** suivent la décision, et le seed les
  réécrit : `alerts:read` (« … et les notifications qu'elles ou Alertmanager déclenchent »),
  `billing:read` (reçoit les alertes de facturation), `Reporting` (« et rien d'autre » devient faux).
  Les autres descriptions ont été relues contre leurs clés et restent vraies : Audit, Scripts et
  Conformité n'ont ni l'une ni l'autre, et voient un centre vide expliqué.
- **Routes** (`api/openapi-bff.yaml`), toutes deux `exempt` dans `guard.go` avec leur raison : le
  filtre par source est l'autorisation, et une clé unique à l'entrée la contredirait.
  - `GET /notifications?cursor=` : les visibles, plus récentes d'abord, 20 par page, chacune avec
    `read` ; la réponse porte `unreadCount` (visibles non lues) et `nextCursor`.
  - `POST /notifications/{id}/read` : ajoute l'opérateur à `read_by_operators`, idempotent, **204** ;
    une ligne invisible ou absente rend **404**, pour ne pas révéler qu'elle existe. Écriture
    d'audit (invariant c). Pas de « Tout marquer comme lu » : absent de la spec.
- **Client.** Un bouton « Notifications » dans `TopBar`, avec le nombre de non-lues, ouvre un
  Popover Base UI : sévérité, copie, horodatage, « Marquer comme lue » par ligne, « Afficher les
  suivantes », état vide explicite. Instantané par TanStack Query, puis chaque trame `notifications`
  invalide la requête et pousse un toast.
- **Les toasts de facturation passent de `billing.alerts` à `notifications`.** Une source, aucun
  doublon, et une copie en un seul endroit, partagée par le toast et le panneau. Le hub continue de
  servir `billing.alerts`, que plus rien ne consomme côté client jusqu'à M8.

## Périmètre (ce que fait CETTE PR)
- **Contrat Admin** : 6.9.0, relevé le 27/09/2026 à 15:02 UTC, dernière version publiée. Aucun écart.
- **Schéma** : migration `00013` (`kind`, `details`, `message` nullable, `CHECK`). La version
  attendue suit d'elle-même : `embeddedSchemaVersion` la lit dans les migrations embarquées.
- **Serveur** : écriture par le porteur du bail (`internal/hub`), lecture et marquage (`internal/store`,
  `internal/bff`), DTO déclarés, table source → permission, filtre trame par trame du hub.
- **Contrat BFF** : les deux routes, l'union de `details`, `make generate`.
- **Permissions** : descriptions de `alerts:read`, `billing:read` et `Reporting` ; `make generate`.
- **Client** : panneau dans `web/src/components/top-bar.tsx`, toasts réalimentés par `notifications`,
  copie partagée.
- **Dette 059 payée** : `minimumReleaseAgeExclude` retiré de `web/pnpm-workspace.yaml`, fichier
  supprimé. Possible **après le 27/09/2026 21:37 UTC** seulement, quand la 6.9.0 a 24 h.
- **Dettes ouvertes** : 060 (la sévérité d'une alerte de facturation est devinée par le BFF — le
  contrat devrait la porter ; porteur step-182) et 061 (en M9, la même alerte arrivera par
  `billing_alert_stream` et `bff_evaluator` ; porteur step-182, qui tranche entre dédoublonner et
  retirer l'écriture depuis le flux).

## Tests (écrits dans la même PR)
- **godog** (`.feature` à côté du package de la route, contre Postgres réel) :
  - un opérateur sans `billing:read` ne voit aucune alerte de facturation, ni dans la liste ni dans
    `unreadCount` ; avec, il la voit ;
  - marquée lue par un opérateur, elle reste non lue pour l'autre ;
  - marquer une ligne invisible rend 404, comme une ligne absente ; marquer écrit l'audit.
- **Unitaires Go** :
  - la table source → permission couvre exactement le `CHECK` SQL ;
  - pagination : 25 lignes dont 10 invisibles → une première page pleine de 20 visibles, pas moins ;
  - le hub ne remet une trame `notifications` qu'aux sockets qui ont la permission de sa source, et
    cesse après un retrait à la revalidation ;
  - le porteur écrit avant de publier, et la trame porte l'`id` écrit ; base en échec → aucune trame
    `notifications`, `billing.alerts` passe.
- **Vitest** : compteur de non-lues ; « Marquer comme lue » le décrémente ; explication sans
  `billing:read` ; une trame → un toast et une invalidation ; copie depuis `details` (`customer`,
  `smpp_account`, repli brut, `alert` inconnu) ; `message` rendu tel quel pour une source en texte
  libre.
- **Playwright** (critère 1, en étendant `web/e2e/shell.spec.ts`) : alerte émise par le faux amont →
  toast → panneau → « Marquer comme lue » décrémente le compteur → rechargement → elle y est, lue.
- **Mutations** (tableau à la clôture, chacune nommant le test qui tombe) : entrée de la table
  source → permission retirée ; filtre SQL remplacé par un filtre applicatif ; filtre trame par trame
  retiré ; 404 remplacé par 403 ; audit du marquage retiré ; `read` calculé sans l'opérateur courant ;
  publication avant écriture ; invalidation de la requête retirée.

## Definition of Done
- [ ] `make check` vert, `make e2e` vert.
- [ ] Invariants : aucun champ de trame hors des DTO déclarés ; aucun journal ne cite une trame (a) ;
      les deux routes gardées par la table de visibilité, le marquage audité (c).
- [ ] Clavier et libellés : le panneau s'ouvre, se parcourt et se ferme au clavier ; le compteur a un
      libellé lisible, pas un chiffre seul (WCAG 2.1 AA).
- [ ] Critère 2 : descriptions de rôles et de permissions relues contre leurs clés ; copie du panneau
      relue contre le serveur (au mieux une fois, filtre par source).
- [ ] Critère 4 écrit là où il vit.

## Hors périmètre
- Webhook Alertmanager (step-181), évaluateur (step-182), canaux email / webhook / Slack (M9).
- « Tout marquer comme lu », filtres du panneau, route pleine page.
- Rétention de la table (dette 013). Drain des sockets → step-047.
- Rattraper une alerte perdue pendant une bascule ou une panne de base : au mieux une fois, par
  décision.
