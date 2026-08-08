# step-009 — Contrat Admin en 4.0.2 : deux majeures relues, payées sur le seul généré

> **Jalon :** M0 (§3.2, §5.1) · **Statut :** LIVRÉE (08/08/2026)
> **Dépend de :** step-003 · **Bloque :** step-043, et toute step touchant CDR, recherche ou export

## But
Sortir le dépôt de 2.5.0 pendant que le bump ne coûte encore qu'un fichier engendré. Deux majeures
séparent le contrat installé de celui qui est publié, et **ce qu'elles changent n'a jamais été relu**.
Le relever fait partie du travail : la compilation ne montre que la moitié des ruptures.

## Périmètre (ce que fait CETTE PR)
- `web/package.json` : `2.5.0` → **`4.0.2`**, lockfile à jour, `make generate` rejoué.
- Le diff du YAML relu **ligne à ligne**, et ses ruptures inscrites ici — celles que la compilation
  montre comme celles qu'elle ne montre pas.
- `internal/gateway/contrat_test.go` : l'échantillon de la porte anti-copie re-mesuré sur le nouveau
  contrat, comme son propre commentaire l'exige à chaque majeure.
- Les textes que le bump périme, corrigés — **deux classes distinctes**, voir DN-4 — et une garde sur
  celle des deux qui est mécanisable.

## Points d'implémentation clés

**Le YAML Admin de 4.0.0, 4.0.2 et 4.0.3 est le même fichier.** Mesuré au sha256 :
`97a6cebe3974e63f2a116a67424549821733d611cf59d4dd9a25eb4fd177a2fd` pour les trois. Les patches n'ont
touché que `openapi-public.yaml`, que ce dépôt ne consomme pas — `CONTRACT_ADMIN` ne pointe que sur
`openapi-admin.yaml`. Le dépôt reçoit donc exactement le contrat Admin de la 4.0.0, celui que `todo.md` prescrivait.

**4.0.3 est refusée aujourd'hui, et ce n'est pas une gêne.** Publiée le 08/08 à 12:04:47 UTC, elle est
sous `minimumReleaseAge: 1440` jusqu'au 09/08 12:04:47. L'épinglage étant **exact** et
`minimumReleaseAgeStrict: true` interdisant tout repli, l'installer ferait échouer `pnpm install` au
lieu de reculer. 4.0.2 (03/08, 5 jours) passe et porte le même Admin au bit près.

**L'ampleur, mesurée** : 2 755 → 2 828 lignes, 137 420 → 142 114 octets, **105 lignes changées en
9 hunks**. **133 operationId avant, 133 après** — ensembles identiques, comme les 89 chemins : aucune
opération ajoutée, supprimée ni renommée. **6 opérations touchées sur 133** : `search-messages`,
`create-message-export`, `get-message-export`, `stream-metrics`, `stream-sessions`,
`stream-billing-alerts`.

> **Corrigé après revue — « deux majeures de *forme* » était faux, et l'effacement était le défaut.**
> Cette phrase concluait le paragraphe ci-dessus. Un relecteur a montré que le décompte « 6 opérations
> touchées », exact au sens des blocs modifiés, servait à clore la relecture — alors que trois
> changements de **fond** passent par des `summary` et des `description` que le décompte ne compte pas :
>
> 1. **`stream-billing-alerts` promet moins qu'avant** (3.0.0). Son résumé passe de « MT low-balance /
>    MT overdraft-attempt / MO floor-reached alerts » à « **MO floor-reached alerts** », avec
>    « low-balance and breaker-open alerts have no configured threshold yet ». Deux des trois alertes
>    ont disparu du contrat. Pour un dépôt qui prévoit un `internal/alerting/` et un jalon M2 sur le
>    hub WS, c'est une capacité en moins, pas une reformulation.
> 2. **`MessageTrace` change de nature** (3.0.0). De « OpenTelemetry span timeline » à « lifecycle
>    timeline […] built from the durable CDR event log », les exemples de `name` passant de
>    `pipeline.senderid_auth` à `cdr.accepted`. `get-message-trace` sert autre chose qu'avant sans que
>    son bloc d'opération ait bougé — un **septième** point de contact, qui vise step-102.
> 3. **`create-message-export` perd `audited`** de son résumé (4.0.0) : « (audited, row-capped, …) » →
>    « (row-capped, …) ». Le contrat ne déclare plus l'export comme audité.
>
> Aucun des trois ne change un type, donc aucun n'entre dans R1–R6 ; c'est précisément pourquoi ils
> devaient être écrits. Je les avais lus dans le diff sans les consigner, et le mot « forme » les a
> effacés — la relecture avait bien eu lieu, sa restitution était fausse.

