# step-006 — Catalogue de permissions : une source Go, un TypeScript généré

> **Jalon :** M0 (§3.1, §6.10) · **Statut :** À FAIRE
> **Dépend de :** step-000, step-001, step-004 · **Bloque :** step-020, step-040

## But
Le vocabulaire de l'autorisation — **44** clés fixes, versionnées avec les releases, non éditables
depuis l'interface. *(Le « ~44 » d'origine est retiré : la spec écrit « 44 clés » au caractère près,
`todo.md` aussi, et je les ai comptées. Le tilde ne survivait que dans cette fiche et `plan.md`.)* Il vit en Go, et le TypeScript que consomme le client en est **généré**.

## Périmètre (ce que fait CETTE PR)
- `internal/permissions/` : les clés, leur catégorie et leur description en français, dans une
  structure Go immuable.
- Générateur → `web/src/lib/permissions.ts`, marqué comme généré et **commité**.
- Cible `make generate` étendue ; **test de divergence bloquant** en CI.
- Aucune garde, aucun rôle : seulement le vocabulaire.

## Points d'implémentation clés
- **C'est la seule couture que la bascule Go a créée.** La v1.0 avait un module TypeScript importé par
  les deux moitiés (7 imports côté client, 13 côté serveur) : la commodité disparaît quand le serveur
  change de langage. Deux catalogues maintenus à la main divergeraient en silence, et le client
  afficherait des contrôles que le serveur refuse — précisément ce que la charte interdit.
- **La direction de la génération n'est pas arbitraire.** La garde serveur est ce qui protège
  réellement ; le rendu client est un confort (invariant c). La source doit être du côté qui décide.
- Ajouter une clé reste **trois endroits dans la même PR** : le catalogue ici, la garde qui l'exige, le
  tableau des rôles par défaut (step-020). Une clé sans garde ne garde rien ; une garde sans clé refuse
  tout le monde ; une clé qu'aucun rôle ne détient est inaccessible à tous sauf `super_admin`. Les
  trois erreurs sont silencieuses.
- Le fichier généré est commité plutôt que produit au build : le client doit typechecker sans que la
  toolchain Go soit installée.

## Tests (écrits dans la même PR)
- **Test de divergence** : modifier le catalogue Go sans régénérer fait échouer la CI. C'est le test
  central de cette step ; il se mute en ajoutant une clé côté Go seulement.
- Les descriptions sont en français, les clés en anglais (§1.7) — vérifié sur la forme des clés
  (`domaine:action`, minuscules), pas sur la langue de la description, qui n'est pas testable.
  *(Amendé en phase 2 — la forme énoncée ici est fausse pour quatre clés du catalogue : voir DN-2.)*
- Aucune clé orpheline : chaque clé du catalogue appartient à au moins une catégorie connue.
  *(Étendu en phase 2 — « connue » se définit désormais contre le `CHECK` SQL, et le sens inverse
  est ajouté : voir DN-5.)*

## Definition of Done
- [ ] `make check` vert · `make generate` idempotent
- [ ] le fichier TypeScript porte un en-tête « généré — ne pas éditer » et le lint le respecte
- [ ] la mutation « éditer le TypeScript généré à la main » est détectée par la CI

## Hors périmètre
Les neuf rôles par défaut et le seed → step-020. `RequirePermission` → step-025. `usePermission` et
`PermissionGate` → step-040.

## Tableau des mutations

Tenu au fil de l'eau. Une ligne « aucune porte ne rougit » est un constat de la DoD (critère 4), pas
un aveu — à condition d'avoir été **vérifiée** et d'être écrite au-dessus de la ligne concernée.

