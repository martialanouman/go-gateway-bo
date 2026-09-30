# step-061 — Clients : liste, filtres, création

> **Jalon :** M3 (plan §3, §8 ; spec §1.1, §6.15) · **Statut :** FAIT
> **Dépend de :** step-060 · **Bloque :** step-062

## But
Un opérateur `customers:read` voit l'écran Clients, filtré par statut et par groupe, page après page.
Un opérateur `customers:write` y crée un client, et l'action laisse sa trace. **La tranche verticale
du plan (§3) est acquise ici** : connexion, second facteur, écran rendu selon les permissions, création
relayée, ligne d'audit.

## Décisions (arbitrées sur le contexte, 29/09/2026)
- **Contrat Admin : reste en 6.9.0.** 6.10.0 (`member_count` requis sur `CustomerGroup`, `go-gateway`
  #237, seul écart relu) est publiée le 29/09/2026 à 22:35 UTC ; la quarantaine pnpm
  (`minimumReleaseAge: 1440`, stricte, `web/pnpm-workspace.yaml`) la refuse jusqu'au 30/09 à 22:35
  UTC, et l'exemption n'est admise que pour un correctif de sécurité. 6.9.0 porte `list-customers` et
  `create-customer`. **La dette 062 passe à step-062**, qui relève le contrat en ouvrant.
- **Création au plus étroit : nom et groupe.** `CustomerCreate` n'exige que `name` ; la facturation
  (`billing_*`, `overdraft_*`, `credit_*`, `balance_scope`, `mo_billing_floor`) est M8, le contenu
  (`content_*`) est step-164. Le client naît avec les défauts de la passerelle, et la modale le dit.
- **Le filtre par groupe naît ici** (arbitrage de step-060) : `groupId` relayé tel quel à
  `list-customers`, qui le porte déjà. Le sélecteur liste les groupes actifs ; il n'apparaît qu'avec
  `groups:read`, puisque sa liste en dépend.
- **Filtres dans l'URL** (`/customers?status=…&groupId=…`) : c'est l'adresse que step-060 promettait
  pour « les membres d'un groupe », et un lien depuis l'écran Groupes y mène.
- **Pagination par curseur, « Afficher les suivants »** (plan §1.5 : aucune « page 4 sur 120 »). 50 par
  page, la valeur par défaut du contrat.
- **Statut en `StatusPill kind="entity"`** : `active`, `suspended`, `closed` sont exactement
  `EntityStatus`, déjà tenu égal au contrat.
- **DTO de sortie `Customer` au plus étroit** : `id`, `name`, `status`, `groupId`, `createdAt`,
  `updatedAt`. Les champs de facturation et de contenu entrent avec les steps qui les affichent : un
  champ absent du DTO ne peut pas fuir.
- **Audit** : `customer.create` par `auditRelayed`. **Permissions existantes** : `customers:read`,
  `customers:write`.

## Périmètre (ce que fait CETTE PR)
- **Contrat BFF** : `GET /customers` (`status`, `groupId`, `cursor`), `POST /customers`. DTO déclarés ;
  422 relayé à `errors[]`, 503.
- **Serveur** : deux handlers gardés, création auditée.
- **Client** : écran `/customers` (liste, filtres statut et groupe, « Afficher les suivants »,
  création), cinq états (§1.9) ; lien vers les clients du groupe depuis `/groups`.
- **Dette 062** : porteur step-062, avec la date de fin de quarantaine.

## Tests (écrits dans la même PR)
- **godog (`cmd/dashboard`, contre Prism)** : un opérateur `customers:read` voit une page ; la
  création laisse deux lignes `customer.create` dont l'issue désigne le client créé ; sans
  `customers:write`, la création est refusée en 403 sans appel amont ; `groupId` atteint l'amont.
- **Parcours e2e (critère 1)**, en étendant le parcours existant : l'opérateur crée un groupe, crée un
  client dans ce groupe, suit le lien « clients du groupe » et l'y retrouve.
- **Client (Vitest)** : les filtres vivent dans l'URL et survivent à un rechargement ; « Afficher les
  suivants » ajoute la page suivante ; bouton de création désactivé et expliqué sans `customers:write`.
- **Mutations** (tableau à la clôture).

## Écarts à la rédaction, arbitrés pendant l'implémentation
- **Scénarios dans `cmd/dashboard/customers.feature`**, comme ceux de step-059 et 060 : ils exigent le
  binaire et le mock.
- **`relayedRefusal` devient le relais générique** (`relay.go`) ; la rédaction française du 404 et du
  409 reste aux groupes (`groupRefusal`). Sans quoi le 404 d'un client, en step-062, aurait parlé
  de groupe.
- **Un statut inconnu dans l'URL atteignait la requête** : `validateSearch` qui omet une clé laisse
  passer la valeur brute (TanStack Router 1.170.18). Il rend désormais ses deux clés.
- **La feuille de `/_design` fusionnait dans la feuille d'entrée** dès qu'un écran de la coquille
  utilise `Select` (+2 209 octets, `cold-load.test.ts` rouge à 34 973). Elle est lue par `?url`
  depuis le composant ; la garde `STYLED_FILES` reconnaît `?url`.
- **La liste d'un `Select` ouverte dans une modale passait dessous** (`--z-popover` 40 < `--z-modal`
  60) : trouvé par le parcours, invisible à jsdom. Le positionneur du `Select` passe au-dessus des
  modales. **Le plafond brut de la feuille d'entrée passe de 32 768 à 36 864 octets**, décision de
  l'utilisateur : `main` était à trois octets de la borne. La borne compressée ne bouge pas.