**Aucune n'est appelée ici.** Le seul code non engendré qui atteint le contrat vit dans des tests, et
n'exerce que `list-customers` et `suspend-customer` — ni l'une ni l'autre n'apparaît au diff. C'est
littéralement l'argument du renvoi § de `todo.md` : le bump se paie sur le seul
`internal/gateway/client.gen.go`, et il ne se paiera jamais moins cher.

### Les six ruptures, et la moitié que la compilation ne montre pas

| # | Ce qui change | Vue par `go build` ? |
|---|---|---|
| **R1** | `search-messages` : `from_date` et `to_date` deviennent **`required: true`** (3.0.0) | **Oui** — `*time.Time` + `omitempty` → non-pointeur (`client.gen.go:3895-3896` sur 2.5.0) |
| **R2** | `MessageExportRequest.format` : **`parquet` retiré** de l'enum (4.0.0) | **Oui** — la constante `Parquet` et son cas dans `Valid()` disparaissent (l. 1339 et 1349 sur 2.5.0) |
| **R3** | `filters` : `additionalProperties: true` → `$ref: MessageExportFilters`, lui-même `additionalProperties: false` + `required: [from_date, to_date]` (4.0.0) | **Oui** — `Filters map[string]interface{}` → struct (l. 3073 sur 2.5.0) |
| **R4** | `CdrStatus` : 6 → **8 valeurs**, `accepted` et `cancelled` ajoutés (3.0.0) | **Non** — deux constantes de plus, rien ne casse |
| **R5** | `security` par opération : `admin:read` (recherche, `stream-*`) en 3.0.0, `cdr:export_bulk` (les 2 exports) en 4.0.0 ; scope `msisdn:reveal` catalogué **en 3.0.0** | **Non** — oapi-codegen n'engendre **rien** du `security` |
| **R6** | `ExportJob.error` ajouté ; +401/403/422 et un **503** inline sur l'export | Oui pour le champ (`ExportJob` l. 2844-2853 sur 2.5.0), non pour les codes |

**R4 est plus vicieux qu'il n'en a l'air.** oapi-codegen engendre une méthode `Valid()` dont le
`switch` est exhaustif sur l'enum du contrat. En 2.5.0, `CdrStatus("accepted").Valid()` rend donc
**`false`** — alors que `search-messages` renvoie ce statut sur chaque message fraîchement accepté. Le
commentaire ajouté au YAML le dit : « a narrower enum here made the contract under-declare what the
API already serves ». Aucun code écrit à la main ne touche `CdrStatus` aujourd'hui (grep vide), donc
rien ne casse ; la step qui lira des CDR héritera d'un enum juste plutôt que d'un enum court.

**R5 est la seule vraie rupture silencieuse.** `internal/gateway/client.go` demande cinq scopes en dur
— `admin:read`, `admin:write`, `content:read`, `content:erase`, `gdpr:erase`. Ni `cdr:export_bulk` ni
`msisdn:reveal` n'y sont, et **aucune porte ne peut le voir** : le générateur ignore `security`. Le
symptôme, le jour où une route appellera l'export, sera un **403 à l'exécution** sur un code qui
compile. Voir DN-3 : ils ne sont pas ajoutés, et c'est une décision.

