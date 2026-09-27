# step-045 — Client WS React : abonnement par sujet, reconnexion, `isLive` / `isStale`

> **Jalon :** M2 (§1.6, §5.2) · **Statut :** FAIT
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
- **`useTopic(topic, onMessage?)`** rend `{ data, ts, isLive, isStale, since, error }`. `data`
  garde la dernière trame reçue : une coupure n'efface rien, elle marque (invariant e). `onMessage`
  sert les consommateurs d'événements (les toasts), qui n'ont que faire de la dernière valeur.
- **Vivant, périmé.** `isLive` : socket ouverte **et** dernier statut serveur `live`. Avant le premier
  statut, ni vivant ni périmé : c'est un chargement. Statut serveur `stale` : périmé aussitôt, `since`
  repris du serveur. Socket fermée : `isLive` tombe aussitôt, `isStale` passe vrai après **3 s** de
  tolérance (§1.6 : 2 à 5 s), `since` = l'instant de la coupure. Entre les deux, « Connexion en
  cours » — vrai à la première ouverture comme à la reprise. Le point pulsant ne s'affiche que sur
  `isLive`.
- **Arbitrages du 27/09/2026.** Un sujet que le serveur disait déjà `stale` garde son `since` à la
  coupure : « périmé depuis » ne rajeunit jamais la donnée (prime sur « `since` = l'instant de la
  coupure » pour ces sujets). `since` s'efface avec le statut. Seule la perte d'une socket ouverte
  date la coupure : une tentative de reconnexion qui échoue ne la fait pas recommencer. Aucune
  minuterie de péremption sur 4401 : `ended` ne passe jamais en périmé.
- **Reconnexion** : backoff exponentiel de 1 s à 30 s, gigue pleine, remis à zéro à chaque ouverture
  — les bornes du hub vers l'amont. **4401** (session finie) : aucune reconnexion, la session `me`
  est invalidée et la coquille affiche « Aucune session ouverte ». **1008** (client lent) et **1001**
  (serveur qui s'arrête) : reconnexion. Un échec de montée (403 d'origine ou de second facteur) n'est
  pas lisible par le navigateur : il suit le backoff.
- **`permission_denied`** sur un sujet : `error` exposé au consommateur, sujet retiré du réabonnement.
  Un consommateur qui connaît la permission ne s'abonne pas du tout (`usePermission`). Tout refus qui
  porte un sujet est définitif — `permission_denied` et `unknown_topic` ; `invalid_message` n'en porte
  pas (`internal/hub/hub.go`, `handle`). Le refus efface statut et `since` : un retrait de permission
  à la revalidation arrive sur un sujet `live`, qui ne doit plus s'afficher en direct. Le dernier
  départ envoie `unsubscribe` sans condition : pour un sujet refusé, le hub n'a rien à retirer.
- **Indicateur** (`TopBar`, `StatusPill` de dimension `link`) : « En direct » (point pulsant),
  « Connexion en cours », « Données périmées depuis HH:MM », « Session terminée ». Il agrège les
  sujets abonnés : un seul périmé suffit à l'afficher, et le plus ancien `since` fait foi. Il ignore
  les sujets refusés, qui ne recevront jamais de statut. « Données périmées » et « Connexion en
  cours » sont ambre (`reconnecting`, la teinte du dégradé), « Session terminée » rouge (`down`).
- **Toasts de facturation** : `billing.alerts` abonné seulement avec `billing:read`. Chaque trame
  pousse un toast, source `bff`. Copie propre à `mo_floor_reached`, repli générique pour une valeur
  inconnue — le contrat annonce que d'autres viendront. `owner_type` est traduit (`customer` → « du
  client », `smpp_account` → « du compte SMPP … du client »), la valeur brute en repli. Rien n'est rejoué après une coupure : Pub/Sub
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
- **Playwright** : `webServer` devient un tableau — le faux amont sur `127.0.0.1:4011` (`make e2e`
  construit `bin/fakegateway` avant), puis le binaire, dont `DASHBOARD_GATEWAY_BASE_URL` le désigne.
  Le point de contrôle : `GET /control/ready`, `POST /control/emit?feed=…`, `POST /control/cut?feed=…`.
  Les commentaires de `DASHBOARD_REDIS_URL` et `DASHBOARD_GATEWAY_BASE_URL` corrigés.
