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
`unnest($1::text[], …)` construits en Go, et qui rendent une classe et un ou deux noms — deux colonnes
pour les permissions et les rôles, trois pour les attributions. Plus une lecture de version, qui n'est
même pas notre SQL : c'est `database.Store` de goose.

- **Ce que `sqlc` engendrerait est plus petit que ce qu'il coûte.** Sa valeur est le mappage colonnes →
  struct. Ici, trois requêtes et au plus trois colonnes de retour. En face : une dépendance `tool`, un
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
- **`support_readonly` ne reçoit pas `audit:read`.** L'énumération de son cas ne nomme pas l'audit, là
  où celle d'`ops` le nomme. Exclusion du même ordre que les précédentes, écrite ici pour être
  relisible — elle manquait à cette liste, et un relecteur l'a signalée.

`super_admin` n'est **pas** écrit à la main : il est dérivé du catalogue, le §6.10 disant « toutes les
permissions ». C'est ce qui fait qu'une clé ajoutée en step-060 revient d'office au propriétaire.

### DN-4 — Une divergence est signalée, jamais avalée ni supprimée, et n'échoue pas le déploiement

Une clé que la base garde et que le catalogue ne déclare plus est nommée sur stderr avec sa raison ;
`bootstrap` sort en **0**.

Ne pas la supprimer : la ligne du catalogue survit, et avec elle l'attribution de tout rôle que la
révocation de DN-8 épargne — un rôle composé à l'écran, ou un rôle `is_default` d'une release
antérieure. Le `RESTRICT` de `role_permissions.permission_key` protège alors la ligne. Les rôles par
défaut **que le code décrit**, eux, ont perdu l'attribution, et elle est rapportée. Retirer la clé est
une migration, qui révoque d'abord ce qui reste.

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

### DN-8 — La révocation ne porte que sur les rôles que le code décrit, et laisse une question à step-029

Le seed **ajoute et révoque** sur `role_permissions` : sans révocation, une clé retirée d'un rôle par
une release resterait accordée indéfiniment — la forme temporelle du défaut que cette step existe pour
éviter.

La garde est `EXISTS (… wanted …)` : la révocation ne touche que les rôles dont le code décrit la
composition. Ce seul prédicat couvre les deux cas — un rôle composé à l'écran n'est pas dans `wanted`,
et un rôle `is_default` que le code ne décrit plus est signalé comme inconnu par la requête précédente,
qui le laisse intact.

Un `AND r.is_default` avait été écrit à côté. **Mesuré inatteignable** : le retirer seul laissait les
huit scénarios et les tests unitaires verts, parce que `upsertRoles` force `is_default = true` sur
exactement les rôles de `wanted`, deux instructions plus haut dans la même transaction. Retiré plutôt
que doté d'un test de complaisance.

**Question léguée à step-029**, avec ce que cette PR lui impose déjà : un administrateur qui édite un
rôle par défaut verra son édition défaite au déploiement suivant. Deux sorties possibles — interdire
l'édition des attributions d'un rôle `is_default`, ou basculer `is_default = false` à la première
édition. **La seconde ne marche pas en l'état** : le seed remet `is_default = true` sur tout rôle dont
le nom figure au code, donc la bascule serait défaite au déploiement suivant. La retenir demanderait
de changer `upsertRoles` ici — c'est la moitié de l'information que step-029 aurait cherchée elle-même.

### DN-9 — Ce que la revue a corrigé, et deux commits qui sur-comptent

Trois relecteurs en lecture seule (correction/sécurité, tests et mutations, affirmations) ont rendu
vingt-neuf constats. Ce qui suit est ce qu'ils ont changé au **fond**, le reste étant au tableau des
mutations et dans le corps de la PR :

- **Le message de refus n'était pas gardé.** Les scénarios cherchaient le nombre nu dans une sortie
  `slog` JSON horodatée, où « 0 » et « 2 » figurent tous deux dans « 2026 » : vider
  `OutdatedSchemaError` de ses deux versions restait vert. Le message expose maintenant les phrases
  qu'il compose, et les scénarios exigent celles-ci.