**Trouvé en corrigeant la revue : `cdr:export_bulk` n'est catalogué nulle part.** Le bloc
`securitySchemes.scopes` du contrat en déclare **six** — les cinq que nous demandons, plus
`msisdn:reveal` — et `cdr:export_bulk` n'en fait pas partie, alors que deux opérations l'exigent par
`security:`. C'est un **manque du contrat amont**, à corriger par une PR dans `go-gateway/api/` selon
la règle d'or du dépôt, et non en le devinant ici. Consigné dans `todo.md` au renvoi ◊ de step-104.

**Ce qui n'a *pas* changé, vérifié plutôt que supposé** : aucun `maximum` ni `minLength` resserré (les
ensembles de `maximum:` sont identiques entre les deux versions), **aucun *autre* type modifié** que
R2 et R3, aucun `required` retiré, aucune réponse supprimée.

**Les vrais plafonds ne sont pas dans le schéma.** La fenêtre de **31 jours** (l. 1485) et le cap de
**100 000 lignes** (l. 1520) ne vivent que dans des `description`. Ils ne sont exprimés par aucune
contrainte JSON Schema : ni le générateur ni le typage ne les verront jamais, et ils rendront un 422.
*(Le `maximum: 500` du YAML est celui du paramètre `Limit` de pagination — pas un plafond de groupe.)*

## Tests (écrits dans la même PR)
- ~~**La régénération est le rouge.** `make generate` puis `go build ./...` doit **montrer R1, R2 et
  R3**.~~ **Faux, mesuré en U1 : `go build ./...` rend rc=0**, et `go test ./internal/gateway/...`
  passe. Voir la correction en DN-2 — la prédiction contredisait une mesure que cette fiche portait
  déjà trois paragraphes plus haut.
- **La porte anti-copie re-mesurée.** Son échantillon a été prélevé sur 2.5.0 ; son commentaire exige
  la re-mesure à chaque majeure, « un échantillon qui aurait dérivé rendrait cette porte verte sur une
  vraie copie ». Mutation : altérer un operationId relevé — le test doit tomber.
- **Un tableau de versions ne peut plus mentir.** Un test relie la version installée aux deux tableaux
  qui l'affirment. Mutation : y remettre `2.5.0`.
- **Les mesures que le diff périme, re-mesurées** — à commencer par « 3 de ses 133 opérations
  déclarent un 503 » (`errors.go:153`), qui en compte **4** en 4.0.2. Pas de test : c'est la relecture,
  et DN-4 dit pourquoi elle ne se mécanise pas.
- `passerelle.feature` rejoué contre Prism, qui lit le même YAML et suit le bump seul.

## Definition of Done
- [x] **`make check` vert** (08/08, onze portes)
- [x] **le diff relu ligne à ligne**, ses six ruptures inscrites ci-dessus — et le sha256 des trois
      YAML de la série 4.0.x vérifié identique, ce qui est ce qui autorise 4.0.2 là où `todo.md`
      prescrivait 4.0.0
- [x] **`make check-generated` vert** sur l'arbre régénéré (rc=0)
- [x] **la porte anti-copie re-mesurée, et le rituel remplacé par une porte** — les 28 signatures
      Admin et les 7 du contrat public sont intactes en 4.0.2, et
      `TestTheSampleStillMatchesTheContractItWasTakenFrom` l'exige désormais à chaque suite. Deux
      mutations : un operationId dérivé, l'identité `url` du contrat public
- [x] **aucun texte n'affirme plus une version que le dépôt n'installe pas** — pour la classe (A) de
      DN-4, gardée par `TestTheDocumentedContractVersionIsTheInstalledOne` (deux mutations, dont la
      ligne du tableau retirée, qui viderait la porte). *La classe (B) — les mesures datées — a été
      remesurée à la main et n'a aucune porte, ce que DN-4 assume et explique.*

### Les quatre critères transverses de `CLAUDE.md`

