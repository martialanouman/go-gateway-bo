# step-067 — Sender IDs : catégorie de trafic, limite de débit, filtre, signalements `category_mismatch`

> **Jalon :** M3 (plan §8 ; spec §6.19, amendement v2.2) · **Statut :** EN COURS
> **Dépend de :** step-062 (liste des sender IDs de la fiche client), **contrat 7.3.0** · **Bloque :** —

## But
Sur la fiche client, la liste des sender IDs affiche la **catégorie de trafic**, la **limite de
débit**, le statut et le **nombre de signalements `category_mismatch`** des dernières 24 h. Elle se
filtre par catégorie. Un opérateur `customers:write` change la catégorie, ce qui passe par une
confirmation qui nomme la conséquence. Le même opérateur pose ou retire la limite de débit. Chaque
écriture est auditée ; le changement de catégorie l'est avec l'ancienne et la nouvelle valeur. La
**dette 064** est payée : un nom qui a déjà servi ne se supprime plus.

## Décisions (arbitrées sur le contexte, 06/10/2026)
- **Contrat : 6.13.0 → 7.3.0**, relevé au début de la step (API GitHub Packages, 06/10/2026 à 09:20
  UTC). Il faut la 7.1.0 pour `rate_limit` et la 7.3.0 pour `recent_category_mismatches_24h`. La
  7.3.0 a été publiée à 09:07 UTC, et la quarantaine pnpm la retient. **L'utilisateur a décidé une
  exception épinglée** : `minimumReleaseAgeExclude` passe de `@6.13.0` à `@7.3.0`, et l'entrée se
  retire au prochain bump. Le diff de `openapi-admin.yaml` a été relu :
  - `SenderId` gagne `traffic_category`, `rate_limit` (nul quand le sender ID n'a pas de limite
    propre) et `recent_category_mismatches_24h` (nul quand le compteur est illisible : **inconnu,
    pas zéro**) ;
  - `PUT` et `DELETE` arrivent sur `/admin/customers/{id}/sender-ids/{senderId}/rate-limit` ;
  - `SenderIdUpdate` accepte `traffic_category`, et `list-sender-ids` un filtre `traffic_category` ;
  - **ruptures** : `sender_id_policy` est retiré de `SmppAccount`, ce qui touche le faux amont ;
    `set-account-sender-id-policy` est retirée ;
  - hors périmètre : `bind-failures` (step-069, qui n'attend plus le contrat) et un `402` sur une
    opération du grand livre.
- **La création ne choisit pas de catégorie.** Un sender ID naît `marketing`, le défaut de la
  passerelle. Passer en `otp` ou `transactional` est un acte explicite qui exige une confirmation
  (§6.19), et un formulaire de création qui le permettrait la contournerait.
- **Le changement de catégorie passe par le `PATCH` existant.** `SenderIdUpdate` devient
  `{ status?, trafficCategory? }`, avec `minProperties: 1`. La modale Material porte le titre
  « Classer ACME en OTP ? », et la conséquence dépend de la cible, d'après `priority_tier` (§6.19 : 1
  sert le transactionnel et l'OTP, 2 l'OTP seul). Vers `otp`, le trafic passera devant le marketing
  et les connecteurs réservés à l'OTP pourront le servir. Vers `transactional`, il passera devant le
  marketing, mais les connecteurs réservés à l'OTP ne le serviront pas. Vers `marketing`, il perdra sa
  priorité, et les connecteurs réservés ne le serviront plus. La modale dit aussi comment revenir en
  arrière. Le bouton est « Classer ».
