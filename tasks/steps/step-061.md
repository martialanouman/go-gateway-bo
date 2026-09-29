# step-061 — Clients : liste, filtres, création

> **Jalon :** M3 (plan §3, §8 ; spec §1.1, §6.15) · **Statut :** À FAIRE
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

## Critère 4 — ce qu'aucun test ne garde
À écrire à la clôture, là où il vit.

## Definition of Done
- [ ] `make check` vert, `make e2e` vert.
- [ ] Invariants (a…e) ; (c) : garde et audit sur la création.
- [ ] Copie conforme, relue contre `go-gateway` (critère 2) ; WCAG 2.1 AA sur l'écran.
- [ ] Critère 4 écrit.
- [ ] Tranche verticale contre la **vraie** passerelle (plan §3, §8) : tentée à la clôture (`make up`
      de `go-gateway` : Postgres, Redis, Kafka, ClickHouse ; jetons statiques hors production). Si elle
      échoue, le critère 4 dit sur quoi, mesuré.

## Hors périmètre
- Fiche client, suspension, sender IDs : step-062. Affectation à un groupe depuis la fiche : step-062.
- Facturation et contenu à la création : M8.
- Recherche par nom : absente du contrat (`list-customers` n'a pas de `q`).