1. **Le chemin qu'un humain traverse.** Cette step n'en livre aucun : elle ne touche ni écran, ni
   route, ni handler. Le chemin le plus proche est celui du développeur qui régénère, et il est
   exercé par `make check-generated` sur l'arbre réel. À dire dans la PR plutôt que coché en silence.
2. **Toute affirmation confrontée à sa source.** C'est le cœur de cette step, et elle s'est appliqué
   la règle à elle-même : la fiche annonçait un rouge de compilation, `go build` a rendu rc=0, et la
   prédiction est corrigée en DN-2 au lieu d'être effacée. Une re-mesure intermédiaire a par ailleurs
   crié à la dérive de l'identité `url` — c'était mon regex qui ignorait le tiret YAML, pas le
   contrat ; refaite avec la logique exacte du test, elle rend « intact ».
3. **Mutation partout où le retrait laisserait la suite verte.** Quatre mutations jouées, plus un
   constat mesuré : l'échantillon anti-copie muté laissait **toute la suite verte**, et c'est ce trou
   qui a motivé la porte d'U2.
4. **Ce qui n'est pas testable est écrit là où il vit.** R4, R5 et les plafonds en prose n'ont pas de
   porte proportionnée : ils sont dans le tableau ci-dessus et au-dessus de la liste de scopes de
   `client.go`. La classe (B) de DN-4 est dans le commentaire de `version_test.go`.

## Hors périmètre
L'ajout des scopes `cdr:export_bulk` et `msisdn:reveal` au jeton machine → la step qui livrera
l'export CDR (DN-3). Le passage à 4.0.3 → un bump ultérieur, qui ne coûtera rien côté Admin. Toute
route consommant les six opérations touchées.

## Design arrêté (2026-08-08)

Les faits chiffrés ci-dessous ont été **mesurés** le 08/08/2026, pas déduits.

### DN-1 — On épingle 4.0.2, et le titre de la step reste vrai

`todo.md` inscrit « Contrat Admin en **4.0.0** ». On installe **4.0.2**, et ce n'est pas un écart :
les trois versions 4.0.x servent le **même `openapi-admin.yaml`**, vérifié au sha256. Le dépôt obtient
donc exactement le contrat que la ligne annonce.

Trois options pesées :
- **4.0.0** — installable (publiée le 01/08), mais épingler une version que deux patches ont
  remplacée signifierait revenir dessus au prochain bump sans rien avoir gagné.
- **4.0.3** — la plus récente, mais **matériellement refusée aujourd'hui** : quarantaine jusqu'au
  09/08 12:04:47 UTC, épinglage exact, mode strict. `pnpm install` échouerait au lieu de reculer.
  Attendre demain n'achèterait rien côté Admin, le fichier étant identique.
- **4.0.2** — retenue. Mûre depuis cinq jours, dernier `openapi-admin.yaml` publié, et l'écart de
  patch restant se paiera à coût nul.

C'est la même mécanique qu'en DN-1 de step-003, où 2.5.0 avait été retenue plutôt que 4.0.0 pour
cause de quarantaine. La différence est qu'ici la quarantaine ne coûte plus une majeure, mais un
patch qui ne touche pas notre versant.

### DN-2 — La compilation est le rouge, et le diff relu est le test que la compilation ne sait pas être

`plan.md` §1.12 prescrit l'ordre : « régénérer, laisser la compilation montrer les ruptures des deux
côtés, corriger, et **relire le diff du YAML** — parce que tout ne casse pas la compilation ».

Écrire un test qui *anticipe* R1, R2 ou R3 serait un test de complaisance : il asserterait la forme du
code engendré, c'est-à-dire le comportement d'oapi-codegen, et non celui du produit.

