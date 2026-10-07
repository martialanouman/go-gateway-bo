# step-070 — Le BFF émet les jetons de l'API Admin (ADR-0019)

> **Jalon :** M3 (plan §8, critère « la tranche verticale passe contre la passerelle réelle ») ·
> **Statut :** À FAIRE
> **Dépend de :** step-059 (socle du relais), step-043 (hub), **contrat 7.3.0** · **Bloque :** step-071

## But
Le BFF s'authentifie auprès de la vraie passerelle. Depuis l'ADR-0019 de `go-gateway` (26/09/2026),
la passerelle vérifie des JWT ES256 contre un JWKS et ne détient aucun secret : c'est le BFF qui
signe, au nom de l'opérateur connecté. Le BFF fait aujourd'hui un `client_credentials` vers un
`tokenUrl` que personne ne sert (contrat 7.3.0, l. 1922) : en mode `real`, aucun appel ne passe, et
la tranche verticale n'a jamais été jouée contre la passerelle (step-061 l. 87).

Le jeton prouve **qui** appelle et avec quels droits ; le mTLS existant prouve **quelle machine**.

## Décisions (arbitrées le 06–07/10/2026 avec l'utilisateur)
- **Contrat : on reste en 7.3.0.** Relevé le 07/10/2026 : 7.6.0 publiée (`go-gateway` `493baa0`).
  Le diff de `openapi-admin.yaml` de 7.3.0 à 7.6.0 ne touche ni `securitySchemes`, ni
  `OperatorBearer`, ni aucun scope (connecteurs et CDR seulement, M4–M5). Écart consigné dans la PR.
- **Bibliothèque : `github.com/go-jose/go-jose/v4`**, celle sur laquelle `go-oidc` vérifie ces
  jetons côté passerelle. Version et CVE relevées sur `proxy.golang.org` / `pkg.go.dev` à l'ajout.
  Aucune signature écrite à la main.
- **Clés.** Un dossier de PEM PKCS#8 EC P-256 monté depuis un Secret (`DASHBOARD_TOKEN_KEYS_DIR`) :
  tout le dossier est publié, `DASHBOARD_TOKEN_ACTIVE_KID` désigne la clé qui signe. Le `kid` est
  l'empreinte RFC 7638 de la clé publique. Une clé n'apparaît dans aucun log ni message d'erreur ;
  un refus nomme le fichier, jamais son contenu.
- **JWKS** sur `GET /.well-known/jwks.json`, hors du contrat `/api`, sans session ni garde : donnée
  publique, servie par l'ingress interne seulement. DTO déclaré : `kty`, `crv`, `x`, `y`, `kid`,
  `alg: "ES256"`, `use: "sig"`, rien d'autre.
- **Jeton.** `iss` = `DASHBOARD_TOKEN_ISSUER` **tel quel** (aucun `TrimSpace`, aucun slash touché),
  `aud: "gateway-admin"`, `sub` = `dashboard.operators.id` (jamais vide), `scope` = **une chaîne**
  séparée par des espaces (RFC 9068), `iat`, `exp` à 5 min, `kid` en en-tête.
- **Cache** en mémoire par instance, clé `(sub, scopes triés)`, jeton réutilisé tant qu'il reste
  plus de 60 s avant `exp`. Les permissions sont relues à chaque requête (`sessions.Grants`) :
  un changement de rôle change la clé, donc le jeton, sur toutes les instances sans Pub/Sub ; une
  désactivation ferme déjà les sessions.
- **Traduction permissions → scopes** : chaque clé du catalogue déclare sa classe —
  `GatewayRead` (→ `admin:read`), `GatewayWrite` (→ `admin:write`), `GatewaySame(scope)` ou `Local`.
  `content:read`, `content:erase`, `gdpr:erase`, `cdr:export_bulk`, `audit:read` → même nom ;
  **`cdr:read_pii` → `msisdn:reveal`** : la clé du démasquage existe déjà (spec §6.4), on n'en crée
  pas une seconde. `operators:manage`, `roles:manage` et toute clé propre au BFF sont `Local` et
  n'ouvrent rien à la passerelle. On n'émet que ce que l'opérateur détient.