- **CI** : le job e2e reçoit un service Redis. Le binaire démarre sans lui, mais aucun sujet ne passe
  alors « En direct », et le parcours l'attendrait en vain.
- **Dette 059 non payée ici, portée par step-046.** Son retrait ne peut venir qu'après le
  **27/09/2026 21:37 UTC**, quand la 6.9.0 a 24 h : mesuré le 27/09 à 12:32 UTC, `pnpm install
  --frozen-lockfile` sans l'exception rend `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`. Clore la step
  n'attend pas cette heure. *Arbitré le 27/09/2026 avec l'utilisateur.*

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
  périmées ». Le hub republie `stale` dès l'échec de lecture sur le flux amont coupé, avant le
  backoff (`internal/hub/upstream.go`) : mesuré à 4-6 ms sur le binaire livré, deux mesures ; le
  parcours tolère 5 s.
- **Mutations** : comptage de références (`unsubscribe` au premier démontage), réabonnement omis,
  garde 4401 retirée, tolérance à 0, filtre `billing:read` retiré, point pulsant sans `isLive`.
  Chacune nomme le test qui tombe — tableau ci-dessous.

## Tableau des mutations

Jouées le 27/09/2026, chacune après un commit, fichier restauré par `cp` et arbre propre vérifié ;
Vitest sans couverture sur les fichiers de test concernés, le parcours par `make e2e`. Chaque ligne
nomme le test qui tombe.