> **Corrigé en U1, contre la mesure.** Ce DN concluait « le rouge de cette step est donc la
> compilation elle-même — mais il ne couvre que trois ruptures sur six ». **Il n'en couvre aucune** :
> `go build ./...` rend **rc=0**, et `go test ./internal/gateway/...` passe sans une modification.
>
> La raison était sous mes yeux, dans cette fiche : *aucune* opération touchée n'est appelée par du
> code écrit à la main. R1, R2 et R3 cassent bien la forme des types engendrés — vérifié après
> régénération : `FromDate time.Time` sans `omitempty` (l. 3920), `Parquet` disparu (0 occurrence),
> `Filters MessageExportFilters` (l. 3094) et son schéma neuf (l. 3077) — mais **personne ne les
> référence**, donc rien ne casse. Une rupture de type dans du code que nul n'appelle ne rompt rien.
>
> Ce n'est pas un détail de formulation : la fiche promettait un rouge, et l'exigence « rouge lu et
> compris avant la première ligne d'implémentation » aurait été déclarée franchie sur un vert. Le
> vrai état de cette step est qu'elle **n'a pas de rouge de compilation à offrir** — ce qui la rend
> d'autant plus dépendante de la relecture du diff, seule chose qui ait regardé les six ruptures.

Les six ruptures sont donc, toutes, hors de portée de la compilation aujourd'hui. Trois s'y
manifesteront le jour où une step appellera les opérations touchées ; les trois autres — R4, R5, et les
plafonds en prose — ne s'y manifesteront **jamais**.

Aucune des six n'a de **mécanisme automatisable proportionné**. Un test qui compterait les valeurs de
`CdrStatus` figerait un nombre sans le lire ; un test qui confronterait les scopes du contrat à ceux de
`client.go` refuserait précisément la décision de DN-3 ; et asserter la forme d'un type engendré
reviendrait à tester oapi-codegen. Ce qui est livrable pour elles, c'est de les **écrire là où elles
vivent** (critère 4) : le tableau ci-dessus, et un commentaire au-dessus de la liste de scopes de
`client.go`.

### DN-3 — Les deux scopes ne sont pas ajoutés au jeton machine

`cdr:export_bulk` et `msisdn:reveal` sont déclarés par le contrat sur des opérations qu'**aucun code
de ce dépôt n'appelle**. Les ajouter à `client.go:160` élargirait le jeton *machine* — celui qui
traverse toutes les requêtes sortantes — pour du code qui n'existe pas.

`msisdn:reveal` pèse particulièrement : c'est le droit de voir les numéros d'abonnés en clair là où le
contrat les masque par défaut. Un jeton qui le porte en permanence déplace la frontière que le contrat
vient d'établir, et la déplace pour personne.

L'argument inverse est réel : la step qui livrera l'export se heurtera à un 403 que rien n'annonce, et
elle mettra du temps à comprendre. C'est ce que ce DN et le commentaire de `client.go` existent pour
raccourcir — le piège est nommé, avec son symptôme exact, à l'endroit où on le rencontrera.

Le commentaire déjà présent à `client.go:157-159` dit que le jeton porte des scopes **fixes** et que la
restriction par opérateur revient au BFF (invariant c). Ajouter des scopes au fil des contrats, sans
appelant, contredirait cet énoncé sans le dire.

### DN-4 — Une garde contre l'affirmation périmée, parce que ce dépôt s'est déjà fait mordre

step-003 a livré, et sa propre fiche le raconte : « le bump du contrat est arrivé au huitième commit
et n'a fait relire aucun texte qui parlait du contrat. Cinq DN, quatre commentaires de code et six
passages de documentation affirmaient du faux ». Le correctif d'alors a été de tout remesurer à la
main. Rien n'a été posé pour que ça ne recommence pas.

Un `grep` du dépôt rend **bien plus** que les quelques textes attendus. Les trier a fait apparaître
trois classes, et la distinction décide ce qui se corrige, ce qui se re-mesure, et ce qui ne se touche
pas :

**(A) Les affirmations d'état présent.** Elles disent ce que le dépôt installe *maintenant*, donc le
bump les rend fausses sans les toucher. Ce sont les deux tableaux de versions — `plan.md:133`,
`todo.md:59` —, la « dette ouverte » de `plan.md:316-321`, la clause « celui que la branche installe »
d'`errors.go:13`, et le présent de `doc.go:17` (« Le contrat 2.5.0 **rend** »). Elles se corrigent.

