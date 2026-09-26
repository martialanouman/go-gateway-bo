# step-043 — Hub WebSocket Go : trois flux passerelle agrégés en une socket client

> **Jalon :** M2 (§4.1, §4.2, §5.2) · **Statut :** À FAIRE
> **Dépend de :** step-009, step-036, step-040 · **Bloque :** step-044, step-045

## But
`/ws` rend 501 depuis step-002. Il devient la socket unique de l'opérateur : le BFF consomme les trois
flux amont (`stream-metrics`, `stream-sessions`, `stream-billing-alerts`), les ré-émet par sujet
dans l'enveloppe du §5.2, et ne livre à chaque socket que les sujets que ses permissions ouvrent. Une
instance, un consommateur par flux : la HA (bail Redis, Pub/Sub) est la step-044.

## Décisions (arbitrées, ne pas rouvrir)
- **Trames amont décodées par des structs locaux.** Le contrat, y compris sa dernière version publiée
  (6.8.0 le 26/09/2026), ne décrit les trames qu'en une phrase de `description`. Le BFF déclare ses
  trois structs d'après `go-gateway/internal/metricstream/metricstream.go` (source citée au-dessus de
  chacun). Un `v` inconnu jette la trame et le journalise. **Dette 057** dans `debts/`, payée
  par une PR amont qui déclare les trois schémas en `components`, suivie d'un bump. *Arbitré le
  26/09/2026 avec l'utilisateur.*
- **`metrics.traffic` relaie, il n'agrège pas.** Un Snapshot par réplica amont, relayé comme DTO
  déclaré (`instance`, `emittedAt`, `samples`). La somme des compteurs et le max des jauges de groupe
  arrivent avec leur premier consommateur (step-081). *Arbitré le 26/09/2026 avec l'utilisateur.*
- **Trois sujets, trois gardes.** `metrics.traffic` : tout opérateur authentifié, la même règle que
  l'entrée « Trafic » du rail (`web/src/lib/navigation.ts`, le catalogue n'a aucune clé pour la
  lire). `sessions.events` : `sessions:read`. `billing.alerts` : `billing:read`. `metrics.connectors`
  (M4) et `notifications` (step-046) n'existent pas encore : un abonnement à ces sujets est refusé
  comme un sujet inconnu.
- **Aucun octet amont ne traverse tel quel.** Chaque trame sortante est un struct Go déclaré. Le
  corps d'un message n'est dans aucun des trois flux, et le DTO rend impossible qu'il y entre sans
  modifier le struct.
- **Un client lent est coupé, pas rattrapé.** File de 64 trames par socket. Quand elle est pleine, la
  socket se ferme en 1008 : « Connexion trop lente : les messages en retard ont été abandonnés. » Si
  on jetait des trames une à une, on pourrait perdre en silence une trame d'état (`stale`/`live`).
  En reconnectant, le client reçoit l'état courant.
- **La session est relue toutes les 30 s** sur chaque socket, **sans être prolongée**
  (`store.Sessions.Alive`) : `Resolve` repousse la fenêtre d'inactivité, et un onglet ouvert
  garderait sinon la session vivante indéfiniment. Session morte (déconnexion, compte
  désactivé, expiration) : fermeture en 4401. Permissions relues au même moment : un sujet qui n'est
  plus permis se désabonne, avec un refus qui nomme la clé.
- **Mode mock : pas d'exception.** Prism ne parle pas WebSocket. Le consommateur appelle quand même,
  échoue, et ses sujets restent `stale`. Aucune branche propre au mode.

## Périmètre (ce que fait CETTE PR)

### Contrat du BFF
- Les messages de la socket sont décrits dans `api/openapi-bff.yaml`, en `components` (`Realtime*`,
  `TrafficSnapshot`, `SessionEvent`, `BillingAlert`). **`/ws` n'y est pas une opération** : les
  cinq portes de `internal/bff` exigent que toute opération du contrat soit servie par le serveur
  strict engendré, et une montée de protocole n'a pas de réponse qu'il saurait typer. La déclarer
  sous `/api` l'aurait fait entrer dans ce moule, et un `servers` propre au chemin n'est pas lu par le
  routeur `legacy` de kin-openapi. Les scénarios valident donc chaque refus contre `Error` et chaque
  message reçu contre son schéma. *(Constaté en implémentation le 26/09/2026.)*