- **Identité système** pour les trois flux du hub : une **constante** `gateway.SystemSubject`
  (UUID fixe), sans ligne en base — `first_operator.go:94` n'amorce le premier administrateur que
  sur une table `operators` vide, et une ligne réservée l'aurait bloqué. `scope: "admin:read"` seul.
  L'ADR-0019 (« pas de compte de service ») visait les scripts ; l'amender d'une ligne côté
  passerelle fait partie de la PR.
- **Transport.** Un `RoundTripper` lit l'appelant dans le contexte (`gateway.WithOperator`, posé par
  la garde ; `gateway.WithSystem`, posé par le hub) et pose `Authorization: Bearer`. **Sans appelant,
  ou sans aucun scope, l'appel est refusé avant le réseau.** Le cookie de session n'est jamais
  transmis. Le mode `mock` envoie aussi le jeton signé, Prism acceptant tout `Bearer` ;
  `mockAccessToken` disparaît ; l'émetteur reste actif, sur une clé éphémère engendrée en
  mémoire quand les trois variables sont absentes.
- **Disparaissent** : `TokenURL`, `ClientID`, `ClientSecret`, `machineCredentials`, `token.go`, leurs
  variables d'environnement et leur exigence dans `requireRealGatewayMaterial`.
- **Réponses de la passerelle**, traduites dans `relayError`, jamais par handler ; aucune ne touche
  la session :
  - 401 `unauthenticated` → ERROR (`kid`, `iss`, `sub`, heure), événement de log stable
    `gateway_token_rejected` (le BFF n'a aucun registre de métriques), pas de rejeu ;
    l'opérateur reçoit 502 `bff_gateway_rejected_token` : « La passerelle a refusé l'identité
    du tableau de bord : l'action n'a pas eu lieu. L'exploitation est prévenue ; votre session
    reste ouverte. »
  - 403 `forbidden_scope` → relayé, refus expliqué ; WARN (la garde aurait dû refuser avant).
  - 503 `service_unavailable` → lectures rejouées une fois (`replayReadsOnce`), jamais les
    écritures ; WARN « vérifier le JWKS » ; l'opérateur voit l'état d'erreur avec « Réessayer ».
  - 401 sur un flux du hub → sujet `stale`, backoff existant, événement de log `gateway_token_rejected` ;
    les sockets clients restent.
- **Rotation** en trois déploiements roulants, chacun terminé partout avant le suivant : publier,
  signer, retirer **5 min** après. Retirer une clé invalide les jetons personnels qu'elle a signés
  (step-071) : décidé, et dit par le runbook et par l'écran de délivrance.
- **Runbook** : `docs/runbook.md` naît avec deux sections — rotation de la clé, et valeurs pour le
  ConfigMap `gateway-oidc` (`OIDC_ISSUER`, `OIDC_AUDIENCE=gateway-admin`,
  `OIDC_JWKS_URL=<issuer>/.well-known/jwks.json`, `OIDC_JWKS_CA_FILE`). M9 le complétera.
- **Démarrage** : INFO avec l'émetteur, les `kid` publiés et le `kid` actif — publics, suffisants
  pour vérifier la configuration sans ouvrir le Secret.

## Fichiers
- `go.mod` : `go-jose/v4` ; `golang.org/x/oauth2` retiré s'il ne sert plus.
- `internal/token/` (neuf) : `keys.go`, `jwks.go`, `issuer.go` et leurs tests.
- `internal/permissions/catalog.go` (classe par clé), `scopes.go` (neuf) et tests.
- `internal/gateway/` : `client.go` (transport par appelant), `caller.go` (neuf), `errors.go` ;
  `token.go` supprimé.
- `internal/config/config.go` : les trois variables, les refus.
- `internal/bff/guard.go` (pose l'appelant), `relayError` (401/403/503).
- `internal/hub/upstream.go` : `WithSystem`.
- `cmd/dashboard/main.go` : JWKS monté ; `gateway-token.feature` et ses steps.
- `internal/fakegateway` / faux amont des scénarios : vérification réelle des jetons (`go-oidc`).
- `docs/runbook.md` (neuf) ; `tasks/todo.md` l. 255 si la tranche réelle n'est pas jouée.
- `debts/017-…` supprimée (les deux scopes s'émettent dès que l'opérateur détient la clé).

## Ordre d'implémentation (un commit vert chacun)
1. Fiche, `todo.md`.
2. `go-jose/v4` relevé et ajouté. `internal/token` : clés, JWKS, émetteur, cache — tests rouges
   d'abord (claims exacts, signature vérifiée par le JWKS servi, rotation, cache).
3. Classe par clé et `GatewayScopes` — table des 9 rôles écrite à la main, complétude, rouges
   d'abord.
4. Configuration : trois variables, refus, clé éphémère en `mock` ; retrait de `client_credentials`.
5. Scénarios godog **rouges** (`gateway-token.feature`) contre un faux amont qui vérifie vraiment
   les jetons ; puis transport par appelant, garde, identité système, hub : vert.
6. `relayError` : 401/403/503 et leurs scénarios.
7. JWKS monté, runbook, logs de démarrage.
8. Tranche verticale tentée une fois contre la vraie passerelle ; résultat consigné ici.
9. Mutations, DoD, `git mv` de la fiche, case cochée.

## Tests (les risques, et la preuve de chacun)
- **Claims faux** (`scope` en tableau, `aud`, `iss` retouché, `exp`, `kid`, `sub` vide) → unitaire
  qui décode le jeton et compare octet pour octet. Mutations : `scope` en tableau ; `TrimSpace` sur
  `iss`.
- **Signature invérifiable par la passerelle** → le test vérifie avec la clé **tirée du JWKS
  servi**, et le faux amont des scénarios vérifie avec `go-oidc`, comme la passerelle.
- **Clé privée publiée** → le JWKS ne contient jamais `d` ; mutation : sérialiser la clé privée.
- **Rotation** → deux clés publiées pendant la fenêtre ; un jeton de l'ancienne clé vérifiable tant
  qu'elle est publiée, refusé après.
- **Cache** → même jeton à 239 s, neuf à 241 s, différent pour d'autres scopes (horloge injectée).
  Mutation : réutiliser au-delà de `exp - 60`.
- **Traduction** → les 9 rôles de §6.10, table écrite à la main ; toute clé a une classe, et un
  second test exige la complétude. Mutation : une clé `Local` traduite en `admin:write`.
- **Appel parti sans identité** → test du
  transport `TestACallWithoutACallerNeverLeaves`. Mutation : retirer le refus avant le réseau.
- **Rôle changé, jeton périmé** → scénario : le `scope` du jeton suivant suit le nouveau rôle.
- **Session tuée par la passerelle** → scénarios 401 et 503 : `/auth/me` répond toujours 200.
  Mutation : traiter le 401 comme une session morte.
- **Flux du hub au mauvais nom** → scénario : `sub` de l'identité système, `admin:read` seul.
- **Cookie transmis** → le faux amont enregistre les en-têtes ; ni `Cookie` ni la valeur de session.
- **Secret dans les logs** → sortie du process capturée au démarrage et sur un appel : ni PEM, ni
  scalaire `d`, ni jeton (`outputHides`, `hardening_test.go`).
- **Configuration** → chaque refus nomme la variable et le fichier, aucun ne contient de PEM.

**Non testable ici, écrit tel quel (critère 4)** : la tranche verticale contre la vraie passerelle
dépend d'une infrastructure locale (Kafka, ClickHouse, ports des deux Compose en collision —
step-061). Elle est tentée une fois à la main ; si l'infrastructure bloque, une dette est inscrite
avec sa condition de levée, et `todo.md` cesse de dire « la tranche verticale est acquise ».

## Hors périmètre
- Le jeton personnel pour scripts et collection : step-071.
- Les jobs planifiés au nom de leur créateur (ADR-0019) : M5, step-104.
- Le stockage des clés en KMS.
- Le rendu de `created_by` en nom d'opérateur : la step qui l'affichera.