| Mutation appliquée | Ce qui tombe |
|---|---|
| `RoutesRead = "routes:Read"` (majuscule) | `TestEveryKeyFollowsTheAdmittedShape` |
| Forme resserrée à `^[a-z]+:[a-z]+$` — celle que la fiche annonçait | `TestTheAtypicalKeysAreAdmitted` **et** `TestEveryKeyFollowsTheAdmittedShape` |
| Forme élargie à `.*` | `TestTheShapeRejectsWhatNoKeyCarries` |
| Forme ramenée à celle de DN-2 d'origine (`[a-z0-9]*` au domaine) | `TestTheShapeRejectsWhatNoKeyCarries`, 2 assertions — `routes2:read` et `routes:read2` |
| `RoutesRead` déclarée une seconde fois | `TestNoKeyIsDeclaredTwice` |
| Sonde DN-9 : `{Key: "orpheline:x", Category: "inexistante"}` | **compile** (`go build` vert), puis `TestEveryCatalogCategoryIsAcceptedBySQL` — le constat « test mort-né » est réfuté |
| `"routing"` → `"routting"` sur les 8 clés de la famille | `TestEveryCatalogCategoryIsAcceptedBySQL` **et** `…CarriesAtLeastOneKey` |
| Les 3 entrées `connectors:*` retirées *(le défaut réel de la v1.0)* | `TestEveryCategoryAcceptedBySQLCarriesAtLeastOneKey`, **seul** |
| `Categories()` triée au lieu de l'ordre d'affichage | `TestCategoriesListsExactlyWhatTheKeysCarry` |
| Une description vidée | `TestEveryEntryCarriesADescription` |
| `categoryCheck` ne reconnaît plus le `CHECK` (`categorie`) | les deux cas SQL, via le `require.Len(constraints, 1)` — le filet du test lui-même |
| **U2** · largeur de ligne comptée en octets au lieu de points de code | `TestADescriptionIsWrappedExactlyWhereBiomeWouldWrapIt`, `TestTheCommittedFileIsWhatTheGeneratorProduces`, **et `biome check` rend 1** — remesuré après le correctif de revue, générateur muté puis régénéré |
| **U2** · l'indentation de continuation passe de 6 à 4 espaces | trois cas, **et Biome réécrit** |
| **U2** · les catégories passent par une `map` (ordre non déterministe) | `TestTwoRunsProduceTheSameBytes` et deux autres |
| **U2** · le refus du guillemet droit retiré | `TestAStraightApostropheInADescriptionIsRefused` |
| **U2** · la garde sur le nombre d'arguments retirée | `TestTheCommandRefusesToGuessItsOutputPath`, plus le `panic: index out of range` que son commentaire annonçait |
| **U3** · *(avant câblage)* catalogue Go modifié, TS non régénéré | **`check-generated` rend 0** — le défaut que cette step existe pour fermer, constaté avant de le corriger |
| **U3** · *(après câblage)* la même | `check-generated` rend 2 : « du code engendré diffère de ce qui est commité » |
| **U3** · le TS engendré édité à la main **et indexé** *(le scénario réel — la CI ne voit que ce qui est commité)* | `check-generated` rend 2, **et** `tsc` rend `TS2820: Type '"audit:raed"' is not assignable to type 'PermissionKey'` — deux portes indépendantes |

**Une mutation d'abord mal construite, et ce qu'elle a appris.** Éditer le TS engendré **sans**
l'indexer laisse `check-generated` **vert** : la porte supprime et régénère avant de comparer, donc
elle rétablit l'édition avant de la voir. La première mutation ne reproduisait donc pas le défaut
réel, et elle se lisait comme un succès de la porte. Refaite avec `git add`, elle mord.

*Corrigé après revue — mon argument était plus faible que la réalité.* J'écrivais « ce n'est pas un
trou, la CI ne voit que ce qui est commité ». Un relecteur a fait remarquer, et j'ai mesuré, qu'un
simple `make check` **local** rougit sur l'édition non indexée :
`TestTheCommittedFileIsWhatTheGeneratorProduces` lit le fichier **sur le disque** et le compare au
rendu. La conclusion tenait, la raison invoquée était la plus faible des trois disponibles. La
limite de `check-generated` est désormais écrite dans le Makefile, à côté des deux autres qu'il
documentait déjà — c'est là qu'elle vit, la fiche partant sous `done/`.

## Design arrêté (2026-08-02)

### DN-1 — Le catalogue n'est pas réécrit : il est porté depuis la v1.0, et vérifié contre la spec

Le §3.1 énumère les 44 clés mais **ne donne ni catégorie ni description** — il ne donne que l'enum des
onze catégories et le nom d'une colonne `description`. Reconstruire les affectations de tête ou depuis
l'ordre du §3.1 produirait un catalogue faux et **invisible jusqu'à step-027**, l'écran qui les
affiche : le §3.1 range `senderrewrite:*` entre `credentials` et `suppressions` alors que sa catégorie
est `routing`, et groupe `cdr:*` avec `alerts`/`audit` alors que leur catégorie est `content`.

