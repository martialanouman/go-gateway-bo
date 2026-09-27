# step-046 — Centre de notifications persisté

> **Jalon :** M2 (§1.6 ; spec §3.1, §5.1, §5.2, §6.8) · **Statut :** FAIT
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
  passe quand même (invariant e). Aucun dédoublonnage : le flux amont ne rejoue rien, et le bail
  réduit la consommation à un porteur — hors la fenêtre d'une bascule, dont le plafond est écrit au
  critère 4.
- **Un historique d'affichage, au mieux une fois.** Une bascule du bail ou une base en panne laisse
  un trou, sans rattrapage : la spec confie la détection de `mo_floor_reached` à l'évaluateur sur
  source durable (§6.8), le flux ne sert que l'affichage. La copie ne présente jamais le centre
  comme exhaustif — l'infobulle du panneau le dit.
- **Les faits sont stockés, la copie est rendue à la lecture.** Migration : `kind text NOT NULL`
  (le schéma de `details`), `details jsonb`, `message` devient nullable, et
  `CHECK (message IS NOT NULL OR details IS NOT NULL)`. Une alerte de facturation s'écrit
  `kind = 'billing_alert'`, `details = {customerId, ownerType, ownerId, alert, balance}`, sans
  `message` ; `message` reste aux sources en texte libre de M9. `details` est **typé par `kind`** en
  Go et dans `api/openapi-bff.yaml` — jamais une `map[string]any`. Tant qu'un seul `kind` porte des
  faits, `details` est déclaré `BillingAlert` et `kind` un enum : un `oneOf` d'un membre n'apporte
  rien, M9 en fera une union. Une nouvelle
  valeur d'`alert` côté passerelle ne crée pas de `kind` : le client la rend par son repli générique.
  Une formulation corrigée s'applique ainsi à tout l'historique, en un seul endroit, et les
  identifiants restent verbatim en mono (plan §1.5). *Arbitré le 27/09/2026 avec l'utilisateur.*
- **Sévérité : `warning` pour toute alerte de facturation.** `mo_floor_reached`, seule valeur émise,
  ne bloque rien — le MO reste remis, il cesse d'être débité (spec passerelle §6.9). Une valeur
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
  - le panneau dit ce qui manque : sans `billing:read`, « Les alertes de facturation
    n’apparaissent pas ici : elles exigent la permission `billing:read`. » — un contrôle interdit est
    expliqué, jamais masqué.
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
- **Contrat BFF** : les deux routes, les schémas `Notification`, `NotificationEntry`,
  `NotificationPage`, le sujet `notifications`, `make generate`.
- **Permissions** : descriptions de `alerts:read`, `billing:read` et `Reporting` ; `make generate`.
- **Client** : panneau dans `web/src/components/top-bar.tsx`, toasts réalimentés par `notifications`,
  copie partagée.
- **Dette 059 payée** : `minimumReleaseAgeExclude` retiré de `web/pnpm-workspace.yaml`, fichier
  supprimé, le 27/09/2026 à 21:57 UTC — `pnpm install --frozen-lockfile` sans l'exception : rc=0,
  « Lockfile passes supply-chain policies ».
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
  - pagination : 35 lignes dont 10 invisibles parmi les plus récentes → une première page pleine de
    20 visibles, pas moins ;
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

## Arbitrages de l'implémentation (27/09/2026)
- **`details` à une seule variante** : `kind` enum `[billing_alert, message]`, `details` déclaré
  `BillingAlert` (voir plus haut).
- **Routes `exempt`, contrôle dans le handler** : `readerOf` (`internal/bff/notifications.go`)
  refait l'ordre de la garde — session (401), élévation (403 `mfa_required`), permissions — puis
  rend les sources visibles.