- **Le faux amont des parcours sert la liste et la création des clients** en mémoire.

## Tableau des mutations

Jouées le 29-30/09/2026, après un commit, fichier restauré par `cp`, `-count=1`.

| Mutation (le défaut réel qu'elle rejoue) | Ce qui tombe |
|---|---|
| `CreateCustomer` gardée par `customers:read` | « sans customers:write, la création est refusée… » |
| `groupId` non relayé à la passerelle | « le filtre par groupe atteint la passerelle » |
| Identifiant du client créé non posé sur l'issue | « créer un client laisse sa trace… » |
| Statut de l'URL non validé | `ignores a status the contract does not know` |
| Curseur non transmis à la page suivante | `adds the next page on demand, with the cursor the previous one gave` |
| `setError` débranché, refus en bandeau | `places a refusal on the name under its field, not in a banner` |
| Feuille de `/_design` retirée du composant | `serves every stylesheet STYLED_FILES claims to guard` |
| Liste du `Select` sous la modale (état d'avant le correctif) | le parcours e2e, sur le choix du groupe du nouveau client |

## Critère 4 — ce qu'aucun test ne garde
- **La tranche verticale contre la vraie passerelle n'a pas été jouée.** Mesuré le 30/09/2026 : les
  Compose des deux dépôts publient les mêmes ports (Postgres 5432, Redis 6379), et `admin-api-svc`
  charge les sections Kafka et ClickHouse au démarrage (`go-gateway`, `cmd/admin-api-svc/main.go:46`).
  Le chemin le moins cher, pour qui la jouera : le BFF en mode `mock` n'envoie qu'un `Bearer` factice
  (`internal/gateway/client.go`, `mockAccessToken`), que `ADMIN_TOKENS` de la passerelle accepte sous
  la forme `jeton:admin:read|admin:write` ; aucun mTLS à monter.
- **L'empilement du `Select` au-dessus d'une modale** n'est gardé que par le parcours e2e.
- **Le nom du groupe dans la liste des clients** vient de la liste des groupes **actifs** : un client
  d'un groupe archivé montre l'identifiant brut, en mono.

## Definition of Done
- [x] `make e2e` vert (30/09/2026). `make check` : **non concluant en local**, machine à 220 de charge
      (suites de `go-gateway` lancées ailleurs) — sept attentes d'une seconde dépassées dans des
      écrans étrangers au diff, puis `TestASessionReadStaysWithinItsBudget` (dette 012), vert trois
      fois sur trois isolé. La CI fait foi.
- [x] Invariants : (c) `customers:read` / `customers:write` et `auditRelayed` sur la création,
      mutations à l'appui ; (d) le navigateur ne parle qu'au BFF ; (e) un appel par page, borné à 50.
- [x] Critère 2 : la copie de la modale (« naît actif, sans compte ni sender ID ; facturation et
      contenu par défaut ») relue contre `CustomerCreate` du contrat 6.9.0 et `go-gateway` (`status` non inséré, défaut
      `'active'`, `db/schema_passerelle_sms.sql:128`).
- [x] Critère 4 écrit ci-dessus.
- [ ] Tranche verticale contre la **vraie** passerelle : non jouée, voir critère 4.

## Hors périmètre
- Fiche client, suspension, sender IDs : step-062. Affectation à un groupe depuis la fiche : step-062.
- Facturation et contenu à la création : M8.
- Recherche par nom : absente du contrat (`list-customers` n'a pas de `q`).