Le catalogue complet — clés, catégories, descriptions françaises — **existe dans l'historique** :
`git show 7c63eaf^:src/lib/permissions.ts`, supprimé par la bascule vers Go (commit `7c63eaf`). C'est
la source, et l'écart n'est pas supposé mais mesuré :

```
spec : 44   v1.0 : 44
dans la spec, absentes de v1.0 : aucune
dans v1.0, absentes de la spec : aucune
catégories SQL == spec == v1.0, même ordre : True
```

L'**ordre** est porteur de sens et n'est pas décoratif : le commentaire v1.0 dit « les familles d'un
catalogue, **dans l'ordre où l'écran d'édition de rôle les présente** ». Il est conservé tel quel.

Un motif sémantique du docblock v1.0 est repris dans le package Go, parce qu'il ne se déduit d'aucune
donnée : **le verbe dangereux a sa propre clé**. `sessions:disconnect` n'est pas dans `sessions:write`,
`credentials:rotate` n'est pas dans `credentials:write`, `scripts:publish` n'est pas dans
`scripts:write`. C'est ce qui permet à un rôle de corriger une configuration sans pouvoir déclencher
l'acte visible en production.

### DN-2 — La forme des clés que la fiche annonce est fausse, et la règle est élargie

La section « Tests » promet de vérifier la forme `domaine:action` en minuscules. **Quatre clés du
catalogue ne la satisfont pas**, et un test écrit littéralement d'après la fiche rougirait sur des clés
légitimes :

- `billing:provider:write` — **trois** segments, deux `:`. Seule clé de sa forme.
- `billing:scope_change`, `cdr:read_pii`, `cdr:export_bulk` — underscore dans l'action.

La règle testée est `^[a-z]+(:[a-z][a-z_]*)+$` : un ou plusieurs segments après le domaine,
underscore admis dans l'action et **pas** dans le domaine — `senderrewrite` est écrit d'un seul mot
dans le catalogue, jamais `sender_rewrite`. Aucune clé ne porte de chiffre, de majuscule ni de
tiret ; la règle les refuse toutes les trois, et c'est délibéré.

**Corrigé en unité 1 — la première version de ce DN se contredisait.** Elle arrêtait
`^[a-z][a-z0-9]*(:[a-z][a-z0-9_]*)+$` *tout en affirmant* que la règle refusait le chiffre : son
`[a-z0-9]*` l'admettait partout sauf en tête de segment, et `routes2:read` la satisfaisait. Le
sub-agent l'a relevé sur un rouge qu'il n'attendait pas, et j'ai remesuré les trois formulations
possibles avant de trancher : **les 44 clés passent la version stricte**, donc c'est la règle qui a
bougé plutôt que l'affirmation qui a été affaiblie. Mutation vers la version arrêtée d'origine :
deux assertions tombent.

La clé n'est pas renommée pour entrer dans la règle : elle est au contrat et à la spec.

### DN-3 — Les constantes Go sont la source des chaînes, le catalogue les référence

La génération va de **Go vers TS**. Les constantes Go ne peuvent donc pas être « engendrées à coût
nul » — c'est une prémisse fausse que l'arbitrage a corrigée. Elles s'écrivent à la main, et la façon
de les écrire décide s'il y a un ou deux artefacts à tenir cohérents.

*(Orthographe corrigée en unité 1 : le type Go s'appelle `Key`, pas `PermissionKey` — ce dernier
donnerait `permissions.PermissionKey`, un bégaiement que la convention Go proscrit. Le TypeScript
engendré garde `PermissionKey`, où le nom ne bégaie pas.)*

Retenu : le bloc `const` est **l'unique déclaration des 44 chaînes**, et les entrées du catalogue les
référencent (`{Key: RoutesRead, …}`) plutôt que de répéter les littéraux. Il n'y a alors pas deux
listes à synchroniser, il y en a une.

Ce que ces constantes achètent, et pourquoi elles entrent malgré `RequirePermission` hors périmètre :
`type PermissionKey string` accepte n'importe quelle chaîne par conversion, donc une garde mal
orthographiée — `RequirePermission("routes:raed")` — **compile et refuse tout le monde en silence**.
C'est la classe de défaut la plus chère de ce dépôt. Les constantes sont le vocabulaire sous sa forme
consommable en Go : elles n'ajoutent ni garde, ni rôle, ni comportement, donc rien de ce que « Hors
périmètre » nomme. Les livrer en step-025 obligerait la step du middleware à restructurer le livrable
de celle-ci — un débordement en sens inverse.

