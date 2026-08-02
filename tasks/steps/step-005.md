# step-005 — PostgreSQL : `pgx`, migrations, le schéma propre au BFF

> **Jalon :** M0 (§3.1) · **Statut :** À FAIRE
> **Dépend de :** step-000 · **Bloque :** step-006, M1 entier

## But
Le petit schéma dont le BFF est propriétaire — opérateurs, rôles, sessions, audit, alertes,
notifications, vues sauvegardées — avec ses migrations et une base jetable pour les tests. Le tableau
de bord ne lit **jamais** la base de la passerelle (§1.3).

## Périmètre (ce que fait CETTE PR)
- `internal/store/` : pool `pgx`, cycle de vie attaché au `context` racine, arrêt propre.
- Migrations versionnées et commitées, rejouables, avec le choix d'outil **tranché et justifié**
  (`plan.md` §19 laisse la question ouverte : `golang-migrate`, `goose`, ou SQL maison).
- Les **neuf tables du §3.1** : `operators`, `permissions`, `roles`, `role_permissions`,
  `operator_roles`, `audit_log` **partitionné par mois**, `alert_rules`, `notifications`,
  `saved_views`.

  > **Amendement du 02/08/2026, avant la première ligne de code.** Ce périmètre listait aussi
  > `sessions` et « la table d'anti-brute-force ». **Aucune des deux n'existe au §3.1** — la spec y
  > déclare exactement neuf tables. Elle dit par ailleurs que la session est un « cookie/JWT
  > **signé** », donc potentiellement sans état, et ne parle d'anti-brute-force que comme d'un
  > comportement (« protection anti-brute-force, verrouillage temporaire »), sans table ni colonne ;
  > le plan attribue d'ailleurs l'anti-brute-force **partagé entre instances** à step-021.
  >
  > Les inventer ici coûterait plus que d'attendre : « l'ordre des migrations est un contrat, elles ne
  > se réécrivent jamais » — un schéma deviné aujourd'hui devient une migration corrective
  > permanente. Elles reviennent à la step qui saura ce qu'elles doivent contenir. Le README suit.
- `docker-compose.yml` : PostgreSQL 18 + Redis.
- Base jetable pour les tests (testcontainers), et les migrations rejouées à chaque suite.

## Points d'implémentation clés
- **Partitionner `audit_log` n'a de sens que si quelque chose détache les partitions.** La v1.0 avait
  livré la création sans la rétention, et il a fallu une step ajoutée après coup pour la fermer. Ici,
  la création note explicitement que `step-187` en est le propriétaire — une dette écrite vaut mieux
  qu'une dette découverte.
- Le pool est configuré, pas laissé par défaut : nombre de connexions, durée de vie, délai
  d'acquisition. Deux instances partagent la même base (§4.1).
- Aucune requête n'est écrite ici. Les tables existent, elles ne servent encore personne.
- L'ordre des migrations est un contrat : elles ne se réécrivent jamais, elles s'ajoutent.

## Tests (écrits dans la même PR)
- **Scénario** `base.feature` : *Étant donné* une base vierge, *Quand* les migrations sont jouées,
  *Alors* le schéma attendu existe ; *Quand* elles sont rejouées, *Alors* rien ne change et rien
  n'échoue.
- Une partition d'`audit_log` est créée pour le mois courant et pour le suivant.
- Le pool se ferme sur annulation du `context` et aucune connexion ne reste ouverte.

## Definition of Done
- [ ] `make check` vert, base jetable comprise
- [ ] `docker compose up` + migrations suffit sur un poste neuf, et la procédure est dans le README
- [ ] le choix d'outil de migration est **écrit** avec sa raison, pas seulement fait
- [ ] la mutation « ne pas créer la partition du mois suivant » fait rougir la suite