- Serveur → client : `{topic, ts, data}` ; `{topic, status: "live"|"stale", since}` ;
  `{topic, error: {code, message}}`. Client → serveur : `{action: "subscribe"|"unsubscribe",
  topics: [...]}`. Lecture bornée à 4 Kio par message.

### `internal/hub`
- **Consommateur amont**, une goroutine par flux : le client HTTP mTLS + jeton machine de
  `internal/gateway` (exposé pour le dial, pas recopié), puis `websocket.Dial`. À la chute : `stale`
  diffusé avec `since`, reprise en backoff 1 s doublé, plafonné à 30 s. À la reprise : `live`.
- **Hub** : registre des abonnements par sujet, diffusion non bloquante vers les files, une
  goroutine d'écriture par socket, tout arrêté par annulation de contexte (fermeture 1001). Le drain
  en déploiement roulant est la step-047.
- **Upgrade** (`internal/bff/realtime.go`), refus en JSON **avant** la montée : origine jugée par
  `comesFromDashboard` contre `deps.Origin`, sinon 403 `forbidden_origin` (`requireSameOrigin` laisse
  passer les GET) ; sans session vivante, 401 ; sans second facteur, 403 `mfa_required` ; ni
  `withAPIDeadlines` ni `ReadTimeout` sur `/ws` (`internal/bff/durcissement.go:166-173` le demande).
  À l'abonnement : sujet permis → `status` courant, puis les trames.
- Aucune écriture d'audit : s'abonner est une lecture, et l'invariant (c) ne vise que les mutations.

### Dépendance
- `github.com/coder/websocket` v1.8.15 : dernière version sur `proxy.golang.org` (publiée le
  15/06/2026), aucun avis sur OSV, relevé le 26/09/2026. C'est aussi celle de `go-gateway`.

## Tests (écrits dans la même PR)
- **Faux amont** : un serveur `httptest` + `coder/websocket` qui émet des trames écrites d'après
  les structs de `go-gateway/internal/metricstream`, et qui exige un `Bearer`. C'est la seule exception au mock Prism, et elle est écrite à côté du
  `.feature` : Prism ne sert pas de WebSocket.
- **godog** (`cmd/dashboard/temps-reel.feature`, à côté des autres scénarios qui lancent le binaire :
  session, origine et permissions demandent le serveur entier) : un abonnement permis reçoit ses trames ; un sujet
  non permis est refusé, et le refus nomme la clé ; la chute d'un flux rend son sujet `stale` pendant
  que les deux autres continuent (invariant e) ; la reprise le rend `live` ; un client lent est
  coupé ; une session révoquée ferme la socket ; une origine étrangère reçoit 403 ; sans session, 401.
  Le client lent et la session révoquée sont prouvés en unitaire (`internal/hub`) : le premier ne se
  fabrique pas contre un binaire, le second attendrait 30 s.
- **Go** : décodage des trois trames et `v` inconnu ; sérialisation des DTO sortants ; file bornée ;
  **fuite** : 500 sockets ouvertes puis fermées, retour au `runtime.NumGoroutine()` initial.
- **Mutations** : garde au sujet, contrôle d'origine, relecture de session, borne de file, `stale` à
  la chute, contrôle de `v`, désabonnement qui libère la file. Toutes jouées en worktree, `-count=1`,
  avec le nom du test qui tombe.

## Definition of Done
- [ ] `make check` vert
- [ ] Aucune trame amont relayée brute : chaque émission passe par un struct déclaré, vérifié sur le
      livré.
- [ ] Écart de contrat consigné dans la PR : 4.0.2 installé, 6.8.0 publié. Les trois opérations
      `stream-*` ne diffèrent que par un 403 ajouté.

## Hors périmètre
- HA, bail Redis, Pub/Sub → step-044. Client React, `useTopic`, reconnexion → step-045.
  Notifications → step-046. Drain et déploiement roulant → step-047.
- Agrégation des métriques, `metrics.connectors` → M4 (step-081, step-084).
- Bump du contrat : sa propre PR `chore`, jamais au milieu d'une step.