### DN-4 — Une cible `generate-permissions` séparée, agrégée par `make generate`

Le générateur est du **Go pur** : il ne lit ni contrat OpenAPI ni `node_modules`. Or la recette de
`make generate` s'ouvre sur une garde qui refuse de démarrer sans `pnpm install`.

Trois options pesées ; à garantie **égale**, la moins invasive gagne. La garantie réelle ne vient
d'aucune des trois : elle vient de `check-generated`, qui supprime puis régénère et lit
`git status --porcelain`. Dès que le fichier entre dans sa liste, le front est tenu de la même façon
dans les trois cas.

Donc : cible séparée, agrégée par `make generate`. L'ajouter à la recette existante coupleraient du
Go pur à pnpm sans raison ; déplacer la garde réécrirait une recette dont les commentaires
documentent des mesures durement acquises. Une cible par dépendance réelle est déjà l'idiome du
Makefile — le dépôt a une porte granulaire par job de CI.

### DN-5 — Le troisième front, Go ↔ SQL, est tenu ici et pas trois steps plus loin

Les onze catégories vivent à **trois** endroits : la structure Go, le TypeScript engendré, et le
`CHECK (category IN (…))` de `00001_operators_roles_permissions.sql`, **déjà mergé**.
`check-generated` tient Go↔TS. **Rien ne tient Go↔SQL** : une douzième catégorie, ou une catégorie
mal orthographiée en Go, passerait toutes les portes et n'échouerait qu'à l'`INSERT` du seed, en
step-020, chez quelqu'un qui n'aura plus le contexte.

« Aucune garde, aucun rôle » exclut `RequirePermission` et le seed — pas les preuves de cohérence du
vocabulaire. Et la fiche demande déjà que chaque clé appartienne à une catégorie **connue** : la seule
définition de « connue » extérieure au Go est ce `CHECK`. C'est cette step qui crée la troisième
copie, donc la preuve lui appartient.

Le test compare les deux ensembles **dans les deux sens**.

**Corrigé en unité 1 — ce DN prescrivait un mécanisme qui ne compile pas.** Il disait « par
l'`//go:embed` déjà en place ». Mesuré : `//go:embed ../store/migrations/00001_….sql` rend
`invalid pattern syntax` — un motif `go:embed` ne remonte pas au-dessus de son répertoire, ce que
`CLAUDE.md` dit d'ailleurs à propos de `internal/webassets/` — et l'`embed.FS` de `internal/store`
est privé. Le test lit donc le fichier par `os.ReadFile` sur un chemin relatif au package. Ce que
l'embed achetait — voyager avec le binaire — n'a aucune valeur pour du code de test, et un
`testdata/` copié aurait créé une **quatrième** copie du `CHECK`, c'est-à-dire l'inverse de ce que ce
DN cherche. Le sens « catégorie sans aucune clé » n'est pas
décoratif : c'est le défaut réellement survenu en v1.0, où `connectors` a existé dans l'enum
PostgreSQL sans qu'aucune clé ne s'y rattache.

**Ce que ce test fige, et comment le mettre à jour.** Il fait de `00001` la vérité. Le jour où une
douzième catégorie arrivera légitimement, ce sera par une **nouvelle** migration qui `ALTER` la
contrainte, et un test qui ne lit que `00001` mentirait. Sa mise à jour consiste alors à lire la
**dernière** définition de la contrainte — jamais à élargir une liste en dur dans le test.

### DN-6 — Le TypeScript engendré est minimal : les données et leurs types, aucun helper

Les deux consommateurs prévus n'appellent aucun des helpers de la v1.0 : step-027 groupe par catégorie
(trois lignes sur le tableau) et step-040 teste l'appartenance à l'ensemble rendu par `/auth/me`, une
donnée d'exécution pour laquelle le catalogue ne fournit qu'un type.

Engendré : le tableau des 44 entrées, l'union `PermissionKey`, l'union `PermissionCategory`. Pas de
`permissionByKey()`, pas de `PERMISSION_KEYS`. Du code engendré sans appelant est pire que du code
mort ordinaire : `check-generated` force le générateur à le maintenir à vie pendant que la CI ne
prouve rien sur lui.