- **Le rapport du seed n'était observé nulle part** sur un premier passage, ni son silence sur une
  base saine. Deux `Alors` ajoutés ; sans eux, `make bootstrap` pouvait annoncer « rien à semer »
  après avoir tout posé, ou crier 44 divergences à chaque déploiement.
- **`cmd/bootstrap` n'était joué de bout en bout nulle part.** Trois mutations y survivaient. La
  commande a désormais sa suite contre un PostgreSQL réel, et c'est elle qui tient la ligne de DoD
  « deux exécutions laissent la base identique — comparée ».
- **La copie mentait sur le livré.** Le message de divergence disait « Rien n'est supprimé » et
  « un retrait silencieux dépossèderait les rôles qui la détiennent », au moment même où la
  révocation venait de retirer la clé aux rôles par défaut : reproduit à la main sur une vraie base,
  puis réécrit. La seconde rédaction était fausse à son tour — elle affirmait qu'un rôle détenait la
  clé, ce qui n'est vrai d'aucun des quatre cas où le message se lit —, et une passe de revue sur les
  correctifs l'a rattrapée. Deux descriptions de rôle omettaient des clés qu'elles accordent.
- **Deux manques de fond** : `openSQL` ne posait aucune borne de connexion alors que le contrôle
  s'exécute avant `net.Listen` — une base muette aurait pendu le démarrage sans un mot ; et `Seed` ne
  prenait aucun verrou là où `Migrate` en prend un pour la même raison.

**Trois messages de commit sont imprécis, et ne sont pas réécrits** : `e78bb04` annonce « trois
commentaires » corrigés là où il en corrige deux ; `4e38a46` attribue à `CLAUDE.md` une affirmation
que seul le README portait ; et `2373b8f` compte « quatre mutations qui ont survécu » là où le
tableau ci-dessous en marque six, et annonce un correctif de `playwright.config.ts` que ce commit ne
porte pas — il a été fait dans le suivant, après qu'une passe de revue sur les correctifs l'a
constaté. L'historique n'est pas réécrit pour si peu ; l'écart est consigné ici,
puisque c'est la fiche qui reste lisible après le merge.

## Tableau des mutations

Tenu au fil de l'eau. Une ligne « aucune porte ne rougit » est un constat de la DoD (critère 4), pas
un aveu — à condition d'avoir été **vérifiée** et d'être écrite au-dessus de la ligne concernée.

### Les rôles par défaut