- **L'audit garde l'ancienne valeur, lue côté serveur.** Pour un changement de catégorie, le BFF
  relit `list-sender-ids` avant le `PATCH` et écrit `Before.traffic_category`. Il ne se fie jamais à
  une valeur envoyée par le navigateur. Si le sender ID est absent de la liste, le BFF répond 404
  sans appel d'écriture. C'est le premier `Before` d'une action **relayée** : `internal/store/admin.go`
  en écrit déjà pour les actions locales. **La relecture et le `PATCH` ne sont pas atomiques** : si un
  autre opérateur reclasse le même nom entre les deux, l'ancienne valeur écrite est périmée. Accepté :
  le contrat n'offre ni version ni `If-Match`, et les deux écritures restent tracées dans l'ordre.
- **Limite de débit** : `PUT /customers/{customerId}/sender-ids/{senderId}/rate-limit` reçoit
  `{ maxPerSec, burstCapacity? }`, avec les bornes du contrat (1 à 2 147 483 647). `DELETE` sur la
  même route rend 204. Les deux routes sont gardées par `customers:write` et auditées sous
  `sender_id.rate_limit` (`After` vaut la limite, ou `removed`). **L'ancienne limite n'est pas écrite
  en `Before`** : la spec ne le demande que pour la catégorie, et la limite précédente se lit dans
  l'événement `sender_id.rate_limit` d'avant, quand elle a été posée depuis le tableau de bord. Une
  limite absente s'affiche « Aucune limite propre ». **Écart constaté entre la spec et la passerelle** :
  §1.1 dit que le compte ne porte aucun débit, mais `go-gateway` refuse à l'admission au-delà de la
  limite du compte aussi (`internal/ingest/ingest.go`, `ratelimit.EntityAccount`, ADR-0021 §3), que le
  contrat Admin n'expose pas. Le tableau de bord ne lit ni ne règle cette limite : l'écran ne la nomme
  donc pas, et l'écart est remonté à l'utilisateur plutôt que tranché ici.
  Le retrait a sa propre modale (« Retirer la limite de ACME ? », bouton « Retirer »), ouverte depuis
  la ligne : une modale ne porte que le verbe de son titre. Poser ou retirer annonce son succès. La modale dit ce que l'écran doit
  dire (§6.19) : au-delà de la limite, le message est refusé à l'admission (429 en REST,
  `ESME_RTHROTTLED` en SMPP) et **aucun CDR n'est écrit**, si bien que le CDR Explorer ne le
  montrera pas.
- **Le filtre par catégorie est côté client.** La liste n'est pas paginée et elle est déjà chargée
  en entier : relayer `traffic_category` ajouterait un paramètre, une clé de cache et un aller-retour
  sans rien montrer de plus.
- **Le compteur de signalements n'a pas de lien.** La file de revue (§6.6) n'existe pas encore : elle
  arrive avec step-146. Un compteur illisible (`null` du contrat) s'affiche « Inconnu », en clair :
  lisible au clavier comme au lecteur d'écran, sans infobulle, et jamais confondu avec 0. La dette **066** porte le lien manquant, avec step-146 pour porteur.
- **Dette 064 payée.** Le DTO porte `firstUsedAt`. Quand ce champ est posé, « Supprimer » est
  désactivé et l'infobulle dit « Ce nom a déjà servi à envoyer : désactivez-le plutôt. ». Le BFF
  traduit le 409 de `delete-sender-id` dans la même copie (réponse `SenderIdDejaUtilise`), parce que
  la liste peut dater d'avant le premier envoi.
- **Faux amont** (`internal/fakegateway`) : il sert les nouveaux champs, `PATCH` sur la catégorie,
  les deux routes de limite et le 409 de suppression d'un nom déjà utilisé. `SenderIDPolicy` est
  retiré. Le parcours e2e de la fiche client classe un nom en OTP et lui pose une limite.

## Fichiers
- `web/pnpm-workspace.yaml`, `web/package.json`, `web/pnpm-lock.yaml` : bump et exception.
- `tasks/plan.md`, `tasks/todo.md` : version du contrat ; ⚠️ retirés des lignes 067 et 069.
- `api/openapi-bff.yaml` : `SenderId` (`trafficCategory`, `rateLimit`, `recentCategoryMismatches24h`,
  `firstUsedAt`), `TrafficCategory`, `SenderIdUpdate`, `SenderIdRateLimit`, la route
  `/rate-limit`, et la réponse `SenderIdDejaUtilise` (409 sur `DELETE`).