`PermissionCategory` est bien une donnée et non un helper — émettre `category: string` jetterait une
information que le générateur possède.

### DN-7 — Pas de test sur le cardinal ; le fichier TS commité est déjà le golden

Distinguer « clé perdue par accident » de « clé retirée à dessein » exige par construction une
**seconde déclaration indépendante, maintenue à la main** — c'est-à-dire le rituel de mise à jour
qu'on cherche à éviter. Un `len(Catalog) == 44` en est la pire forme : son incrément 44 → 45 ne porte
aucune information relisible, et on le met à jour sans le lire.

Or cette seconde déclaration **existe déjà** : `permissions.gen.ts` est commité et `check-generated`
force sa régénération. Une clé perdue en Go produit mécaniquement, dans la PR, une **ligne supprimée
nommée** dans le diff — un golden par clé, gratuit, que la revue lit. Le compteur n'ajouterait que le
rituel.

*(L'arbitrage s'appuyait aussi sur le « ~44 » de la fiche pour dire que le nombre n'est pas
load-bearing. **Cet argument-là est faux** : la spec écrit « 44 clés » au caractère près, `todo.md`
aussi, et je l'ai compté. Seul le tilde de la fiche et de `plan.md` hedge. La décision tient sans cet
argument, sur le seul fait que le golden existe déjà.)*

Le constat s'écrit là où il vit, en tête du catalogue (critère 4 de la DoD).

### DN-8 — Le fichier engendré s'appelle `permissions.gen.ts`, pas `permissions.ts`

La fiche écrit `web/src/lib/permissions.ts`. La convention du dépôt est le suffixe `.gen.ts`, et elle
est **porteuse** : c'est lui qui range le fichier avec `api.gen.ts` et `routeTree.gen.ts` dans les
trois endroits qui traitent l'engendré — l'exclusion `files.includes` de Biome, le
`linguist-generated=true` du `.gitattributes` qui replie le diff, et la liste `GENERATED` du Makefile.

Un `permissions.ts` sans suffixe serait rangé avec le code écrit à la main, et c'est précisément le
piège relevé en arbitrage : si Biome reformate ce que le générateur émet, `check-generated` et
`lint-web` se contredisent en boucle, chacune exigeant l'inverse de l'autre.

**Corrigé après revue — j'avais exclu de Biome un fichier qu'il ne fallait pas.** U3 a élargi
l'exclusion à `!**/*.gen.ts`, par analogie avec `api.gen.ts`. Deux relecteurs ont montré que
l'analogie est **fausse**, et je l'ai remesuré : `api.gen.ts` **diffère de 112 lignes** de ce que
Biome émettrait — son exclusion est portante, parce qu'un générateur tiers ne se plie pas — quand
`permissions.gen.ts` en est **byte-identique**, notre générateur ayant été écrit pour ça.

L'exclusion ne l'exemptait donc de rien : elle retirait la seule porte qui reliait
`lineWidth = 100` entre `web/biome.json` et le générateur, laissant la valeur vivre à deux endroits
que plus rien n'accordait. Elle avait aussi, sans que personne le note, rendu **fausses** deux
lignes du tableau des mutations ci-dessus, écrites dans le commit qui les invalidait.

`permissions.gen.ts` est réinclus ; `api.gen.ts` et `routeTree.gen.ts` restent exclus. Vérifié sur
le livré : `biome check .` passe de 18 à 19 fichiers sans réécriture, et la porte **mord** — la
largeur comptée en octets, régénérée, rend `biome check` à 1. Le `.gitattributes` reste inchangé :
replier le diff est cosmétique et vaut pour les quatre.

### DN-9 — Ce que la mesure a corrigé d'un constat de relecture

Un relecteur a affirmé que le test « chaque clé appartient à une catégorie connue » serait **mort-né**
en Go, le compilateur le portant déjà dès lors que `Category` est un type nommé. **Mesuré, c'est
faux** : sur une sonde jetable, `{Key: "orpheline:x", Category: "inexistante"}` **compile et
s'exécute**, un littéral chaîne non typé se convertissant implicitement vers un type nommé de
sous-jacent `string`. C'est l'analogie avec TypeScript — où `as const satisfies` l'aurait attrapé —
qui est trompeuse, pas le test.

Le test reste donc écrit, et il peut tomber. Le sens inverse que DN-5 ajoute ne le remplace pas : il
le complète.