**(B) Les mesures datées dont le chiffre a bougé.** « Mesuré sur le contrat 2.5.0 le 02/08/2026 » reste
vrai *en tant que mesure* — mais on la lit comme un fait actuel, et elle ne l'est plus.
`errors.go:153` en est le cas net : « 3 de ses 133 opérations déclarent un 503 » ; en 4.0.2 elles sont
**4**, `create-message-export` s'étant ajoutée. Le raisonnement qu'elle soutient — un décodeur unique
sur (statut, corps) — reste juste, ce qui rend l'erreur d'autant plus durable : rien ne la fera
tomber. S'y ajoutent les numéros de ligne de `doc.go:18,20` que la régénération déplace, et le ratio
`plan.md:737` que son propre encadré signale déjà comme non revérifié. Elles se **re-mesurent**,
chacune avec sa nouvelle date.

**(C) L'historique, qu'on ne touche pas.** `tasks/steps/done/step-003.md` nomme 2.5.0 douze fois. C'est
une fiche livrée : elle raconte une décision prise le 02/08 avec ce qui était vrai ce jour-là.
La réécrire falsifierait un compte rendu.

**La garde ne couvre que (A), et seulement sa moitié mécanisable** : les deux tableaux de versions,
dont la raison d'être est précisément d'affirmer l'état présent. Le test lit
`web/package.json` et exige qu'ils portent la même version, avec `tasks/steps/done/` exclu
explicitement — l'exclusion est le sens de la classe (C), pas une commodité.

**Ce qu'elle ne couvre pas, et qui reste à la relecture** : toute la classe (B), une clause au présent
noyée dans une phrase, et un numéro de ligne devenu faux. Vouloir la mécaniser demanderait de juger si
une affirmation *de fond* est encore vraie — c'est de la lecture, pas une porte. Écrit dans le test,
faute d'un meilleur endroit.

### DN-5 — L'overlay survivra, vérifié avant de régénérer

`api/overlay-admin.yaml` renomme deux composants pour lever des collisions Go
(`ConnectorStatus` → `ConnectorHealth`, le paramètre `SenderId` → `SenderIdPathParam`), et son mode
strict échoue bruyamment si une action ne cible plus rien. Aucun des deux composants n'apparaît au
diff : les deux cibles existent toujours, la génération passera.

L'angle mort que l'overlay nomme lui-même reste ouvert — « une action dont la cible existe encore mais
dont l'effet a disparu ». C'est la relecture du diff qui le trouverait, et elle ne l'a pas trouvé : les
deux collisions qu'il lève sont toujours là en 4.0.2.

## Ce que la revue a trouvé, et les mutations des correctifs

Trois relecteurs en lecture seule, sur trois axes : justesse des affirmations, solidité des tests,
périmètre et conventions. **Un correctif est du code comme un autre** — chacun est remesuré ici plutôt
que recopié du constat, parce qu'un correctif bâti sur un constat non revérifié en écrit un second.