- `cmd/dashboard/customers.feature` et ses steps : les scénarios rouges.
- `internal/bff/sender_ids.go`, `guard.go`, `audit.go` : handlers, gardes et audit.
- `internal/fakegateway/customers.go` : le faux amont.
- `web/src/components/customer-sender-ids.tsx` : la liste sort de la route
  `_shell.customers_.$customerId.tsx`, déjà longue de 821 lignes, comme les identifiants à
  step-066. Ses tests Vitest vivent à côté.
- `web/e2e/shell.spec.ts` : le parcours étendu.
- `debts/064-…` supprimé ; `debts/066-…` créé.

## Ordre d'implémentation (un commit vert chacun)
1. Fiche, todo, plan ; bump 7.3.0 avec l'exception ; `make generate`. Le faux amont perd
   `sender_id_policy` et `make check` reste vert.
2. `api/openapi-bff.yaml` et `make generate`. Scénarios godog **rouges** :
   - la liste rend la catégorie, la limite et le compteur, et reste conforme au contrat du BFF ;
   - un changement de catégorie atteint l'amont et l'audit porte l'ancienne et la nouvelle valeur ;
   - sans `customers:write`, la catégorie et la limite répondent 403 sans appel amont ;
   - une limite hors bornes et un `PATCH` vide sont refusés avant la passerelle ;
   - le 409 de suppression se rédige « désactivez-le plutôt ».
3. Handlers, garde et audit : les scénarios passent au vert.
4. Client : la liste extraite, la catégorie, la limite, le compteur, le filtre et le « Supprimer »
   désactivé. Tests Vitest écrits rouges d'abord.
5. Faux amont, parcours e2e étendu, dettes 064 et 066.
6. Mutations, DoD, `git mv` de la fiche et case cochée.

## Tests (les risques, et la preuve de chacun)
- **L'ancienne catégorie viendrait du navigateur** → scénario : le corps n'envoie que la nouvelle
  valeur, et l'audit porte l'ancienne lue en amont. Mutation : retirer la relecture fait rougir.
- **Garde absente sur les deux routes de limite** → plan du scénario 403 sans appel amont. Mutation :
  retirer l'entrée de `guard.go` fait rougir, puisque la garde est fermée par défaut.
- **Audit absent** → le plan « <geste> laisse sa trace » gagne la pose et le retrait de limite ; la
  trace de la catégorie est vérifiée par le scénario de reclassement, qui lit `Before` et `After`.
- **Mapping du DTO perdu** (`firstUsedAt`, compteur, limite) → un scénario de liste dont l'amont pose
  ces champs, et dont l'`Alors` lit les valeurs rendues. Mutation : retirer `FirstUsedAt` ou le
  compteur du mapping fait rougir.
- **Une catégorie changée sans confirmation** → Vitest : le `PATCH` ne part qu'après « Classer ».
  Mutation : appeler la mutation au choix dans le menu.
- **Un compteur illisible affiché 0** → Vitest : `null` donne « Inconnu » et non « 0 ».
- **Focus perdu** quand un nom reclassé sort du filtre → Vitest : le focus revient au titre.
- **« Supprimer » proposé sur un nom déjà utilisé** → Vitest : bouton désactivé et expliqué. Le 409
  serveur est couvert par un scénario.
- **Le filtre** → Vitest : seuls les noms de la catégorie choisie restent.

## Hors périmètre
- Le lien vers la file de revue (step-146, dette 066).
- Les échecs de bind (step-069) et le `402` du grand livre.
- Le choix de catégorie à la création.
- La ventilation du trafic par catégorie (step-082).
