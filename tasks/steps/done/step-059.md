# step-059 — Socle du relais vers la passerelle : première route, `errors[]`, journal, audit du proxy

> **Jalon :** M3 (§1.4, §1.11 ; spec §6.15) · **Statut :** FAIT
> **Dépend de :** step-047 · **Bloque :** step-060

## But
Aucune route du BFF n'appelle encore la passerelle : `internal/gateway` est câblé pour les flux temps
réel, jamais pour l'API Admin. Huit dettes attendent ce premier appel, parce qu'elles ne se mesurent
qu'avec lui : le journal serveur, `errors[]` au DTO d'erreur, la validation des requêtes, trois
réglages du transport et le trou d'audit d'une action relayée. Cette step les paie, et une seule route
de lecture, `GET /customer-groups`, les exerce. Le CRUD complet et l'écran viennent en step-060.

## Décisions (arbitrées, ne pas rouvrir)
- **Découpage en deux PRs.** Le socle part avec une route de lecture qui l'exerce, sans rester du code
  mort. Le CRUD et l'écran viennent en step-060. *Arbitré le 28/09/2026 avec l'utilisateur* :
  step-060 portait seule le CRUD, `errors[]` et huit dettes, soit une PR impossible à relire.
- **Une seule route, en lecture.** `GET /customer-groups` relaie `list-customer-groups` avec son
  filtre `status`, sous `groups:read`. Elle exerce le client câblé, la traduction d'erreur, `errors[]`
  (un `status` hors enum) et le journal d'un 500. Aucune mutation dans cette step, donc aucune ligne
  d'audit de proxy à écrire : le mécanisme (ci-dessous) est livré et testé ici, puis appelé par
  step-060.
- **`errors[]` au DTO `Error` du BFF** : `[{ field, message }]`, optionnel, dans la forme exacte de
  l'API Admin (§1.4, une seule forme d'erreur dans le produit). Un 422 amont est réexposé en 422 avec
  ses champs. `code` reste celui de la passerelle, jamais réinventé. Les messages amont partent au
  client, qui les affiche sous les champs ; ils restent hors du journal (`APIError`, invariant a).
- **Le journal atteint `internal/bff`, `internal/auth` et `internal/mfa`** : un `*slog.Logger` passé
  par `Dependencies`, celui que `cmd/dashboard` construit déjà. Un 500 journalise l'opération et
  l'erreur. Une `gateway.APIError` se journalise par son `Error()` rédigé : statut, code, noms de
  champs, jamais de message. Paie les dettes 002, 003 et 054.
- **La validation des requêtes se fait à l'exécution, contre le contrat BFF** : middleware
  `openapi3filter.ValidateRequest` et `embedded-spec: true` dans `api/oapi-codegen-bff.yaml`. Le refus
  de cette option (« une copie du contrat figée dans le binaire ») tombe : `bff.gen.go` est déjà cette
  copie figée, et `check-generated` la garde (dette 015). Un refus rend 400 `bad_request` avec
  `errors[]` champ par champ. Les maxima écrits à la main dans `auth.go` et `mfa.go` sont retirés dès
  que le contrat les porte. S'ils manquent au contrat, ils y entrent : deux bornes qui ne se
  connaissent pas, c'est ce que la dette nomme.
- **Le jeton machine s'obtient sous le contexte de l'appelant** (dette 016). Un `RoundTripper` à nous
  remplace `oauth2.Transport`. Le cache du jeton est gardé par un sémaphore à une place, pris par
  `select` sur `req.Context().Done()`. L'obtention passe par `clientcredentials.Config.Token(ctx)`,
  avec ce contexte. Un appelant qui renonce libère sa place. Si le premier appelant annule
  l'obtention, le suivant la relance. Le renouvellement dix secondes avant l'échéance est conservé.
- **Transport** : `Proxy: http.ProxyFromEnvironment`, comme `http.DefaultTransport`, paie la dette
  033. `MaxConnsPerHost` reçoit une borne en constante, et sa valeur se déduit à l'implémentation
  d'une mesure écrite dans cette fiche : requêtes concurrentes sous HTTP/2 (une connexion multiplexée)
  et sous HTTP/1.1, par instance. La dette 032 est payée quand la borne et sa mesure sont livrées
  ensemble.
- **Audit d'une action relayée : l'intention d'abord, fermé par défaut** (dette 031). La transaction
  commune est impossible, puisque l'action vit chez la passerelle. Une ligne `…` à `outcome: attempted`
  s'écrit **avant** l'appel. Si elle échoue, l'appel n'a pas lieu et la route rend 500 : aucune action
  sans trace. Après la réponse, une seconde ligne écrit `succeeded` ou `failed`, avec le statut. Une
  panne entre les deux laisse `attempted` seul, ce qui se lit « issue inconnue » et non « rien ».
  Livré ici en fonction du paquet `bff`, testé sans route, appelé par les mutations de step-060.
  *Arbitré par cette fiche, à valider en relecture.*