| Constat | Ce que la remesure a donné | Correctif |
|---|---|---|
| **`msisdn:reveal` daté de la 4.0.0** dans `client.go` | **Faux** : 0 occurrence en 2.5.0, **2 en 3.0.0**. `cdr:export_bulk`, lui, est bien de la 4.0.0 (0 en 3.0.0) | date corrigée, et R5 datée version par version |
| La phrase préexistante « les scopes sont **ceux que déclare le contrat** » devenait fausse | **Juste, et pire que dit** : le contrat catalogue **six** scopes et nous en demandons cinq — mais `cdr:export_bulk`, exigé par `security:`, **n'est catalogué nulle part**. Manque amont trouvé en corrigeant | phrase amendée en « cinq des six » ; le manque amont consigné et renvoyé à une PR dans `go-gateway/api/` |
| DN-3 citait cette phrase comme disant « fixes » | **Juste** : elle dit « ceux que déclare le contrat », ce qui argumentait l'inverse de la décision | l'argument tombe ; DN-3 tient sur le seul « pas d'appelant » |
| `CLAUDE.md:106` porte encore « quinze versions en moins de six jours » | **Juste** — troisième copie du même fait, et la garde ne peut pas la voir : `CLAUDE.md` n'a pas de tableau | corrigé, et l'angle mort écrit ici |
| L'échantillon anti-copie **peut rétrécir en silence** | **Juste** : une signature retirée laissait toute la suite verte, et le seuil suit `len()` | trois `require.Len` — le décompte est écrit, pas dérivé |
| La porte vérifie des **lignes**, pas des **couples** | **Juste** : `operation("/admin/customers", "suspend-customer")`, paire inexistante, passait | couples lus par `openapi3.Loader` ; les lignes restent pour l'identité |
| « deux majeures de **forme** » efface trois changements de fond | **Juste** — voir l'encadré des points d'implémentation | les trois consignés |
| « aucun type modifié » contredit R2 et R3 | **Juste** | « aucun *autre* type modifié » |
| « treize jours » | **Faux d'un jour** : 12 j 10 h 36 entre 1.0.0 et 4.0.3 | « douze jours », aux trois endroits |
| Le piège des scopes n'est pas là où step-104 regardera | **Juste**, et aggravé : `cdr:export_bulk` est **aussi** une permission BFF (§6.10), donc le réflexe sera de chercher `RequirePermission()` | renvoi ◊ sous step-104 dans `todo.md`, qui nomme les deux couches |
| Numéros de ligne du tableau R non datés | **Juste** : exacts sur 2.5.0, faux sur la branche | « sur 2.5.0 » ajouté |
| Le même fait écrit deux fois dans `contrat_test.go` | **Juste** | dédupliqué |
| `versionsAnnouncedIn` ne trim pas sa capture | **Juste** : `** 4.0.2 **` rendait un message illisible | `strings.TrimSpace` |

**Mutations rejouées après les correctifs** — la porte renforcée, quatre fois :

| Mutation | Ce qui tombe |
|---|---|
| `operation("/admin/customers", "suspend-customer")` — paire inexistante | le couple : « ne déclare plus … » *(restait vert avant le correctif)* |
| une signature Admin **retirée** | `require.Len` : « l'échantillon Admin a changé de taille » *(restait vert avant)* |
| la marque d'identité `url` du contrat public retirée | `require.Len` : « a perdu une marque d'identité » *(restait vert avant)* |
| `reorder-routes` → `reorder-routez` | le couple, comme avant le correctif |

**Ce que la revue a signalé et que je n'ai pas corrigé**, avec la raison :

- **Le maillon `package.json` ↔ paquet réellement installé n'est gardé nulle part** : mettre une
  fausse `version` dans le `package.json` du paquet installé laisse les deux tests verts. Réel, mais
  **local seulement** — la CI installe en `--frozen-lockfile`. Constat écrit plutôt que porte ajoutée.
- **Une ligne de tableau mise en commentaire HTML laisse la porte verte.** C'est l'angle mort que
  `internal/store/permissions_catalog_test.go` documente déjà (« ni `os.ReadFile` ni `regexp` n'ont de
  notion de commentaire »). Invraisemblable sur un tableau de versions ; noté, pas fermé.
- **`version_test.go` teste de la documentation depuis le package du client HTTP.** Un package dédié
  serait plus pur ; le dépôt a des précédents (`internal/bddtest/imports_test.go`,
  `internal/store/permissions_catalog_test.go` juge `internal/permissions`), et la cohésion avec
  `contrat_test.go` — même contrat, même échantillon, même paquet npm — est réelle. **Différent, pas
  meilleur** : laissé où il est.
- **Le volume de commentaire de cette step est élevé.** Assumé sur les deux tests, dont tout l'intérêt
  est de dire ce qu'ils ne gardent pas ; le changelog d'`errors.go` a en revanche été gardé court.
