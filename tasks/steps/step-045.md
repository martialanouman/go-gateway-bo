# step-045 — Client WS React : abonnement par sujet, reconnexion, `isLive` / `isStale`

> **Jalon :** M2 (§1.6, §5.2) · **Statut :** À FAIRE
> **Dépend de :** step-043, step-044 · **Bloque :** step-046

## But
Le hub de step-043 et step-044 diffuse trois sujets sur `/ws`, et aucun écran ne l'ouvre. Désormais
la coquille tient une socket par onglet, les composants s'abonnent par sujet avec `useTopic`, la
connexion se rétablit seule, et deux consommateurs le rendent visible : un indicateur « Temps réel »
dans la barre supérieure, et les alertes de facturation dans la pile de toasts de step-042.

## Décisions (arbitrées, ne pas rouvrir)
- **Aucune dépendance.** `WebSocket` natif, un module `web/src/lib/realtime.ts` : une connexion,
  un comptage de références par sujet, un magasin lu par `useSyncExternalStore`. Ni le cache TanStack
  Query (refetch et ramasse-miettes sans objet ici, comptage implicite par observateurs), ni
  `react-use-websocket` (ignore nos codes 4401 et 1008). *Arbitré le 26/09/2026 avec l'utilisateur.*
- **Le fournisseur est monté par `Shell`**, jamais par un test : un fournisseur que seul le harnais
  pose masque son absence en production. La socket s'ouvre au montage de la coquille, se ferme à son
  démontage.
- **Comptage de références.** Le premier `useTopic` d'un sujet envoie `subscribe`, le dernier démonté
  `unsubscribe`. À chaque ouverture, les sujets dont le compte est non nul sont réabonnés en un seul
  message.
- **`useTopic(topic, { onMessage? })`** rend `{ data, ts, isLive, isStale, since, error }`. `data`
  garde la dernière trame reçue : une coupure n'efface rien, elle marque (invariant e). `onMessage`
  sert les consommateurs d'événements (les toasts), qui n'ont que faire de la dernière valeur.
- **Vivant, périmé.** `isLive` : socket ouverte **et** dernier statut serveur `live`. Avant le premier
  statut, ni vivant ni périmé : c'est un chargement. Statut serveur `stale` : périmé aussitôt, `since`
  repris du serveur. Socket fermée : `isLive` tombe aussitôt, `isStale` passe vrai après **3 s** de
  tolérance (§1.6 : 2 à 5 s), `since` = l'instant de la coupure. Entre les deux, « Reconnexion ».
  Le point pulsant ne s'affiche que sur `isLive`.
- **Reconnexion** : backoff exponentiel de 1 s à 30 s, gigue pleine, remis à zéro à chaque ouverture
  — les bornes du hub vers l'amont. **4401** (session finie) : aucune reconnexion, la session `me`
  est invalidée et la coquille affiche « Aucune session ouverte ». **1008** (client lent) et **1001**
  (serveur qui s'arrête) : reconnexion. Un échec de montée (403 d'origine ou de second facteur) n'est
  pas lisible par le navigateur : il suit le backoff.
- **`permission_denied`** sur un sujet : `error` exposé au consommateur, sujet retiré du réabonnement.
  Un consommateur qui connaît la permission ne s'abonne pas du tout (`usePermission`).
- **Indicateur** (`TopBar`, `StatusPill` de dimension `link`) : « En direct » (point pulsant),
  « Reconnexion », « Données périmées depuis HH:MM », « Session terminée ». Il agrège les sujets
  abonnés : un seul périmé suffit à l'afficher.
- **Toasts de facturation** : `billing.alerts` abonné seulement avec `billing:read`. Chaque trame
  pousse un toast, source `bff`. Copie propre à `mo_floor_reached`, repli générique pour une valeur
  inconnue — le contrat annonce que d'autres viendront. Rien n'est rejoué après une coupure : Pub/Sub
  est au mieux une fois (step-044), et le centre de notifications persisté est step-046.
- **Faux amont partagé.** Le `fakeGateway` de `cmd/dashboard/realtime_test.go` passe dans un paquet
  `internal/fakegateway`, et `scripts/fakegateway` le sert en processus, avec un point de contrôle HTTP
  pour émettre une trame et couper un flux. Les scénarios godog et Playwright jouent le même faux
  amont, au lieu de deux copies qui divergeraient.

## Périmètre (ce que fait CETTE PR)
- **Contrat** : 6.9.0, relevé le 26/09/2026 à 23:52 UTC, dernière version publiée. Aucun écart.
- **Client** : `web/src/lib/realtime.ts` (connexion, magasin, `RealtimeProvider`, `useTopic`), monté
  dans `web/src/components/shell.tsx` ; indicateur dans `top-bar.tsx` ; toasts de facturation.
- **Faux amont** : `internal/fakegateway`, `scripts/fakegateway`, et `realtime_test.go` qui s'en sert.
- **Playwright** : second `webServer` (le faux amont), `DASHBOARD_GATEWAY_BASE_URL` du binaire pointé
  dessus, et le commentaire de `DASHBOARD_REDIS_URL` (« aucun parcours n'ouvre encore la socket »)
  corrigé.
- **Dette 059 payée** : l'exception de quarantaine de `web/pnpm-workspace.yaml` est retirée. Elle ne
  peut l'être qu'après le **27/09/2026 21:37 UTC**, quand la 6.9.0 a 24 h : avant, `pnpm install`
  refuse le contrat. Le commit qui la retire attend cette heure.

## Tests (écrits dans la même PR)
- **Vitest** (faux `WebSocket` global : une API du navigateur, pas un module du produit) :
  - deux `useTopic` du même sujet → un seul `subscribe` ; un démontage sur deux → aucun
    `unsubscribe` ; le dernier → `unsubscribe` ;
  - fermeture puis réouverture → réabonnement des sujets vivants, et d'eux seuls ;
  - 4401 → aucune nouvelle socket, session invalidée ; 1008 → une nouvelle socket ;
  - `isStale` faux à 2,9 s de coupure, vrai à 3 s ; `data` conservée ;
  - backoff plafonné à 30 s, remis à zéro après une ouverture ;
  - aucun abonnement à `billing.alerts` sans `billing:read` ; une trame → un toast ; `alert` inconnu
    → copie générique.
- **Playwright** (critère 1, en étendant `web/e2e/shell.spec.ts`, rien de simulé dans le produit) :
  connexion → « En direct » → alerte émise par le faux amont → toast → flux coupé → « Données
  périmées ».
- **Mutations** : comptage de références (`unsubscribe` au premier démontage), réabonnement omis,
  garde 4401 retirée, tolérance à 0, filtre `billing:read` retiré, point pulsant sans `isLive`.
  Chacune nomme le test qui tombe, jouée dans un worktree.

## Definition of Done
- [ ] `make check` vert, `make e2e` vert.
- [ ] Aucune donnée de trame dans une URL, un journal ou un cache persisté (invariant a) : le magasin
      vit en mémoire de l'onglet, vérifié sur le livré.
- [ ] Clavier et libellés : l'indicateur est un texte lisible, pas une couleur seule (WCAG 2.1 AA).

## Hors périmètre
- Centre de notifications, sujet `notifications` → step-046. Drain des sockets → step-047.
- Widgets de trafic et moniteur de sessions, consommateurs de `metrics.traffic` et `sessions.events`
  → M4. `metrics.connectors` : le hub ne le sert pas.
- Rejouer ce qui a été perdu pendant une coupure : au mieux une fois, par décision (step-044).