## Hors périmètre
Le seed des permissions et des rôles → step-020. La rétention et le détachement des partitions →
step-187. Toute requête métier. Les tables `sessions` et d'anti-brute-force → la step qui les
spécifiera (voir l'amendement du périmètre). Le choix `sqlc` contre `pgx` nu → step-020, première à
écrire une requête. La **vérification de version du schéma au démarrage** → step-020 également, voir
DN-6.

## Tableau des mutations

Tenu au fil de l'eau. Une ligne « aucune porte ne rougit » est un constat de la DoD (critère 4), pas
un aveu — à condition d'avoir été **vérifiée** et d'être écrite au-dessus de la ligne concernée.

### La configuration

| Mutation appliquée (le défaut réel qu'elle rejoue) | Ce qui tombe |
|---|---|
| Le DSN rendu facultatif | `exige_le_DSN_de_la_base` |
| La validation de forme retirée | trois cas de DSN malformé, le test de non-fuite, **et** le scénario du binaire |
| La ligne retirée de `.env.example` | la porte `dotenv` |
| Le message reformé en `"DSN attendu : %s", err` | `ne_recopie_jamais_le_mot_de_passe`, qui rend la fuite verbatim |
| L'en-tête de `docker-compose.yml` *(constat manuel)* | **aucune porte ne rougit** — vérifié : aucun `.go`, aucun workflow, aucune recette ne lit ce fichier. Sa vérité est confrontée à sa source : `make migrate` existe |
| La variable ajoutée à l'étape CI *(constat manuel)* | **aucune porte ne rougit** — ce job ne se rejoue pas en local, il lie un port |

### Les migrations, contre un PostgreSQL 18 réel

| Mutation appliquée | Ce qui tombe |
|---|---|
| Les migrations rejouées | rien — `schéma déjà à jour, version 3`, aucune table modifiée |
| `ensure_audit_log_partitions()` amputée du mois suivant | `no partition of relation "audit_log" found for row` — et l'inventaire ne rend qu'une partition |
| `PRIMARY KEY (id)` seul sur `audit_log` | PostgreSQL refuse : « unique constraint on partitioned table must include all partitioning columns » |
| Une clé étrangère vers `audit_log (id)` | « there is no unique constraint matching given keys » — la conséquence écrite dans la migration |
| Le bloc PL/pgSQL sans `-- +goose StatementBegin/End` | « unterminated dollar-quoted string » — le piège du format |
| Les migrations `Down` jouées jusqu'à zéro | il ne reste que la table de version, la fonction a disparu |

### Le pool et la base jetable

| Mutation appliquée | Ce qui tombe |
|---|---|
| La partition du mois suivant retirée *(la mutation que la DoD nomme)* | `base.feature`, sur un **effet** : le journal refuse un événement daté du mois prochain |
| La fermeture sur annulation du contexte retirée | `TestThePoolClosesWithTheRootContext…` |
| `MinConns` porté à 5 | les deux tests de paresse |
| `MaxConns`, `MinConns`, `MinIdleConns` retirés un à un | « le pool a ouvert une 11ᵉ connexion », « le DSN a obtenu ses 5 connexions oisives » |
| Durée de vie, jitter, temps d'inactivité, délai de connexion — les quatre retirés | **aucune porte ne rougit** — leur effet n'apparaît qu'avec le temps ou sur une base injoignable ; écrit au-dessus des lignes |
| `WithSessionLocker` retiré | **aucune porte ne rougit** — trois migrations concurrentes sur base vierge donnent le même résultat, la transaction par migration suffisant à sérialiser localement |
| Image du conteneur pointée sur un tag inexistant | la suite **échoue** — aucun test exécuté, jamais un skip |
| `%w` remis sur l'erreur de `ParseConfig` dans les migrations | `TestMigrateNeverEchoesTheDatabasePassword` — le mot de passe verbatim dans le message |

Une mutation a d'abord **pendu au lieu de rougir** : le retrait de `MaxConns` faisait acquérir une
onzième connexion qui n'était pas rendue, et `Close` attend le retour des connexions. Corrigée, et la
raison écrite sur place.

## Design arrêté (2026-08-02)

Chaque décision cite la mesure qui la fonde. Les points que la spec ne tranchait pas ont été soumis
au modèle Fable.

> **Note d'ordonnancement.** L'index place step-009 (bump du contrat Admin en 4.0.0) avant celle-ci.
> Elle reste infaisable : mesuré à 12:27 UTC, la quarantaine de `minimumReleaseAge` court jusqu'à
> 17:46. step-005 ne dépend que de step-000 — les dépendances déclarées priment sur l'ordre de
> l'index — et ne touche pas au contrat Admin.

### DN-1 — `goose` plutôt que `golang-migrate`

Le plan laissait la question ouverte (§19) sur trois critères : partitionnement, rejouabilité,
absence de dépendance native. Trois faits mesurés tranchent :

- **L'épinglage.** Le dépôt épingle ses outils par la directive `tool` de `go.mod` — quatre déjà. Le
  binaire de `golang-migrate` n'enregistre **aucun pilote** sans `-tags postgres` (build tags
  positifs, documenté dans son propre README), et `tool` n'a aucun mécanisme pour transporter des
  tags : `go tool migrate` serait muet. `goose` active PostgreSQL par défaut (tag négatif
  `!no_postgres`), donc s'épingle tel quel.
- **Le poids et l'âge.** 80 dépendances déclarées contre **209** — le bloc direct de `migrate`
  contient Spanner, AWS SDK, Azure, ClickHouse, MongoDB, Snowflake, go-github, go-gitlab. Dernière
  release de `migrate` : **il y a huit mois**, 307 issues ouvertes, trois derniers commits de CI et
  de Dependabot. `goose` : release il y a onze jours, 91 issues. *(Nuance mesurée : l'élagage du
  graphe Go fait que n'importer que le pilote postgres ne met pas Spanner dans le binaire — le coût
  réel est sur `go.mod`, `go.sum` et la surface de `govulncheck`.)*
- **La version de `pgx`.** `goose` requiert déjà `pgx/v5 v5.10.0`, celle que le plan impose ;
  `migrate` est bloqué sur `v5.5.4` **et** traîne `pgx/v4`.

**Ce que ce choix coûte, et qu'il faut donc écrire** : `goose` **ne verrouille pas** par défaut — sa
documentation le dit mot pour mot, « If WithSessionLocker is not called, locking is disabled ». Avec
≥2 instances, c'est une ligne à ne pas oublier. `WithSessionLocker` sur `pg_try_advisory_lock` avec
retry borné est posé dès le premier câblage : l'échec explicite après quelques minutes vaut mieux que
l'attente indéfinie de `pg_advisory_lock`, que `migrate` impose sans réglage.

### DN-2 — Les `CREATE TABLE` de l'authentification vivent ici, le seed en step-020

L'index intitulait step-020 « Schéma auth » et revendiquait les mêmes tables. Le partage est tranché
dans ce sens parce que le test que cette fiche exige — « base vierge, migrations jouées, le schéma
attendu existe » — est **infalsifiable** si les tables d'authentification n'y sont pas. Et la
dépendance n'a de sens que dans ce sens : un seed a besoin de ses tables, l'inverse n'existe pas.
Corrigé dans l'index avant d'écrire.

### DN-3 — `audit_log` est partitionnée sur `created_at`, avec une clé primaire composite

Mesuré à la source (documentation PostgreSQL 18) : « the constraint's columns **must include all of
the partition key columns** ». Donc `PRIMARY KEY (id)` est **refusé** sur une table partitionnée par
`created_at` — ce sera `PRIMARY KEY (id, created_at)`.

L'alternative — partitionner par plages d'`id`, puisqu'un UUIDv7 est déjà ordonné dans le temps, ce
qui rendrait `PRIMARY KEY (id)` légal — est écartée sur l'usage : les requêtes d'audit filtrent par
période, et l'élagage de partitions exige que la clé de partition soit la colonne filtrée. Des bornes
de partition en littéraux UUID seraient de surcroît illisibles pour l'exploitant.

Deux conséquences à écrire **dans la migration** : l'unicité d'`id` n'est plus garantie globalement
mais par partition — négligeable pour un UUIDv7 — et **aucune clé étrangère ne doit pointer vers
`audit_log`**, puisqu'elle devrait porter les deux colonnes. Un journal d'audit est terminal ; c'est
une contrainte, pas une gêne.

### DN-4 — Les partitions sont créées par une fonction idempotente, pas par des `CREATE TABLE` en dur

Mesuré : PostgreSQL ne crée aucune partition tout seul, chaque mois est une commande. Deux
`CREATE TABLE` littéraux rendraient la suite vraie le mois de leur écriture et fausse le suivant —
la fiche exige pourtant que la mutation « ne pas créer la partition du mois suivant » **fasse rougir
la suite**, ce qui suppose qu'elle reste falsifiable à toute date.

Une fonction PL/pgSQL `ensure_audit_log_partitions()` — mois courant et suivant, dérivés de `now()`,
en `IF NOT EXISTS` — est appelée par la migration. Le scénario reste alors vrai quel que soit le jour
où il tourne, et la mutation reste falsifiable.

Piège du format retenu en DN-1 : `goose` découpe ses instructions sur les `;`, donc un bloc PL/pgSQL
**exige** `-- +goose StatementBegin` / `StatementEnd`. Sans eux, la fonction est coupée en morceaux.

### DN-5 — Le pool est paresseux, et le DSN est exigé au démarrage

Le périmètre veut un pool « attaché au `context` racine ». Mais **aucune route n'utilise la base** —
la fiche le dit elle-même. Ouvrir une connexion au démarrage casserait trois choses vertes pour
protéger une dépendance dont le binaire ne fait rien : le job de CI qui lance le déployable n'a pas
de PostgreSQL, cinq scénarios `godog` lancent ce même binaire, et `make dev` cesserait de fonctionner
sans `docker compose up`.

Donc : le DSN est **exigé et validé** au démarrage — mal formé, le binaire refuse de démarrer — mais
**aucune connexion n'est composée** tant que rien n'en demande. `MinConns` vaut 0 délibérément :
c'est le « configuré, pas laissé par défaut » de la fiche, et une valeur non nulle contredirait la
paresse en remplissant le pool en arrière-plan.

### DN-6 — La vérification de version du schéma part avec la première step qui lit la base

Corollaire de DN-5. Refuser de servir sur un schéma en retard est la **bonne politique** — démarrer
quand même produirait des échecs de forme inconnue à l'exécution. Mais l'introduire ici reviendrait à
poser une garde qui protège un schéma qu'aucune route ne lit : le profil exact de la garde trop large
qui finit désactivée. Elle est inscrite sur step-020 dans l'index.

### DN-7 — Ce qui prouve que le pool n'est pas du code mort

Deux preuves, à deux niveaux, et c'est ce qui décide que DN-5 ne livre pas un artefact inerte :

- **La suite `internal/store`, contre un PostgreSQL réel** (testcontainers) : les migrations jouées
  puis rejouées, les partitions vérifiées, et le cycle de vie exercé pour de bon — ouverture, un
  `Acquire` réel, annulation du contexte racine, puis « aucune connexion restante » **lue depuis une
  connexion de contrôle séparée**, jamais depuis le pool qu'on vient de fermer.
- ~~**Le câblage dans `cmd/dashboard`, falsifiable sans Docker**~~ — **cette seconde preuve est
  morte, mesurée pendant l'implémentation.** Elle supposait que la validation du DSN vive dans le
  store ; elle vit dans `internal/config`, comme toute la configuration du dépôt. Le scénario « un
  DSN mal formé empêche le démarrage » est donc **vert sans qu'aucun store soit câblé**, et retirer
  un câblage ne ferait rougir aucune porte.
  **Conséquence tranchée** : le pool **n'est pas câblé dans `cmd/dashboard`**. Un pool paresseux n'a
  aucun effet qu'un scénario sans Docker puisse observer, et le câbler livrerait l'artefact
  qu'aucun appelant n'atteint — refusé deux fois dans ce dépôt. Le site d'appel arrive avec la
  première route qui lit la base. Ce que la fiche demande — pool, cycle de vie, arrêt propre — est
  livré par `internal/store` et exercé contre un PostgreSQL réel.

**Ce qui n'est couvert ni par l'un ni par l'autre**, et qui s'écrit là où il vit : le cas « DSN bien
formé, base injoignable ». C'est le comportement documenté d'un pool paresseux — il ne devient
observable qu'à la première requête, et la step lectrice en héritera avec DN-6.

### DN-8 — testcontainers entre ici, sa réutilisation reste à step-007

step-005 ne peut pas tester ses migrations sans base réelle : l'outil arrive donc avec elle, en forme
minimale — un conteneur par suite. Ce que step-007 garde, et que sa fiche écrit déjà, est
l'**amortissement** entre suites, pour lequel `modules/postgres` fournit `Snapshot`/`Restore`. Sa
ligne « Dépend de » a été corrigée avant le code.

**Mesuré, et c'est ce qui rend l'outil acceptable ici** : sans Docker, testcontainers **échoue** — il
ne skippe pas. Le skip existe (`SkipIfProviderIsNotHealthy`) mais il est opt-in explicite, et **il ne
sera pas appelé** : un skip est vert.

Mesuré aussi, contre la note du skill qui prescrit de préfixer `DOCKER_HOST` : la suite tourne
**sans** cette variable — le contexte Docker courant est `orbstack`, et testcontainers le consulte.
Plus net encore, vérifié pendant l'implémentation : **`DOCKER_HOST` pointé sur une socket
inexistante est ignoré** et la suite passe quand même. C'est le contexte qui décide ici, pas la
variable — donc rien à exporter, ni sur un poste ni sur `ubuntu-latest`, dont les runners ont Docker
Server au manifeste. La note du skill reste vraie ailleurs ; elle ne l'est pas ici.

### DN-10 — Ce que la mesure a corrigé du périmètre lui-même

- **Le « délai d'acquisition » que le périmètre demande n'existe pas** en `pgx v5.10.0` : ni champ
  `AcquireTimeout`, ni paramètre de DSN. `Acquire` s'en remet au contexte de l'appelant. Ce qui est
  posé à la place est `ConnectTimeout`, dont le défaut non renseigné vaut **deux minutes** — c'est
  ce qu'une première requête paierait sur une base injoignable.
- **`pgxpool` n'attache rien au contexte** : `Close` est le seul chemin qui ferme, et le `ctx` de
  `New` ne sert qu'aux connexions oisives. « Cycle de vie attaché au contexte racine » est donc du
  code à écrire, et il l'est.
- **Quatre réglages du pool ne sont tenus par aucun test** — durée de vie maximale, son jitter,
  temps d'inactivité, délai de connexion. Leur effet n'apparaît qu'avec le temps ou sur une base
  injoignable, cas que DN-7 laisse à la step lectrice. Le constat est écrit au-dessus d'eux.
- **Le verrou de migration n'est tenu par rien non plus** : trois migrations concurrentes sur une
  base vierge donnent le même résultat avec et sans `WithSessionLocker`, la transaction par
  migration suffisant à sérialiser localement. Il est posé parce que le produit tourne en ≥2
  instances, mais rien ne rougirait à son retrait.

### DN-9 — `docker-compose.yml` cesse de renvoyer à une commande qui n'existe pas

Son en-tête dit « `docker compose up -d` puis `pnpm db:migrate` » — reliquat de la v1.0 en Node,
alors que le README et `CLAUDE.md` annoncent `make migrate`. Le fichier est nommément dans le
périmètre de cette step, et un commentaire faux est ce que la DoD traque : il est corrigé dans la PR
qui crée la cible qu'il doit citer.
