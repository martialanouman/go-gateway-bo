# step-004 — Contrat BFF : un OpenAPI, deux bouts typés

> **Jalon :** M0 (§4.1, §5.1) · **Statut :** LIVRÉE (02/08/2026)
> **Dépend de :** step-000, step-003 · **Bloque :** toute route du BFF

## But
Établir `api/openapi-bff.yaml` comme **la** frontière entre les deux moitiés, et en générer les types
serveur Go **et** les types client TypeScript. C'est ce que §4.1 appelle la sécurité de type de bout
en bout — et c'est le mécanisme, pas l'intention, qui compte : la formulation précédente de la spec
décrivait un RPC typé que le code n'a jamais implémenté.

## Périmètre (ce que fait CETTE PR)
- `api/openapi-bff.yaml`, initialement réduit à `GET /api/health` — la surface s'étend step par step.
- Génération **serveur** : `oapi-codegen` en mode `chi-server` → interfaces de handler et types de
  requête/réponse sous `internal/bff/`.
- Génération **client** : `openapi-typescript` → types déposés sous `web/src/lib/`.

  > **Amendement du 02/08/2026, avant la première ligne de code.** Le périmètre disait « types
  > **consommés par** `openapi-fetch` ». Cette step livre les **types** et la porte qui les tient à
  > jour ; elle ne livre **pas** de client `openapi-fetch` instancié. Raison : aucun écran n'appelle
  > le BFF — mesuré, `web/src` ne contient aujourd'hui aucun appel HTTP, aucun `QueryClientProvider`,
  > et `openapi-fetch` est déclaré sans être importé. step-003 a établi la jurisprudence en refusant
  > d'étendre son DTO d'erreur « faute de route pour la servir » : un client instancié que rien
  > n'appelle serait le même code mort. Il arrive avec le premier écran qui interroge le BFF. Voir
  > DN-6.
- `make generate` enchaîne les deux ; la CI échoue si un fichier généré n'est pas à jour.
- La convention **DTO de sortie déclaré** (§1.11) est posée ici : le type de réponse d'un handler est
  celui qu'engendre le contrat, jamais une `map` ni un type de domaine.

## Points d'implémentation clés
- **Le contrat est écrit à la main, les deux côtés en dérivent.** L'inverse — dériver le contrat du
  code Go — ferait du serveur la source de vérité et rendrait toute rupture invisible au client
  jusqu'à l'exécution.
- **Ce contrat n'est pas celui de la passerelle.** Il en reprend le vocabulaire (`link_status`,
  `breaker_state`, §1.5) mais sa forme est celle dont l'écran a besoin : le BFF compose, filtre et
  masque. Là où les deux formes divergent, le YAML le commente.
- Un handler qui n'implémente pas l'interface générée **ne compile pas**. C'est ce qui rend la
  frontière tenable sur 133 opérations sans discipline.
- Le test de DTO (§1.11) vit ici : il refuse `map[string]any` et l'embedding de struct dans un type de
  réponse. Il ne trouvera rien aujourd'hui — c'est un filet posé avant qu'il y ait de quoi tomber.

  > **Précisé le 02/08 après revue, dans les deux sens.** Le test livré refuse **toute forme non
  > déclarée — `map` ou `any`, à n'importe quelle profondeur de champ** : la première version ne
  > regardait que le *sous-jacent* du type et laissait passer un `map[string]any` **dans** un DTO,
  > c'est-à-dire précisément ce que la DoD ci-dessous exige. Et il **tolère** ce que le générateur
  > produit légitimement — un sous-jacent `[]Foo` ou `string`, l'embarquement d'un `$ref` vers
  > `components/responses/*` : sa population est celle des types de réponse **écrits à la main**,
  > ceux qu'engendre l'outil étant déjà tenus par `check-generated`. Une garde qui refuse du légitime
  > se fait désactiver, pas corriger.

## Tests (écrits dans la même PR)
- **Scénario** : *Quand* `/api/health` est appelé, *Alors* la réponse valide le schéma du contrat.
- Un handler dont la signature diverge de l'interface générée **ne compile pas** — vérifié par un cas
  de compilation négatif, pas par une affirmation.
- Le test de DTO refuse un type de réponse contenant `map[string]any`.
- La CI échoue si `make generate` produit un diff.