| Mutation appliquée (le défaut réel qu'elle rejoue) | Ce qui tombe |
|---|---|
| `suppressions:delete` retirée de `compliance` *(la DoD la nomme)* | `compliance n'accorde pas ce que le §6.10 lui donne : [suppressions:delete]`, **et** le contrôle des orphelines |
| `billing:topup` accordée à `account_manager` *(la DoD la nomme)* | `account_manager accorde ce que le §6.10 ne lui donne pas` — la branche « en trop », que seule la comparaison dans les deux sens voit |
| Le clone des clés retiré de `DefaultRoles` (copie **superficielle**, le défaut réel) | `un appelant a accordé roles:manage à un rôle pour tout le process`. La version « aucun clone » ne compile pas : elle ne prouverait rien |
| `super_admin` figé sur une liste écrite à la main | `super_admin n'a pas [42 clés]` |

### La version du schéma

| Mutation appliquée | Ce qui tombe |
|---|---|
| `applied != embedded` au lieu de `applied <` | `TestUnSchemaEnAvanceLaisseDemarrer` — une instance en cours de remplacement refuserait de servir |
| `Provider.GetVersions` à la place de `database.NewStore` *(import retiré pour que ça compile)* | `le contrôle de version a créé la table de version sur une base qu'il refuse` |
| Le code 42P01 traité comme une panne | la base vierge n'est plus refusée pour la bonne raison (`ErrorAs` tombe) |
| La version embarquée figée à **1**, puis à **9**, au lieu d'être lue sur les sources | les deux directions de dérive rougissent. Figée à sa valeur juste, elle reste verte — c'est le seul cas où elle est équivalente |
| L'erreur de pgx propagée telle quelle dans `openSQL` | `"…cannot parse password = 'tr3s-secret'…" should not contain "tr3s-secret"` |
| Une base injoignable classée « base vierge » | `une base injoignable est rapportée comme un schéma en retard` |
| `OutdatedSchemaError.Error()` vidé de ses deux versions *(revue)* | `le message ne nomme pas la version trouvée ("en version 2")`. **Cette mutation survivait** avant la revue : les scénarios cherchaient le chiffre nu dans une sortie `slog` JSON, où « 0 » et « 2 » figurent tous deux dans « 2026 » |

### Le seed

| Mutation appliquée | Ce qui tombe |
|---|---|
| Le `IS DISTINCT FROM` retiré | `la seconde exécution a rapporté des changements` — 44 clés en mise à jour |
| `ON CONFLICT DO NOTHING` à la place des CTE | la description réécrite à la main survit au rejeu |
| Les clés inconnues supprimées *(par une CTE `purged` bien formée)* | `la clé "legacy:read" a été supprimée`. La **première tentative échouait sur une erreur de syntaxe SQL** : elle ne prouvait rien, et a été refaite |
| La révocation retirée | l'attribution posée à la main sur `auditor` survit au rejeu |
| Les deux prédicats de la révocation retirés | le rôle composé à l'écran est vidé |
| `AND r.is_default` retiré **seul** | **rien** — mesuré inatteignable, `upsertRoles` forçant `is_default = true` deux instructions plus haut. La garde a été **retirée** plutôt que dotée d'un test de complaisance (DN-8) |
| Le verrou consultatif retiré *(revue)* | `aucune transaction n'attend le verrou du seed` |
| Le verrou glissé **après** `seedPermissions` *(revue)* | **rien** — le test observe que le seed attend, pas qu'il attend avant d'avoir écrit. Constat écrit au-dessus de la ligne (critère 4) |
| Les `append` de `inserted` et `added` perdus *(revue)* | `le rapport annonce 0 clé(s) posée(s) pour 44 au catalogue`. **Survivait** avant la revue : `make bootstrap` aurait annoncé « rien à semer » après avoir tout posé |
| Le `NOT EXISTS` de la branche `unknown` retiré *(revue)* | `le rapport signale une divergence sur une base que le seed vient de remplir lui-même` — 44 avertissements par déploiement. **Survivait** avant la revue |

### La commande et le binaire

| Mutation appliquée | Ce qui tombe |
|---|---|
| `store.VerifySchema` retirée de `run()` *(la DoD la nomme)* | `schema.feature` : le binaire sert, et le hook de fin le trouve encore vivant |
| Le contrôle déplacé **après** `net.Listen` | `bind: address already in use` au lieu du message de schéma. **Survivait** jusqu'à ce qu'un scénario occupe l'adresse d'écoute d'avance : l'ordre du démarrage n'était observable par rien |
| `store.VerifySchema` retirée de `cmd/bootstrap` *(revue)* | `Should be in error chain: OutdatedSchemaError`. **Survivait** : la commande n'était jouée de bout en bout nulle part |
| Les deux écrivains de `report` intervertis *(revue)* | le compte rendu part sur stderr, l'avertissement sur stdout. **Survivait** pour la même raison |
| L'appel à `report` supprimé *(revue)* | la commande ne dit plus rien |
| Les deux `Étant donné` du scénario d'ordre intervertis *(revue)* | **rien**, et c'est voulu : le pas complète l'environnement au lieu de le remplacer, donc il ne dépend plus de l'ordre |

### Ce qui n'est gardé par rien, vérifié plutôt que supposé

| Ligne | Constat |
|---|---|
| `config.ConnectTimeout` dans `openSQL` | aucune porte ne rougit — l'exercer demanderait un hôte qui avale les paquets sans répondre. Écrit au-dessus de la ligne, comme les quatre bornes équivalentes de `pool.go` |
| La position du verrou en tête de transaction | voir ci-dessus |
| Les descriptions de rôles, **en tant que copie** | la projection est gardée (base contre code), la justesse ne l'est pas : rien ne dit qu'une phrase décrit bien ce que le rôle accorde. **Quatre** ont menti et ont été corrigées à la main, sur trois passes de revue — `ops` deux fois, puis `compliance` et `billing_admin`, que les deux premières passes n'avaient pas relus. C'est la ligne de ce tableau qui a le plus coûté |