- **Le sujet `notifications` n'est pas un flux amont** : le hub distingue `feeds` (ce qu'il consomme)
  et `subjects` (ce qu'un client demande) ; le statut de `notifications` recopie celui de
  `billing.alerts`, dans `setStatus`, chez le porteur comme chez les suiveurs.
- **Marquage idempotent sans audit quand rien ne change** : déjà lue → 204, aucune ligne d'audit.
- **Copie** : la mention sans `billing:read` commence par sa conséquence (règle de copie, qui prime
  sur le libellé du plan) ; l'infobulle dit « reçues par le serveur » et non « pendant que le tableau
  de bord tournait », qui se lisait « tant que mon onglet était ouvert ». Un marquage refusé affiche
  le refus du serveur (`Refusal`), au lieu d'un bouton qui revient sans rien dire.
- **Déclencheur sans compte tant que la liste n'est pas lue** : « Notifications » seul, jamais
  « aucune non lue » sur une liste en chargement ou en échec.

## Tableau des mutations

Jouées le 27/09/2026, chacune compilée, restaurée par `cp`, arbre propre vérifié, `go test -count=1`.
1 à 13 dans un worktree isolé (HEAD `cabe11f`) ; 14 à 16 par les implémenteurs des corrections, après
commit ; 17 par le contrôleur. Chaque ligne nomme le test qui tombe.

| # | Mutation (le défaut réel qu'elle rejoue) | Ce qui tombe |
|---|---|---|
| 1 | `internal/permissions/notifications.go` — retrait de l'entrée `billing_alert_stream` de `NotificationSourceKeys` | `TestBillingNotificationsNeedBillingRead` (`Not equal: expected []string{"billing_alert_stream"}, actual []string{}`), `TestAnUnknownSourceIsVisibleToNobody` (`Should be true`) |
| 2 | `internal/store/notifications.go` `Page` — retrait de `source = ANY($2)` de la requête de liste, filtrage en Go après lecture (le comptage des non lues reste inchangé) | `TestAPageHoldsOnlyVisibleSourcesAndStaysFull` (`should have 20 item(s), but has 11` — la page n'est plus pleine : le filtrage post-lecture réduit une page de 20 lignes brutes à 11 lignes visibles au lieu de recharger jusqu'à en avoir 20) |
| 3 | `internal/hub` `publishNotification` sans le contrôle `NotificationSourceAllowed` (offert à tout abonné) | `TestANotificationReachesOnlySocketsAllowedItsSource` (`Should be false` — la trame arrive à une socket qui n'a pas `billing:read`), `TestARevokedPermissionStopsNotificationFrames` (`Should be false`) |
| 4 | `internal/hub/hub.go` — retrait de l'appel `setGranted` à la revalidation (celui de l'ouverture reste) | `TestARevokedPermissionStopsNotificationFrames` (`Should be false` — après révocation, `c.granted` reste `["billing:read"]`, la notification suivante arrive quand même) |
| 5 | `internal/bff/notifications.go` `MarkNotificationRead` — 403 `PermissionRefusee` au lieu de 404 pour `ErrNotificationUnknown` | `TestScenarios/marquer_une_notification_invisible_répond_comme_si_elle_n'existait_pas` (`le serveur a répondu 403 au lieu de 404`) |
| 6 | `internal/store/notifications.go` `MarkRead` — retrait de `record(ctx, tx, event)` (retourne `nil`) | `TestMarkingTwiceWritesOneAuditLine` (`Not equal: expected int(1), actual int64(0)` — aucune ligne d'audit écrite) |
| 7 | `Page` — `read` calculé pour un autre opérateur (`jsonb_build_array($1::text || 'x')`) | `TestReadIsPerOperator` (« Should be true ») — première version mal construite (retrait de `$1`, refus de préparation 42P18) rejouée |
| 8 | `internal/hub/upstream.go` `notify` — publication avant l'écriture (id vide), trame construite depuis une `Notification` sans id, puis enregistrement | `TestTheLeaseHolderRecordsThenBroadcastsTheNotification` (`Not equal` — `id` vide au lieu de `"n-1"`, `createdAt` horloge murale au lieu de l'horodatage écrit) |
| 9 | `web/src/components/notification-toasts.tsx` — retrait de l'appel `invalidateQueries` | `rereads the notification center on each frame` (`expected 1 to be 2` — le centre n'est jamais relu après une trame) |
| 10 | `web/src/components/notification-center.tsx` — l'explication `billing:read` s'affiche sans condition | `does not explain what the operator already holds` (`expected <p class="notifications__notice">…</p> to be null`) |
| 11 | `internal/hub/hub.go` `setStatus` — arrêt du report du statut de `billing.alerts` sur `notifications` | `TestNotificationsFollowTheBillingFeedStatus` (`Received unexpected error: failed to get reader: context deadline exceeded` — le test attend la trame de statut `notifications` que le report supprimé ne produit plus ; **re-mesuré en isolation sans aucun `go test` concurrent, même échec reproduit à l'identique en 5,01 s** — le délai est celui du propre garde-fou d'attente du test, pas une contention externe) |
| 12 | `internal/bff/notifications.go` `ListNotifications` — passe toutes les sources (`slices.Collect(maps.Keys(permissions.NotificationSourceKeys))`) au lieu de `reader.sources` | `TestScenarios/sans_billing:read,_l'alerte_n'arrive_ni_sur_la_socket_ni_au_centre` (`le centre compte 1 non lues, 0 attendues` — l'alerte de facturation apparaît au centre d'un opérateur qui n'a pas `billing:read`) |
| 13 | `internal/bff/notifications.go` `readerOf` — contrôle d'élévation sauté (`if false && !resolved.Elevated`) | `TestScenarios/sans_second_facteur,_le_centre_est_refusé` (`le serveur a répondu 200 au lieu de 403`) |
| 14 | `notification-center.tsx` — `<Refusal error={mark.error} />` retiré | les deux tests de marquage refusé (503 avec corps, 503 sans corps) |
| 15 | `notification-center.tsx` — `unreadCount ?? 0` rétabli | `claims no count while the list cannot be read` |
| 16 | `readerOf` — branche 401 neutralisée (`if false && !alive`) | scénario `sans session, le centre est refusé` (403 au lieu de 401) |
| 17 | `realtime-status.tsx` — `if (topics.length === 0) return null` neutralisé | `leaves out a topic the server refused` |

## Critère 4 — ce qu'aucun test ne garde
- **La fenêtre de bascule du bail.** Un ancien porteur qui n'a pas encore constaté la perte du bail
  consomme encore : la même alerte peut s'écrire deux fois et partir deux fois. Si le bail tombe
  pendant l'écriture, la ligne est écrite mais la trame ne part pas (contexte annulé) : elle apparaît
  au centre au prochain chargement, sans toast. Aucun test ne joue deux instances sur la trame
  `notifications` ni sur le statut recopié par Redis — le chemin est celui du porteur, partagé.
- **`notify` retient la lecture du flux de facturation** jusqu'à environ deux `leaseEvery` (2 s
  d'écriture, 2 s de publication) par alerte quand la base est lente ; les autres flux n'en
  dépendent pas. Réutiliser la période du bail comme délai d'écriture est un couplage assumé.
- **La page et `unreadCount` sont deux lectures** : une alerte écrite entre les deux peut décaler le
  compte d'une unité jusqu'à la lecture suivante.
- **`id::text = $2` au marquage** rend un id non UUID en 404 plutôt qu'en 500, au prix de l'index sur
  `id` ; la table n'a pas de rétention (dette 013). Remède quand le volume compte : valider l'UUID en
  Go.
- **Plafond CSS du chargement à froid** (`web/cold-load.test.ts`, 32 768 o) : 3 octets de marge
  après cette step. La prochaine règle CSS le fera rougir sans rapport avec son diff.

## Definition of Done
- [x] `make check` vert, `make e2e` vert (27/09/2026 ; en local sous `env -u FORCE_COLOR` : le shell
      exporte `FORCE_COLOR=3`, qui colore la sortie de Prism et fait rougir
      `TestTheMockServesEveryOperationTheContractDeclares` sur `main` aussi).
- [x] Invariants : aucun champ de trame hors des DTO déclarés (`details` décodé dans `BillingAlert`) ;
      aucun journal ne cite une trame (`PgError.Error()` ne rend pas `Detail`, `pgconn/errors.go`)
      (a) ; les deux routes gardées par `readerOf` et le filtre SQL, le marquage audité dans sa
      transaction (c) ; une base en échec laisse passer `billing.alerts` (e).
- [x] Clavier et libellés : le panneau s'ouvre, se parcourt et se ferme au clavier, le focus revient
      au déclencheur ; le compteur est dit en toutes lettres (« Notifications, 2 non lues »).
- [x] Critère 2 : descriptions relues contre leurs clés ; copie du panneau relue contre le serveur ;
      références à la spec passerelle citées par section (§6.9), un numéro de ligne d'un autre dépôt
      ayant déjà bougé le jour même.
- [x] Critère 4 écrit ci-dessus.

## Hors périmètre
- Webhook Alertmanager (step-181), évaluateur (step-182), canaux email / webhook / Slack (M9).
- « Tout marquer comme lu », filtres du panneau, route pleine page.
- Rétention de la table (dette 013). Drain des sockets → step-047.
- Rattraper une alerte perdue pendant une bascule ou une panne de base : au mieux une fois, par
  décision.