## Definition of Done
- [x] **`make check` vert** (02/08, onze portes) · **`make generate` idempotent** — établi plus
      fortement qu'une idempotence : `check-generated` **supprime** les trois sorties, régénère, et
      lit son verdict dans `git status --porcelain`. « Régénérer depuis zéro reproduit le commité »
      est une propriété plus forte que « régénérer deux fois donne la même chose ». Elle tourne dans
      `make check` **et** en CI.
- [x] **les types client et serveur viennent du même fichier, et rien ne les recopie à la main** —
      `api/oapi-codegen-bff.yaml` et la recette `generate` lisent tous deux `$(CONTRACT_BFF)` ; les
      trois sorties sont dans `$(GENERATED)`, et **deux** mutations montrent que retirer l'une d'elles
      de la liste laisse passer sa divergence — le serveur Go et les types TS ; le client de l'API
      Admin n'a pas la sienne. *La moitié TypeScript n'a pour l'instant qu'un
      consommateur de test — c'est DN-6, et c'est dit.*
- [x] **la mutation « introduire une `map[string]any` dans un DTO de réponse » fait rougir le test** —
      `TestResponseTypesDeclareTheirFields`. *Elle ne le faisait **pas** rougir dans la première
      version : le test ne regardait que le sous-jacent du type. C'est un relecteur qui l'a mesuré,
      et c'est le bloquant principal de cette step.*

### Les quatre critères transverses de `CLAUDE.md`

1. **Le chemin qu'un humain traverse est traversé pour de bon.** Ici, c'est le load balancer — ou
   le load balancer qui sonde `/api/health` : `cmd/dashboard/contrat.feature` lance le **binaire
   compilé**, l'interroge par HTTP, et confronte les octets rendus au YAML du dépôt. Rien de simulé.
   **Ce qui n'est pas traversé et doit se dire** : la moitié TypeScript n'a aucun consommateur
   produit — seul un fichier d'assertions de typage lit les types engendrés.
2. **Toute affirmation sur le monde extérieur confrontée à sa source.** Les citations de
   `kin-openapi` et d'`oapi-codegen` ont été vérifiées ligne à ligne dans le module. Ce critère a
   coûté cher malgré tout : la revue a trouvé **neuf** affirmations fausses, dont cinq documents qui
   décrivaient un `make generate` que cette step venait de rendre faux, et un commentaire qui
   promettait une garantie du compilateur qui n'existe pas.
3. **Mutation partout où le retrait laisserait la suite verte.** Le tableau **ci-dessous**, dont les
   mutations de correctifs et plusieurs lignes « trou mesuré » assumées. Les lignes marquées
   *(constat manuel)* n'ont **aucune porte** qui les rejoue : une CI verte ne revalide pas le tableau
   entier.
4. **Ce qui n'est pas testable est écrit là où il vit.** Le trou du montage de l'interface simple,
   l'absence de journal sur un 500 (DN-12), et les gardes que rien n'exerce portent chacune leur
   constat au-dessus de la ligne concernée.

## Hors périmètre
Les routes métier — chacune arrive avec sa step. L'authentification → M1. Le client `openapi-fetch`
instancié → la première step qui livre un écran appelant le BFF (voir l'amendement du périmètre et
DN-6). La validation des **requêtes** entrantes contre le schéma, à l'exécution → DN-9.

## Tableau des mutations

Tenu au fil de l'eau. Une ligne « aucune porte ne rougit » est un constat de la DoD (critère 4), pas
un aveu — à condition d'avoir été **vérifiée** et d'être écrite au-dessus de la ligne concernée.

### La chaîne de génération