## Périmètre (ce que fait CETTE PR)
- **Contrat Admin** : 6.9.0, relevé le 28/09/2026 à 20:10 UTC, dernière version publiée. Non touché ;
  l'écart éventuel est relevé au premier commit.
- **Contrat BFF** : `GET /customer-groups` (paramètre `status`, réponse `CustomerGroup[]` en DTO
  déclaré) ; `Error.errors[]` ; la phrase « arrive avec la première route qui relaie la passerelle
  (step-060) » devient vraie de l'état livré. Régénération Go et TypeScript.
- **Serveur** : `NewAdminClient` câblé dans `cmd/dashboard` et passé à `Dependencies` ; handler
  `listCustomerGroups` et sa garde ; traduction vers `Error` (un 422 amont relayé avec ses champs ;
  429, 5xx et passerelle injoignable en 503 avec « Réessayer », jamais « module désactivé », §1.4 ;
  tout autre statut amont en 500 journalisé) ; logger ;
  validation des requêtes ; `RoundTripper` du jeton ; transport ; `auditRelayed`.
- **Les huit dettes payées, fichiers supprimés** : 002, 003, 015, 016, 031, 032, 033, 054.
- **Renvois** : les fiches archivées qui désignent step-060 comme « première route qui appelle la
  passerelle » ou porteur du journal et d'`errors[]` (step-003, 004, 023, 025, 027, 029, 031, 033,
  037) se lisent désormais step-059. Elles restent intactes, archives d'une décision ; la ligne de
  `tasks/todo.md` porte le renvoi. Les renvois vivants du code (`router.go`,
  `login.tsx`, `openapi-bff.yaml`) sont corrigés dans la PR des fiches.

## Mesure de `MaxConnsPerHost`

Relevée le 28/09/2026 sur un M4 Pro : un serveur HTTP/1.1 local, dont chaque réponse prend 20 ms,
reçoit 300 appels concurrents (le pic : 300 opérateurs sur une seule instance).

| `MaxConnsPerHost` | 300 appels | Pire latence |
|---|---|---|
| sans borne | 39 ms | 38 ms |
| 128 | 69 ms | 69 ms |
| **64** | **111 ms** | **111 ms** |
| 32 | 218 ms | 218 ms |

La passerelle impose HTTP/1.1 (`go-gateway`, `cmd/admin-api-svc/wiring.go:450`,
`NextProtos: ["http/1.1"]`) : une connexion porte une requête, donc la borne est celle des requêtes
en vol. **64 par instance** : au pic, une rafale n'ajoute qu'une centaine de millisecondes, et deux
instances ne tiennent jamais plus de 128 requêtes ouvertes chez la passerelle (invariant e).

## Tests (écrits dans la même PR)
- **godog (`cmd/dashboard/customer-groups.feature`, le succès contre Prism, les refus contre un
  faux amont)** : un opérateur `groups:read` voit la liste ; un opérateur
  sans `groups:read` reçoit 403 et une ligne `permission.denied` ; un `status` hors enum est refusé
  en 400 avec `errors[]` nommant `status`, **sans appel amont** ; une réponse d'erreur amont est
  réexposée dans la forme du produit, `errors[]` compris (faux amont qui rend un 422 à `errors[]` :
  Prism ne choisit pas son statut sur une requête que le BFF compose).
- **Unitaires Go** :
  - un 500 laisse une ligne de journal qui nomme l'opération, sans message amont ;
  - `auditRelayed` : ligne `attempted` écrite avant l'appel ; audit en panne ⇒ appel jamais fait ;
    issue `failed` sur 4xx/5xx amont ;
  - `RoundTripper` du jeton : un appelant qui annule pendant qu'un autre tient l'obtention revient
    avant le `Timeout` (`-race`) ; une seule obtention pour N appels concurrents ;
  - `HTTPS_PROXY` honoré, `NO_PROXY` aussi ;
  - validation : `{}` sur `POST /auth/login` refusé en 400 `errors[]` avant `Authenticator.Login` ;
    champ inconnu refusé.
- **Mutations** (tableau à la clôture, chacune nommant le test qui tombe, `-count=1`) : écriture
  `attempted` déplacée après l'appel ; sémaphore pris sans `select` sur le contexte ; `Proxy` retiré ;
  middleware de validation démonté ; `errors[]` écarté à la traduction ; logger réduit à `io.Discard`.

## Écarts à la rédaction, arbitrés pendant l'implémentation
- **Un 401 ou un 403 amont n'est pas relayé** : il refuse le jeton machine du BFF, pas l'opérateur,
  et le relayer renverrait l'écran à la connexion. Il devient un 500 journalisé. 429 et 5xx amont
  deviennent un 503 à réessayer, journalisé en `Warn` avec l'opération.
