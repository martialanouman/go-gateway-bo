# step-020 — Seed de l'autorisation : les 44 clés, les 9 rôles, idempotent

> **Jalon :** M1 (§3.1, §6.10) · **Statut :** EN COURS
> **Dépend de :** step-005, step-006 · **Bloque :** step-021 → step-029, et toute garde de M2

## But
Remplir le vocabulaire que step-006 a défini et que step-005 a laissé vide : les 44 permissions et
les neuf rôles par défaut existent en base, rejouables sans effet, et le binaire refuse de servir sur
un schéma en retard. C'est la **première step qui écrit une requête** — donc celle qui tranche `sqlc`
contre `pgx` nu (`plan.md` §19, renvoyée ici par l'amendement du 02/08/2026).

## Périmètre (ce que fait CETTE PR)
- Le seed des **44 permissions**, projeté depuis `internal/permissions` : la table est une image du
  catalogue Go, jamais une seconde source.
- Les **neuf rôles par défaut** du §6.10 (`is_default = true`) et leurs `role_permissions`.
- Idempotence réelle : rejouer ne change rien, et une divergence se dit au lieu d'être avalée.
- `make bootstrap`, **première moitié** : sème. La création du premier opérateur est en step-021 — le
  README annonce déjà la cible entière, et sa description se confronte au livré.
- **Vérification de version du schéma au démarrage** : dette écrite par step-005 (DN-6), qui attendait
  la première step à lire la base.
- Le choix d'accès aux données (`sqlc` ou `pgx` nu) **écrit avec sa raison**, et `plan.md` §19 mis à
  jour dans la même PR.

## Points d'implémentation clés
- **Le §6.10 est de la prose, et c'est la donnée de cette step.** Neuf listes écrites à la main, dont
  ce sont les **exclusions** qui portent le sens : `ops` sans `suppressions:delete`, `script_author`
  sans `scripts:publish`, `support_readonly` sans `content:read`, `account_manager` sans
  `billing:topup`, `auditor` sans `cdr:read_pii`. Une exclusion oubliée n'a aucun symptôme visible :
  elle accorde, en silence, exactement ce que le rôle existe pour interdire.
- **Trois clés n'appartiennent à aucun rôle sauf `super_admin`, délibérément** : `content:read`,
  `operators:manage`, `roles:manage`. Toute **autre** clé orpheline est un oubli, et le §6.10 exige
  qu'un test bloquant le signale.
- **Le seed vit dans le Go, pas dans une migration SQL.** Une migration figerait une copie des 44 clés
  que rien ne relie au catalogue, et « l'ordre des migrations est un contrat, elles ne se réécrivent
  jamais » (step-005) — or le catalogue, lui, bouge à chaque release. La contrainte `RESTRICT` de
  `role_permissions.permission_key` est déjà en place pour faire échouer bruyamment le retrait d'une
  clé encore accordée.
- **Idempotent ne veut pas dire `ON CONFLICT DO NOTHING`.** Une description modifiée doit être mise à
  jour, une clé disparue du catalogue doit être **signalée** — sinon la base garde indéfiniment un
  vocabulaire que plus personne ne lit, et le premier symptôme sera un écran de rôle qui affiche une
  permission que le serveur ignore.
- **La table de vérité se lit depuis le §6.10, jamais depuis le seed.** Une porte dont les cas
  viennent de la donnée qu'elle garde ne voit pas sa dérive : la fixture du test est écrite à la main
  d'après la spec, et la mutation qui compte **retire** une clé plutôt que d'en altérer une.
- La vérification de version compare la dernière migration appliquée à celle qu'embarque le binaire et
  **refuse de servir** en nommant les deux. Démarrer quand même produirait des échecs de forme inconnue
  à l'exécution, sur des colonnes absentes.

## Tests (écrits dans la même PR)
- **Scénario** `seed.feature` : *Étant donné* une base migrée, *Quand* le seed est joué, *Alors* les 44
  clés et les 9 rôles existent ; *Quand* il est rejoué, *Alors* rien ne change et rien n'échoue.
- **Table de vérité des neuf rôles**, exclusions comprises, sur une fixture écrite d'après le §6.10.
- Aucune clé orpheline hors des trois délibérées ; et l'inverse — aucune ligne en base qui ne soit au
  catalogue.
- Un binaire dont le schéma est en retard refuse de démarrer et nomme la version attendue et la
  version trouvée.

## Definition of Done
- [ ] `make check` vert
- [ ] `make bootstrap` existe et sème ; deux exécutions successives laissent la base **identique** —
      comparée, pas supposée
- [ ] le choix `sqlc` / `pgx` nu est écrit avec sa raison, et `plan.md` §19 ne le donne plus pour ouvert
- [ ] la mutation « retirer `suppressions:delete` de `compliance` » et celle « accorder
      `billing:topup` à `account_manager` » font rougir la table de vérité
- [ ] la mutation « retirer la vérification de version du schéma » fait rougir le scénario de démarrage

## Hors périmètre
La création du premier opérateur et `argon2id` → step-021. `RequirePermission` → step-025. L'édition
des rôles depuis l'interface → step-029. La purge des sessions et le détachement des partitions →
step-187. L'appel récurrent à `ensure_audit_log_partitions()` → step-025, première step dont une
écriture dépend (step-005, DN-11).

## Décisions

### DN-1 — `pgx` nu, pas `sqlc`

`plan.md` §19 renvoyait la décision ici, « première step qui écrit une requête ». Tranchée **contre le
code réel de cette step**, pas en général.

Ce que cette step écrit : trois instructions de réconciliation dont les paramètres sont des tableaux
`unnest($1::text[], …)` construits en Go, et qui rendent toutes la même forme minuscule —
`(kind text, name text)`. Plus une lecture de version, qui n'est même pas notre SQL : c'est
`database.Store` de goose.

- **Ce que `sqlc` engendrerait est plus petit que ce qu'il coûte.** Sa valeur est le mappage colonnes →
  struct. Ici, trois requêtes et deux colonnes de retour. En face : une dépendance `tool`, un
  `sqlc.yaml`, un paquet engendré et commité, une **cinquième** entrée dans `$(GENERATED)` que
  `check-generated` supprime et régénère, une cible `make` de plus.
- **Il introduirait un second analyseur SQL, et ce dépôt s'est déjà brûlé là.**
  `internal/store/permissions_catalog_test.go` existe parce qu'un contrôle textuel du fichier de
  migration affirmait tenir un front que PostgreSQL n'appliquait plus. `sqlc` est une réimplémentation
  Go de l'analyseur PostgreSQL ; elle devrait avaler `uuidv7()` (natif en 18 seulement), la table
  partitionnée `audit_log` et le bloc PL/pgSQL de `ensure_audit_log_partitions()` — les trois
  constructions les plus récentes du schéma. Un désaccord entre son verdict et celui du serveur
  reproduirait exactement le mode d'échec qu'on vient de corriger.
- **Ce que `pgx` nu coûte est déjà payé.** Il n'y a aucune vérification à la compilation que le SQL
  corresponde au schéma. Le filet est ailleurs, et il est meilleur : chaque requête de ce dépôt est
  exercée contre un PostgreSQL 18 réel par testcontainers — ce que le contrôle statique de `sqlc` ne
  fait qu'approcher.

**Ce qui devrait faire réviser la décision**, écrit dans `plan.md` §19 pour qu'elle ait une date de
péremption : un store qui dépasse une vingtaine de requêtes, ou une requête qui rend plus de cinq ou
six colonnes — c'est dans une liste d'arguments de `Scan` tenue à la main, dans le bon ordre, que vit
le défaut silencieux que `sqlc` supprime par construction. **Point de réexamen nommé : step-025**
(écritures d'audit et lectures de `RequirePermission`), ou la première route de liste de M3, selon
celle qui arrive la première. Une décision « à revoir un jour » qui ne nomme pas de step ne se revoit
jamais.

### DN-2 — Les neuf rôles vivent dans `internal/permissions`, pas dans `internal/store`

La règle que le §6.10 exige — « toute clé hors des trois délibérées appartient à au moins un rôle, et
un test bloquant le signale » — est une propriété du couple **vocabulaire + politique**. Elle n'a
aucune base de données : posée dans `internal/store`, elle deviendrait un test à conteneur pour une
propriété qui se calcule en mémoire.

`internal/store` porte le schéma et le code qui l'applique, pas la politique d'autorisation. Le seed
en est la **projection**, jamais la source. Corollaire pratique : les clés s'y citent par leurs
constantes (`permissions.SuppressionsDelete`), donc une faute de frappe ne compile pas — l'argument
exact que `catalog.go` donne pour l'existence des constantes.

Le prix, payé dans le même commit : `internal/permissions/doc.go` affirmait « le package ne porte
aucun rôle ». C'est devenu faux.

### DN-3 — Le mappage prose → clés est littéral et restrictif, et chaque arbitrage est écrit

Le §6.10 est de la prose, et c'est la donnée de cette step. Trois de ses neuf lignes ne se traduisent
pas mécaniquement. Le principe retenu : **ce que la prose exclut est exclu**, parce qu'un rôle trop
étroit produit une demande qu'on traite, quand un rôle trop large accorde en silence exactement ce
qu'il existe pour interdire.

- **`ops` reçoit `sessions:disconnect`.** La prose dit « lecture/écriture … sessions », et la famille
  n'a que `sessions:read` et `sessions:disconnect` : sans le second, « écriture » ne désigne rien.
- **`ops` ne reçoit aucune clé de la famille `accounts`.** La prose énumère routage, connecteurs,
  sessions, anti-spam, scripts, réécriture, numéros entrants, suppressions, alertes, CDR, et
  « lecture seule facturation/audit ». Les comptes n'y sont pas — `ops` est l'exploitation réseau.
- **`support_readonly` ne reçoit pas `credentials:read`.** La prose exclut « secrets d'identifiants,
  code source de script, réécriture ». Les deux autres membres de cette énumération désignent des
  clés (`scripts:read`, `senderrewrite:read`) : le premier en désigne une aussi, et c'est
  `credentials:read`. Le §7 dit ailleurs qu'un `support_readonly` a « la même profondeur
  d'investigation qu'un `super_admin` sans capacité de changement » — cette phrase est déjà contredite
  par l'exclusion de `scripts:read`, et c'est le §6.10 qui est la table normative des rôles.
- **`support_readonly` ne reçoit pas `cdr:export_bulk`.** Un export de masse n'est pas une lecture, et
  la prose ne le nomme que pour `ops` et `compliance`.
- **« lecture seule comptes » de `compliance`** se lit comme celle de `support_readonly` :
  `customers:read`, `accounts:read`, `groups:read`, sans `credentials:read`.
- **`compliance` reçoit `inbound:read` sans `inbound:write`** — la prose ne nomme que le premier.

`super_admin` n'est **pas** écrit à la main : il est dérivé du catalogue, le §6.10 disant « toutes les
permissions ». C'est ce qui fait qu'une clé ajoutée en step-060 revient d'office au propriétaire.

### DN-4 — Une divergence est signalée, jamais avalée ni supprimée, et n'échoue pas le déploiement

Une clé que la base garde et que le catalogue ne déclare plus est nommée sur stderr avec sa raison ;
`bootstrap` sort en **0**.

Ne pas la supprimer : le `RESTRICT` de `role_permissions.permission_key` ferait de toute façon échouer
le retrait d'une clé encore accordée, et un retrait silencieux dépossèderait les rôles qui la
détiennent. Son retrait est une migration, qui révoque d'abord.

Ne pas échouer : arrêter une livraison sur un reliquat de vocabulaire bloquerait le déploiement pour
un état qui n'empêche rien de fonctionner. Ce qu'on refuse est le silence, pas la livraison.

### DN-5 — Le pool n'est pas câblé ici, et step-005 DN-7 est dépassé par les faits

`internal/store/pool.go` annonçait « le pool part avec la première route qui lit la base (step-020) ».
**step-020 ne livre aucune route** : elle livre une commande hors ligne et un contrôle de démarrage.

Le contrôle de version travaille sur un `*sql.DB` — c'est l'interface de `database/sql` que goose
expose — et non sur un `pgxpool`. En câbler un en plus ferait deux chemins de connexion au démarrage
pour un seul besoin, et livrerait l'artefact qu'aucun appelant n'atteint, refusé deux fois dans ce
dépôt. Le seed, lui, ouvre une connexion unique : dix connexions pour trois requêtes jouées une fois
par déploiement est un objet de mauvaise taille.

Le pool part avec `POST /auth/login`, step-021. Le commentaire de `pool.go` est corrigé ici.

### DN-6 — Un schéma en avance est accepté ; seul un schéma en retard fait refuser

La comparaison est `applied < embedded`, jamais `!=`. Le produit tourne à ≥2 instances en déploiement
roulant (§4.1) : pendant la bascule, la nouvelle version a migré et les anciennes tournent sur un
schéma plus récent que celui qu'elles embarquent. Refuser là interdirait tout retour arrière, alors
que les migrations de ce dépôt sont additives — un binaire plus ancien ignore une colonne qu'il ne
lit pas.

Corollaire assumé : **le binaire exige désormais une base joignable au démarrage.** Jusqu'ici le DSN
n'était validé qu'en forme (step-005, DN-5). C'est le cas « DSN bien formé, base injoignable » que
step-005 DN-7 laissait explicitement à la step lectrice.

### DN-7 — La lecture de version n'écrit rien, et ce n'est pas l'API évidente qui le permet

`Provider.GetVersions`, `GetDBVersion` et `HasPending` passent tous par `initialize`, qui appelle
`ensureVersionTable` → `CREATE TABLE goose_db_version` + `INSERT version 0`. Un contrôle de démarrage
qui écrit du DDL sur la base qu'il vient de refuser est un effet de bord qu'on n'attend pas d'un
contrôle, et il rend le cas « base vierge » indiscernable de « base à zéro » : l'erreur que goose rend
alors, `errMissingZeroVersion`, est **non exportée**, donc inatteignable par `errors.Is`.

`database.NewStore(dialect, tableName)` + `GetLatestVersion` est l'API publique prévue pour ça, et ne
crée jamais la table. `goose.DefaultTablename` est exactement le nom que `NewProvider` utilise tant
qu'on ne passe pas `WithTableName` — ce que ce dépôt ne fait nulle part.

### DN-8 — La révocation d'attribution est réservée aux rôles `is_default`, et laisse une question à step-029

Le seed **ajoute et révoque** sur `role_permissions` : sans révocation, une clé retirée d'un rôle par
une release resterait accordée indéfiniment — la forme temporelle du défaut que cette step existe pour
éviter. La révocation porte `AND r.is_default`, sans quoi le seed écraserait un rôle créé à l'écran.

**Question léguée à step-029** : un administrateur qui édite un rôle par défaut verra son édition
défaite au déploiement suivant. Deux sorties possibles — interdire l'édition des attributions d'un
rôle `is_default`, ou basculer `is_default = false` à la première édition. Ne pas trancher ici serait
laisser un piège ; trancher ici serait déborder du périmètre.

## Tableau des mutations

Tenu au fil de l'eau. Une ligne « aucune porte ne rougit » est un constat de la DoD (critère 4), pas
un aveu — à condition d'avoir été **vérifiée** et d'être écrite au-dessus de la ligne concernée.

| Mutation appliquée (le défaut réel qu'elle rejoue) | Ce qui tombe |
|---|---|
| *(à remplir)* | |