| Mutation (le défaut réel qu'elle rejoue) | Ce qui tombe |
|---|---|
| `unsubscribe` au premier démontage (comptage de références) | `unsubscribes only when the last subscriber leaves` |
| Réabonnement omis à l'ouverture | `subscribes pending topics in one message once the socket opens`, `reconnects after an abnormal close and resubscribes live topics only`, `records a permission refusal and does not resubscribe the topic` |
| Garde 4401 retirée (traitée comme une coupure ordinaire) | `never reconnects after 4401 and reports the session ended` |
| Tolérance à 0 (`STALE_AFTER_MS = 0`) | `is not stale 2999 ms after a close, and stale at 3000 ms, keeping its data`, `does not go stale when the socket reopens within the tolerance, after a failed retry`, `keeps the original cut while reconnect attempts fail` |
| Minuterie de péremption non effacée à l'ouverture | `does not go stale when the socket reopens within the tolerance, after a failed retry`, `leaves no timer behind and never reconnects once stopped` |
| Une tentative échouée recommence la coupure (`wasOpen` retiré) | `does not go stale when the socket reopens within the tolerance, after a failed retry` |
| Un `stale` serveur oublié à la coupure (saut `status === 'stale'` retiré de `#forgetStatuses`) | `keeps the earlier since of a topic the server already reported stale`, `keeps the original cut while reconnect attempts fail` |
| Sujet refusé marqué périmé (`!entry.denied` retiré de `#markStale`) | `never marks a refused topic stale` |
| `denied` jamais posé sur un refus | `records a permission refusal and does not resubscribe the topic`, `reconnects after an abnormal close and resubscribes live topics only`, `never marks a refused topic stale` |
| Refus qui garde le statut `live` | `stops reporting live once the server withdraws the permission` |
| Refus qui garde `since` | `stops reporting live once the server withdraws the permission` (vert à la première passe : l'assertion ne portait que sur `isLive`, `since` ajouté) |
| `stop` qui garde la minuterie de reconnexion | `leaves no timer behind and never reconnects once stopped` |
| Réf. `latest` retirée : le rappel dans les dépendances de l'abonnement (réabonnement à chaque rendu) | 15 tests, dont `keeps a single subscription while toasts come and go`, `says the data is live, with a pulse` |
| Nettoyage `unsubscribe` de `useTopic` retiré | `unsubscribes once the session loses billing:read` |
| `onSessionEnded` qui n'invalide plus `me` | `a 4401 close brings the no-session screen` |
| Filtre `billing:read` retiré | `does not subscribe without billing:read`, `unsubscribes once the session loses billing:read`, `shows nothing while no topic is subscribed` |
| L'indicateur compte les sujets refusés | `leaves out a topic the server refused` |
| Branche périmée retirée de l'indicateur | `says since when the data is stale`, `gives no time for a stream never joined`, `announces a degraded state to screen readers` |
| Point pulsant sans `isLive` (« Connexion en cours » `live`) | `says it is connecting before the socket first opens`, `says it is connecting again once the socket drops, without a pulse` |
| `role="status"` retiré de l'enveloppe de l'indicateur | `announces a degraded state to screen readers`, `says the data is live, with a pulse` |
| Région live imbriquée (`announce={false}` retiré) | `says the data is live, with a pulse` (deux `role="status"`) |
| `announce` de `StatusPill` à `false` par défaut | `is a live region only when it is actually live` |
| Branche `smpp_account` retirée (repli brut) | `pushes a toast for each billing alert`, `names an unknown alert without inventing its meaning` |
| Fournisseur temps réel jamais activé (`<Frame live={false}>` dans la branche avec session) | parcours `shell.spec.ts` : `getByRole('banner').getByText('En direct')` introuvable après 15 s |
| Plus récent `since` au lieu du plus ancien (`Math.max`) | **rien** : un seul sujet abonné par le produit, voir critère 4 |

## Critère 4 — ce qu'aucun test ne garde

- **Le plus ancien `since`** : `Math.max` reste vert (vérifié) tant que `billing.alerts` est le seul
  sujet abonné. Écrit aussi dans `realtime-status.tsx` ; le premier consommateur de M4 apporte le test.
- **La validation des flux de `/control`** (400 sur un flux inconnu) : aucun test Go ; le parcours
  n'appelle que des flux connus.
- **4401 puis relecture de `me` qui échoue ou rend 200** : la coquille garde la session déjà lue, le
  fournisseur reste actif et la connexion reste `ended` — « Session terminée » jusqu'au rechargement.
- **Un sujet abonné pendant la tolérance d'une coupure** est marqué périmé à l'instant de la coupure,
  et non « Connexion en cours ».
- **Socket à demi ouverte** : le client n'envoie aucun battement ; un chemin TCP mort sans fermeture
  garde « En direct » jusqu'au délai du système. Hors périmètre.

## Definition of Done
- [x] `make check` vert, `make e2e` vert (`rc=0` tous deux le 27/09/2026 ; CI verte sur la PR #117).
- [x] Aucune donnée de trame dans une URL, un journal ou un cache persisté (invariant a) : le magasin
      vit en mémoire de l'onglet, vérifié sur le livré — aucun `console.`, stockage du navigateur ni
      écriture d'URL dans `realtime.ts`, `realtime-status.tsx`, `billing-alert-toasts.tsx`.
- [x] Clavier et libellés : l'indicateur est un texte lisible, pas une couleur seule (WCAG 2.1 AA).
      Les états dégradés sont annoncés (4.1.3) : une région `role="status"` enveloppe l'indicateur en
      permanence, vide sans sujet, et la pilule « En direct » n'en ouvre pas une seconde
      (`announce={false}`) ; les pilules des tableaux restent sans région live.

## Hors périmètre
- Centre de notifications, sujet `notifications` → step-046. Drain des sockets → step-047.
- Widgets de trafic et moniteur de sessions, consommateurs de `metrics.traffic` et `sessions.events`
  → M4. `metrics.connectors` : le hub ne le sert pas.
- Rejouer ce qui a été perdu pendant une coupure : au mieux une fois, par décision (step-044).
- Battement de cœur côté client pour détecter une socket à demi ouverte.
- Retrait de l'exception de quarantaine pnpm (dette 059) → step-046.
