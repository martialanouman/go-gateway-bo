# step-047 — Arrêt propre : drain des sockets, déploiement roulant sans session perdue

> **Jalon :** M2 (§1.6 ; spec §4.1) · **Statut :** À FAIRE
> **Dépend de :** step-044, step-045 · **Bloque :** aucune

## But
Sur SIGTERM, le hub ferme déjà chaque socket en 1001 et rend son bail, mais le binaire n'attend pas
ces fermetures : `http.Server.Shutdown` ne suit pas les connexions détournées, et le process peut
sortir avant que la trame de fermeture parte. Le client voit alors une coupure brute au lieu d'un
« le serveur s'arrête ». Désormais l'arrêt attend que chaque socket ait envoyé son 1001, dans le
délai de grâce existant, et un scénario à deux instances prouve qu'un opérateur coupé sur l'une
retrouve le temps réel sur l'autre avec sa session.

## Décisions (arbitrées, ne pas rouvrir)
- **Périmètre : drain et preuve.** La sonde de disponibilité, qui retire l'instance du load balancer
  avant la fermeture des sockets, reste en step-186 comme le prévoit la spec (`GET /health`, §5.1).
  *Arbitré le 27/09/2026 avec l'utilisateur.*
- **Le hub compte les sockets qu'il sert.** `Serve` s'inscrit en entrée et se retire en sortie, sous
  un verrou qui porte aussi un drapeau « arrêt en cours ». Une montée qui arrive après ce drapeau est
  fermée aussitôt en 1001, sans s'inscrire : un compteur incrémenté pendant qu'on l'attend est une
  course, et une socket acceptée pendant l'arrêt n'aurait personne pour la fermer.
- **`Run` rend la main après le drain.** Sur annulation, il ferme `stopping` — chaque socket envoie
  déjà son 1001 —, attend que toutes aient quitté `Serve`, puis rend le bail comme aujourd'hui.
- **Aucun délai nouveau.** L'attente est bornée par `DASHBOARD_SHUTDOWN_TIMEOUT` (15 s par défaut,
  `internal/config/config.go`). Au-delà, le binaire journalise le nombre de sockets encore ouvertes
  et sort : un arrêt ne pend jamais, l'orchestrateur tuerait le process de toute façon. La fermeture
  d'une socket prend au plus 10 s dans `coder/websocket` v1.8.15 — 5 s pour écrire la trame, 5 s
  pour attendre la réponse du client (`close.go`, `writeClose` et `waitCloseHandshake`) —, sous le
  délai par défaut.
- **Ordre à l'arrêt.** `Shutdown` (écoute fermée, requêtes HTTP en vol attendues) et le drain des
  sockets courent en parallèle sous le même délai de grâce ; le bail est rendu par `Run` après le
  drain. Une montée déjà acceptée avant la fermeture de l'écoute est couverte par le drapeau.
- **« Sans session perdue » est une propriété, prouvée, pas un mécanisme nouveau.** Les sessions
  vivent en PostgreSQL, partagées entre instances ; le client de step-045 se reconnecte sur 1001
  avec son cookie. Le scénario le démontre au lieu de le supposer.

## Périmètre (ce que fait CETTE PR)
- **Contrat Admin** : 6.9.0, relevé le 27/09/2026 à 23:25 UTC, dernière version publiée. Non touché.
- **Serveur** : compteur et drapeau dans `internal/hub/hub.go` ; `Run` qui attend le drain ; câblage
  et délai de grâce dans `cmd/dashboard/main.go` et `cmd/dashboard/server.go`.
- **Contrat BFF** : la phrase « 1001 quand le hub s'arrête, que l'arrêt du binaire n'attend pas
  encore (le drain est la step-047) » de `api/openapi-bff.yaml` devient vraie de l'état livré.
- **Scénarios** : `cmd/dashboard/high-availability.feature` étendu ; le commentaire de
  `graceful-shutdown.feature`, qui dit ce que le scénario n'observe pas, relu contre l'état livré.

## Tests (écrits dans la même PR)
- **Unitaires Go (`internal/hub`)** :
  - `Run` ne rend pas la main tant qu'une socket servie n'a pas reçu son 1001 : le client lit le
    code avant que `Run` revienne ;
  - une montée servie après l'annulation reçoit 1001 et ne fait ni paniquer ni pendre `Run` ;
  - un client qui ne répond jamais à la fermeture ne retient pas `Run` au-delà du délai donné.
- **godog (`high-availability.feature`)**, deux instances, le binaire réel : socket ouverte sur la
  première avec une session élevée et un sujet « live » → SIGTERM sur la première → la socket reçoit
  **1001** → la socket rouverte sur la seconde **avec le même cookie** s'abonne et voit le sujet
  « live ».
- **Mutations** (tableau à la clôture, chacune nommant le test qui tombe) : attente du drain retirée
  de `Run` ; drapeau d'arrêt ignoré (montée tardive inscrite) ; borne du délai retirée. Une mutation
  sur une course se mesure sur plusieurs passes, et le nombre de passes s'écrit avec le résultat.

## Definition of Done
- [ ] `make check` vert, `make e2e` vert.
- [ ] Invariant (e) : un arrêt ne pend jamais au-delà du délai de grâce, même face à un client muet.
- [ ] Critère 2 : `openapi-bff.yaml`, `graceful-shutdown.feature` et les commentaires de l'arrêt
      relus contre le code livré.
- [ ] Critère 4 écrit là où il vit.

## Hors périmètre
- Sonde de disponibilité, retrait du load balancer avant fermeture, affinité WS → step-186.
- Chunks paresseux qui survivent à un déploiement roulant → step-186.
- Répartir les reconnexions dans le temps : le client de step-045 tire déjà un backoff à gigue
  pleine depuis 1 s.