| Mutation appliquée (le défaut réel qu'elle rejoue) | Ce qui tombe |
|---|---|
| Le contrat gagne un champ, personne ne régénère *(constat manuel)* | `check-generated` → **exit 2**, en nommant `internal/bff/bff.gen.go` **et** `web/src/lib/api.gen.ts` |
| Une divergence qui ne touche **que** la sortie TypeScript *(constat manuel)* | `check-generated`, en nommant le seul fichier TS |
| Le serveur BFF retiré de la liste surveillée *(constat manuel)* | **rien** — la divergence passe : c'est le défaut que la liste ferme |
| Les types TS retirés de la liste surveillée *(constat manuel)* | **rien** — idem |
| La ligne de génération TypeScript retirée de `make generate` *(constat manuel)* | `check-generated` (` D`) |
| Le fichier engendré jamais ajouté à l'index *(constat manuel)* | `check-generated` (`??`) |

### Le handler et le scénario

| Mutation appliquée | Ce qui tombe |
|---|---|
| Le handler rend un statut **hors de l'enum** | le scénario, **sur la validation** : `at '/status': value must be 'ok'` |
| Un champ en trop dans le corps | `additional properties 'leak' not allowed` — `additionalProperties: false` mord |
| Le handler monté **à la racine** au lieu de sous `/api` | 2 tests unitaires **et 5 des 7 scénarios** — les deux de `configuration.feature` attendent un refus de démarrage et ne joignent jamais `/api/health` ; valeur corrigée après mesure, elle disait « les 7 » |
| `IncludeResponseStatus` retiré du validateur | un statut non documenté passe — c'est l'option qui l'empêche |
| Le validateur neutralisé **et** le statut changé | le second `Alors`, témoin indépendant d'un validateur devenu inerte |
| `api.NotFound(handleUnknownAPIRoute)` retiré | `TestUnknownAPIRouteIsNotFound` seul — **aucun scénario ne rougit**, vérifié : `la réponse n'est pas une page HTML` reste vraie du 404 nu de chi |
| Le `; charset=utf-8` remis | un test unitaire seul — **aucun scénario ne rougit**, vérifié : `kin-openapi` ampute les paramètres du media type avant de chercher le schéma |

### Les trois portes structurelles

| Mutation appliquée | Ce qui tombe |
|---|---|
| Le fixture divergent est rendu **compilable** | « le fixture divergent a compilé, la garantie du contrat ne tient plus » |
| Le fixture divergent échoue pour une **autre raison** (mauvais import) | l'assertion de message : `…no required module provides package… does not contain does not implement` |
| Le **témoin positif** est cassé | « le témoin positif ne compile pas » |
| Un type de réponse à sous-jacent `map` | la porte de DTO — *le message cité était celui d'avant le correctif ; la version livrée nomme le champ fautif* |
| Un type de réponse avec un champ anonyme | la porte de DTO — *vrai d'un type embarqué que le générateur n'écrit pas ; l'embarquement d'un `$ref` de réponse est désormais toléré* |
| La population d'interfaces vidée | « aucune interface `ResponseObject…` » — un analyseur qui ne trouve rien est cassé, pas vert |
| La population de types concrets vidée | `"0" is not positive` |
| `Unimplemented` embarqué à la profondeur 1, puis 2 | la garde de réflexion, aux deux profondeurs — **de la forme *valeur* uniquement** : la forme *pointeur* passait, et c'est un correctif de revue qui l'a fermée |

### Mutations des correctifs de revue

Un correctif est du code comme un autre : il repasse par le rouge et par la mutation.

| Mutation appliquée | Ce qui tombe |
|---|---|
| Un `map[string]any` **dans un champ** d'un type de réponse | le test de DTO — c'est la mutation que la DoD nomme, et elle **passait** avant le correctif |
| Un type de réponse écrit à la main qui embarque un type hors du généré | idem |
| *Tolérance vérifiée* : sous-jacent `[]Health`, `string`, embarquement d'un `$ref` de réponse | **rien** — la sortie légitime du générateur passe, là où l'ancienne version rougissait sur les trois |
| Une route `/api/health` écrite **à la main** | la porte qui confronte chaque handler monté au fichier qui le déclare |
| Une route `/api/hors-contrat` | idem |
| L'interface **simple** engendrée montée à la place de la stricte | **rien** — trou mesuré et écrit là où il vit, plutôt que promis |
| `type API struct{ *Unimplemented }` (embedding par **pointeur**) | la garde `Unimplemented`, qui le laissait passer avant le correctif |
| Le déréférencement de pointeur retiré | la profondeur 2 |
| La carte `visited` retirée | débordement de pile, qui emporte le binaire de test — couverte par un test plutôt que par une annotation |
| Les gestionnaires d'erreur laissés à leur défaut | « le message Go brut atteint le navigateur » : `text/plain` au lieu du DTO, et l'URL interne de la passerelle dans le corps |
| Le message d'erreur recopié dans le DTO | idem — la fuite sous la bonne forme |
| `contrat.feature` désactivé | `TestScenarios`, une fois le plancher relevé de 5 à 7 |
| La restauration atomique de `check-generated` remise *(constat manuel)* | une sortie désindexée + une génération en échec laissent l'arbre non compilable, sans un mot — **aucun test n'exerce `check-generated`**, cette ligne se lit à la main |
| Le montage repasse par `HandlerFromMux` (le défaut d'oapi-codegen) | la porte de montage : « laisse le défaut répondre en `text/plain` avec le message Go brut » |
| `HandlerWithOptions` gardé mais son `ErrorHandlerFunc` retiré | idem |
| `mountContract` ne monte plus rien | idem : `"0" is not positive · aucun montage du contrat : la porte est inerte, pas verte` |
| `Unimplemented` monté à la place de l'implémentation | le test de corps exact + 5 scénarios — **aucune** porte structurelle |
| Un type de réponse **sans champ** dont le `Visit…` écrit un blob arbitraire | le test de corps exact + le scénario — **aucune** porte structurelle |
| Un champ `map[string]any` sur ce même type | la porte de DTO — il **est** donc dans sa population, elle ne regarde que les champs déclarés |
| Le fichier d'assertions de typage : champ ajouté, `enum` élargi, `required` retiré | `tsc --noEmit`, sur trois formes distinctes |

Les treize ont été **rejouées sur l'arbre livré** : un `git checkout` accidenté avait effacé un
correctif en cours de route sans qu'aucun remplacement suivant ne le dise — le piège que le dépôt
nomme, « un correctif se vérifie sur le livré, pas sur l'intention du diff ».

### Les trois mesures qui ont corrigé DN-2

Deux agents s'étaient contredits ; aucun n'avait entièrement raison.

| Cas mesuré | Résultat |
|---|---|
| Deux types embarqués au même niveau | `ambiguous selector` — **ne compile pas** |
| `Unimplemented` seul contre `StrictServerInterface` | **ne compile pas** : `wrong type for method Health`, signatures non-strict |
| Un type qui embarque `Unimplemented` **et** déclare la méthode | **compile** — le membre de profondeur 0 masque le promu. C'est le seul cas que la garde attrape |
| `HandlerFromMux(Unimplemented{}, api)` — le danger réel | `TestHealthProbe` (`actual : 501`) **et** les scénarios (« la sonde de vivacité rend 501 ») |

### Mutations rejetées comme invalides

Quatre, plutôt que comptées :

- **muter le fichier engendré** ne prouve rien — la porte le supprime et le régénère, écrasant la
  mutation ;
- **ajouter un schéma non référencé** au contrat ne prouve rien non plus — oapi-codegen l'élague, la
  sortie ne bouge pas. La mutation doit changer ce que la génération **produit** ;
- `false && A || B` est équivalent à `B` par précédence : la mutation était un no-op, et le rouge
  attendu est sorti vert ;
- une assertion de typage a été **retirée** plutôt que gardée : aucune mutation ne la faisait tomber
  seule, et le commentaire qui la justifiait affirmait le contraire.

## Design arrêté (2026-08-02)

Chaque décision cite la mesure qui la fonde. Les points que la spec ne tranchait pas ont été soumis
au modèle Fable.

> **Note d'ordonnancement.** `tasks/todo.md` place step-009 (contrat Admin en 4.0.0) **avant** cette
> step. Elle est matériellement infaisable aujourd'hui : mesuré à 09:26 UTC, `pnpm` refuse encore
> 4.0.0, dont la quarantaine de 24 h court jusqu'à 17:46 UTC. step-004 ne dépend pas d'elle — sa ligne
> « Dépend de » ne cite que step-000 et step-003 — et n'engendre aucun code contre le contrat Admin,
> donc l'argument qui justifiait de placer step-009 en tête (« un bump payé sur le seul client
> engendré coûte moins cher que le même bump payé sur tout ce qui l'appellera ») n'est pas entamé.

### DN-1 — Le serveur est engendré en `chi-server` **et** `strict-server`

Le périmètre demande « des types de requête/réponse » et « le type de réponse d'un handler est celui
qu'engendre le contrat ». Mesuré, seul le mode strict le donne :

- non-strict : `Health(w http.ResponseWriter, r *http.Request)` — un `ResponseWriter` nu, où rien
  n'empêche d'écrire n'importe quoi ;
- strict : `Health(ctx context.Context, request HealthRequestObject) (HealthResponseObject, error)`,
  avec `type Health200JSONResponse Health`.

C'est la différence entre une convention tenue par la discipline et une convention tenue par le
compilateur — et cette step existe pour poser la seconde. Le mode strict donne en prime `ctx` en
premier paramètre, ce que le dépôt exige partout ailleurs. Mesuré : **aucune dépendance nouvelle**,
`chi/v5` et `oapi-codegen/runtime` étant déjà directes.

### DN-2 — `Unimplemented` est refusé par un test structurel, pas par un commentaire

oapi-codegen émet d'office `type Unimplemented struct{}`, qui répond 501 sur chaque opération.
L'embarquer dans le type qui implémente l'interface **annule** la garantie « un handler manquant ne
compile pas » — et c'est exactement ce qu'un développeur pressé fera le jour où le contrat gagnera
une opération. On ne peut pas empêcher sa génération.

La garde est donc un test qui parcourt par **réflexion** les champs anonymes du type réellement passé
au constructeur, et refuse `Unimplemented`. Structurel et non textuel : le dépôt a déjà été mordu par
un détecteur qui cherchait un nom dans du texte source, que le moindre commentaire rendait toujours
vrai.

> **Correction du 02/08, après mesure : le modèle de menace ci-dessus est faux, et la garde ne
> protège pas ce qu'elle annonçait.** Trois mesures, faites après que deux agents se soient
> contredits :
>
> 1. **Le scénario redouté est impossible en mode strict.** `Unimplemented` ne porte que les
>    signatures **non-strict** (`Health(w, r)`), donc il ne peut jamais satisfaire
>    `StrictServerInterface`. Sur un vrai contrat à deux opérations, embarquer `Unimplemented` pour
>    n'en implémenter qu'une échoue à la compilation : `does not implement … (wrong type for method
>    Ready)`. Le compilateur fait déjà le travail que ce DN confiait à un test.
> 2. **Ce qui compile est autre chose** : un type qui embarque `Unimplemented` **et** déclare la
>    méthode — le membre de profondeur 0 masque le promu. Inoffensif, mais trompeur pour un lecteur.
>    C'est le seul cas que la garde attrape réellement. *(Un troisième cas, deux types embarqués au
>    même niveau, donne `ambiguous selector` — c'est celui qu'un agent avait mesuré et pris pour le
>    cas général.)*
> 3. **Le danger réel est ailleurs, et il est couvert.** `Unimplemented` satisfait `ServerInterface`,
>    donc `HandlerFromMux(Unimplemented{}, api)` compile et rendrait 501 sur toute la surface.
>    Cette valeur naît dans `NewRouter` et aucune réflexion ne l'atteint depuis un test. Mesuré en la
>    montant : `TestHealthProbe` tombe (`actual : 501`) **et** les scénarios godog aussi (« la sonde
>    de vivacité rend 501 Not Implemented »). Ce sont eux qui tiennent cette frontière, pas la garde.
>
> La garde est conservée pour le cas 2, à son coût réel — quelques lignes de réflexion — et son
> périmètre exact est écrit au-dessus d'elle plutôt que laissé à ce DN. Ce qu'il faut retenir n'est
> pas la garde mais la méthode : le modèle de menace avait été *déduit* de la présence d'un type dans
> le code engendré, jamais *observé*.

### DN-3 — Le `; charset=utf-8` disparaît, le dépôt s'aligne sur le code engendré

Mesuré : le code engendré pose `Content-Type: application/json` ; le helper `writeJSON` du dépôt pose
`application/json; charset=utf-8`, et deux tests l'assertent verbatim.

Le charset est **redondant** : la RFC 8259 définit JSON comme de l'UTF-8 et n'enregistre aucun
paramètre `charset` pour ce type de média. Garder deux formes dans le même produit est une
incohérence qu'un test finira par figer d'un côté ou de l'autre, et un middleware dont le seul rôle
serait de réimposer le charset serait l'archétype de la garde que personne ne défendra. Le helper et
les deux tests sont donc alignés sur la forme engendrée.

### DN-4 — Le cas de compilation négatif vit sous `testdata/`, avec un témoin positif

Le dépôt n'a aucun précédent. Mesuré : `go list ./...` ne rend pas les paquets sous `testdata/`, et
`go vet ./...` les ignore — un fixture y vit sans jamais être compilé par la suite normale. Ni skip,
ni balise de compilation, donc rien qui puisse passer pour vert.

Le test compile deux fixtures et **asserte le message**, pas seulement l'échec :

- `testdata/divergent` doit échouer sur `does not implement … (wrong type for method …)` — mesuré
  verbatim ;
- `testdata/conforme` doit **compiler** — mesuré.

Le témoin positif n'est pas décoratif : sans lui, un harnais cassé où tout échoue resterait vert.
L'assertion sur le message ne l'est pas non plus — la première version de ce fixture, écrite pendant
l'arbitrage, échouait bel et bien, mais sur un **nom d'import erroné**, et un test qui n'aurait
regardé que le code de sortie l'aurait accepté.

### DN-5 — Le test de DTO définit sa population par les interfaces engendrées, jamais par un nom

« Type de réponse » a déjà une définition dans le code engendré : tout type qui implémente une
interface `…ResponseObject`. Le test charge le paquet avec `go/packages`, énumère ces types, et
refuse un sous-jacent de type `map` ainsi que tout champ anonyme — l'embedding, qui ferait fuir
demain les champs ajoutés au type embarqué.

Deux garde-fous contre le « toujours vrai » : le test **échoue si la population est vide** — un
analyseur qui ne trouve rien est cassé, pas vert — et la mutation se prouve en ajoutant un type
fautif au paquet. La population n'est pas vide aujourd'hui : `Health200JSONResponse` en fait partie.
Le filet est tendu, pas décoratif.

> **Corrigé le 02/08 après revue — les deux lignes ci-dessus décrivent la version d'avant le
> correctif.** Le test livré refuse `map` ou `any` **à n'importe quelle profondeur de champ**, ce que
> « un sous-jacent de type `map` » laissait passer alors que c'est exactement la mutation que la DoD
> exige. Et il **tolère** un champ anonyme dont le type est déclaré par le générateur : un `$ref` vers
> `components/responses/*` engendre précisément cette forme, et une garde qui la refuse se fait
> désactiver le jour où le contrat factorise son DTO d'erreur.
>
> Sa population reste **tous** les types qui implémentent une interface de réponse, engendrés
> compris — c'est d'ailleurs ce qui la fait mordre, `Health200JSONResponse` étant engendré. Une step
> qui « optimiserait » le test en excluant le fichier engendré le rendrait inerte.

### DN-6 — Les types TypeScript sont livrés, le client instancié ne l'est pas

Voir l'amendement du périmètre. Ce qui exerce les types sans rien simuler : un test de **typage** qui
rougit si le schéma bouge, plus la porte de régénération en CI. Le mot « consommés » du périmètre est
antérieur à la jurisprudence de step-003 ; la divergence se corrige dans la fiche, avant le code,
plutôt qu'en la contournant en silence.

### DN-7 — `/health` entre dans la spec §5.1

Mesuré : la surface spécifiée du BFF va de `POST /auth/login` à `/roles` et ne contient **aucun**
endpoint de santé. `/api/health` vient de step-000, écrit à la main, sans ligne de spec derrière lui.
La spec porte elle-même la consigne « toute évolution du contrat doit être répercutée ici » : l'y
inscrire est la règle, pas une faveur. Une entrée d'une ligne, qui dit ce que step-000 disait déjà —
sonde de **vivacité**, hors surface métier, la **disponibilité** arrivant avec les livrables de M9.

> **Corrigé le 02/08 après revue.** Ce DN disait aussi « sans authentification ». Rien ne le porte —
> ni step-000, ni §4.1 — et §4.2 dit au contraire que la console est entièrement derrière un login.
> L'amendement livré dit donc que la question de la protection de la sonde se pose avec
> l'authentification, en M1, plutôt que d'affirmer qu'elle est tranchée.

### DN-8 — `always-prefix-enum-values` plutôt qu'un enum sans nom

Mesuré : un schéma `status: enum[ok]` engendre par défaut une constante exportée nommée **`Ok`** dans
`package bff` — deux lettres, générique, dans le paquet qui portera à terme toutes les routes du
produit. C'est une collision en sursis.

L'option de compatibilité `always-prefix-enum-values: true` la rend `HealthStatusOk` — mesuré. On
garde donc l'enum, qui a une valeur propre : il contraint la **valeur** et pas seulement la forme,
ce qui donne du mordant à DN-9.

### DN-9 — La réponse est validée contre le YAML lui-même, pas contre le type engendré

« La réponse est du type engendré par le contrat, donc elle valide » suppose exactement ce qu'il
faudrait prouver : que le générateur encode fidèlement le schéma, et que la sérialisation émet du
JSON conforme. Une contrainte resserrée dans le YAML — le piège que `CLAUDE.md` nomme — passerait le
typage et échapperait à ce raisonnement.

Le scénario charge donc `api/openapi-bff.yaml` (le fichier du dépôt, pas une copie) et valide la
**réponse HTTP réelle** avec `kin-openapi`, déjà dans l'arbre de dépendances. Cette validation vit
dans le test et non dans le binaire : mesuré, le code engendré ne valide pas les requêtes entrantes,
et le middleware qui le ferait exigerait `embedded-spec: true`, c'est-à-dire une copie du contrat
figée dans le binaire — ce que la règle d'or interdit.

### DN-10 — Les deux dettes de step-003 sont reportées sur leur vrai porteur

step-003 écrit que « l'extension du DTO d'erreur avec `errors[]` attend la route qui la servira » et
que « la première route du BFF vers la passerelle arrive en step-004 ». Or le périmètre de step-004
est `GET /health`, sonde de vivacité qui par définition ne touche pas la passerelle : **ces deux
dettes n'ont pas de porteur ici**.

Laisser un pointeur faux dans une fiche archivée, c'est la divergence contournée en silence que la
règle nomme. Une ligne datée corrige le pointeur — corriger un renvoi n'est pas réécrire l'histoire —
et la dette est inscrite là où la prochaine session la lira.

### DN-11 — `openapi-typescript` reçoit sa propre copie de TypeScript 5

*(Décision prise pendant l'implémentation : le design supposait que le générateur tournerait, et
c'est faux. Le fait n'avait pas été mesuré en phase 1 — la version, la quarantaine et l'audit
l'avaient été, la compatibilité non.)*

Mesuré sur l'arbre installé : `openapi-typescript@7.13.0` construit son AST avec **l'API du
compilateur** TypeScript, qu'il déclare en `peerDependencies: { typescript: "^5.x" }`. Le dépôt est
en **TypeScript 7.0.2**, le portage natif, dont le point d'entrée npm n'expose plus cette API —
`Object.keys(require('typescript'))` rend `['version', 'versionMajorMinor']`, et le générateur meurt
sur `Cannot read properties of undefined (reading 'createKeywordTypeNode')`. Aucune version publiée
ne lève la contrainte.

Le générateur reçoit donc sa **propre** copie de TypeScript 5.9.3, par un hook `readPackage` dans
`web/.pnpmfile.cjs`. Deux voies plus légères ont été essayées et **mesurées inertes** — `overrides`
et `packageExtensions` : une résolution de pair part du paquet importateur et ne consulte ni l'une ni
l'autre. Le répertoire du store le dit, qui restait `openapi-typescript@7.13.0_typescript@7.0.2` et
devient `openapi-typescript@7.13.0` avec le hook.

Ce compilateur ne sert qu'à écrire le fichier de types : `pnpm typecheck` reste `tsc` en 7.0.2, et
rien du produit ne traverse le 5.9.3. L'oubli du fichier est impossible en silence — le lockfile
porte un `pnpmfileChecksum`, et `pnpm install --frozen-lockfile` échoue sur
`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` si le hook disparaît.

### DN-12 — Un 500 servi par le BFF ne laisse aucune trace côté serveur

*(Constat de revue, consigné plutôt que corrigé.)*

Les gestionnaires d'erreur du serveur strict rendent désormais le DTO d'erreur du produit au lieu du
message Go brut — c'était un correctif de revue. Mais **rien n'est journalisé** : `NewRouter` ne
reçoit que les assets, aucun journal n'atteint `internal/bff`, et l'erreur d'origine disparaît avec
la réponse.

Non traité ici parce qu'aucune route ne peut encore échouer : la première qui le pourra est celle qui
appelle la passerelle, en step-060, et c'est elle qui dira quelle forme de journal lui sert. Le
constat est écrit là où il vit, au-dessus du gestionnaire.