- **Le champ en cause se lit dans un texte.** Le contrat BFF est en OpenAPI 3.1, et `openapi3filter`
  valide alors par JSON Schema 2020, qui ne rend l'emplacement et la règle qu'en texte. Le présenter
  en 3.0 au validateur est impossible : le contrat emploie `type: "null"` dans un `oneOf`. Les formes
  lues sont figées par `internal/bff/validation_test.go` ; un bump de kin-openapi qui les change fait
  rougir.
- **Une passerelle injoignable ou qui expire rend 503** (`bff_upstream_unreachable`), comme la copie
  de `PasserelleIndisponible` le promet : la première rédaction la laissait en 500 « erreur
  imprévue ». *Relevé en revue le 28/09/2026.*
- **La validation passe avant la garde.** Une requête mal formée est refusée en 400 avant qu'on
  sache si l'opérateur pouvait l'envoyer, et sans ligne `permission.denied` — comme l'était déjà un
  corps JSON illisible, que le handler engendré décode avant la garde. Le contrat est public pour la
  SPA : ce 400 n'apprend rien à personne.
- **Le logger vit dans `API`**, embarqué dans `Dependencies`, puisque les handlers journalisent aussi.
- **Le lanceur Prism est partagé** (`internal/bddtest/prism.go`) : les scénarios du binaire montent
  le même mock que ceux d'`internal/gateway`.

## Tableau des mutations

Jouées le 28/09/2026, après un commit, fichier restauré par `cp`, `go test -count=1`. Deux premières
rédactions ne compilaient pas ; elles ont été réécrites jusqu'à nommer un test qui tombe.

| Mutation (le défaut réel qu'elle rejoue) | Ce qui tombe |
|---|---|
| Intention écrite **après** l'appel relayé | `TestARelayedActionIsAuditedBeforeTheCall`, `TestARelayedActionIsNotCalledWhenItCannotBeAudited` |
| Appel relayé malgré un audit en panne | `TestARelayedActionIsNotCalledWhenItCannotBeAudited` |
| Place du jeton prise sans `select` sur le contexte | `TestACallerWaitingForTheTokenCanGiveUp` |
| `Proxy` retiré du transport | `TestTheTransportHonorsTheEnvironmentProxy` |
| `MaxConnsPerHost` retiré | `TestConcurrentCallsNeverOpenMoreConnectionsThanTheBound` (80 connexions pour 64) |
| Middleware de validation démonté | les cinq tests de `validation_test.go` |
| `errors[]` écarté par `relayError` | `TestAnUpstreamValidationErrorKeepsItsFields` |
| Journal d'un 500 retiré | `TestAFailingOperationLeavesATraceInTheServerLog` |
| Journal du `password_hash` illisible retiré | `TestAMalformedPasswordHashIsLoggedWithoutTheHash` |
| Journal du code de secours illisible retiré | `TestAnUnreadableHashDoesNotStopTheOthersFromMatching` |
| Garde sur `customers:read` au lieu de `groups:read` | scénario « sans groups:read, la liste est refusée… » |
| Journal du 503 relayé retiré | scénario « une passerelle en panne… laisse une trace au journal du serveur » |

## Critère 4 — ce qu'aucun test ne garde
- **La valeur 64 de `MaxConnsPerHost`.** Le test vérifie que la borne tient, pas qu'elle est juste ;
  la justification est la mesure ci-dessus.
- **`HTTPS_PROXY` et `NO_PROXY` eux-mêmes.** Le test exige `http.ProxyFromEnvironment` sur le
  transport ; la lecture de l'environnement est celle de `net/http`, qui la met en cache au premier
  appel, donc un test en processus ne la rejoue pas.
- **`auditRelayed` n'a pas encore d'appelant de production** : les mutations de step-060 seront les
  premières. Ses trois tests la gardent seule.

## Definition of Done
- [x] `make check` vert, `make e2e` vert (28/09/2026).
- [x] Invariant (a) : `APIError` se journalise rédigée, et le corps d'une réponse amont illisible
      n'atteint ni le navigateur ni le journal (scénario « une passerelle en panne ») ; (c) : garde
      `groups:read`, audit d'une action relayée fermé par défaut ; (d) inchangé ; (e) :
      `MaxConnsPerHost` borné et mesuré.
- [x] Critère 2 : `openapi-bff.yaml`, `oapi-codegen-bff.yaml`, doc de `newContractHandler`,
      `client.go`, `login.tsx`, `recovery.go`, `authenticator.go`, `contract.feature` et `cmd/zodgen`
      relus contre le livré.
- [x] Critère 4 écrit ci-dessus et là où il vit.

## Hors périmètre
- Création, modification, archivage et suppression de groupes, et l'écran : step-060.
- Nombre de clients membres : absent du contrat 6.9.0 (step-060).
- Filtre par groupe dans les autres écrans : avec chacun d'eux, à partir de step-061.
