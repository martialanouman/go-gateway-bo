# step-026 — Le DTO de sortie tient sur des routes qui portent enfin des secrets *(invariant a, moitié structurelle)*

> **Jalon :** M1 (§1.11) · **Statut :** FAIT
> **Dépend de :** step-022, step-025 · **Bloque :** step-029, step-066, step-103

## But
Fermer ce que la porte de step-004 laisse passer, maintenant que le BFF manipule des secrets. Jusqu'à
M1 elle gardait une sonde de vivacité : rien qu'elle refusait n'aurait fui quoi que ce soit. À partir
d'ici, un champ de trop est un hachage de mot de passe, un secret TOTP ou une clé de session.

## Périmètre (ce que fait CETTE PR)
- **Fermer le trou nommé** par `internal/bff/api.go` : un `Visit…Response` écrit à la main sérialise
  ce qu'il veut, et la porte structurelle reste verte — mesuré le 02/08/2026, sur un type de réponse
  **sans champ**.
- Une porte qui refuse qu'un **type de domaine** (l'opérateur du store, la session, un
  authentificateur) soit atteignable depuis un type de réponse, à quelque profondeur que ce soit.
- Une porte nommant les champs qu'aucune réponse ne doit porter : `password_hash`,
  `mfa_totp_secret`, secret de session, code de récupération, et l'état de cérémonie
  `webauthn_challenges.ceremony`. *(Correction step-024 : `mfa_webauthn_credentials` a disparu du
  schéma — les passkeys ont leur table, et rien n'y est secret puisque la clé est publique. C'est le
  défi en vol qui ne doit pas fuir, pas la clé.)*
- La règle inscrite là où elle se lit — dans le paquet qui écrit les DTO, pas seulement dans un test.
- **Ajouté au périmètre le 29/08/2026 : le second chemin vers le fil.** `respond.go` déclare
  `writeJSON(w, status, body any)`, la seule surface de sérialisation non typée du paquet, et les huit
  refus qu'écrivent les middlewares partent par là — hors de tout `Visit…Response` engendré, donc hors
  de la conformité au contrat que les scénarios exercent. C'est le même trou que celui de la fiche,
  par l'autre bout, et `enumeration_test.go:224-228` le nommait déjà. Le laisser ouvert aurait fait
  livrer une step qui ferme un chemin sur deux.

## Points d'implémentation clés
- **Ne pas réécrire ce qui existe.** `TestResponseTypesDeclareTheirFields` (step-004) refuse déjà les
  `map` et les `any` à toute profondeur et l'embarquement d'un type que le générateur n'a pas écrit ;
  elle recharge le paquet par le type-checker, donc elle voit les types que les steps futures ajoutent
  **à `internal/bff`** sans qu'on la touche. *Correction du 30/08/2026 : « les types que les steps
  futures ajoutent » était trop large — elle ne charge que ce paquet, et un type déclaré ailleurs dans
  le module lui échappe entièrement. C'est DN-7.* Cette step attaque ce qu'elle ne voit pas, et `api.go` le nomme
  déjà en toutes lettres.
- **Une liste de champs interdits vieillit mal** : elle ne connaît que les secrets d'aujourd'hui. Elle
  se double donc d'une règle de **forme** — aucun type déclaré hors du contrat ne traverse une
  réponse —, faute de quoi le prochain secret ne sera simplement pas dans la liste.
- **Le mode strict retire le `ResponseWriter` du handler, pas du type de réponse** (§1.11, amendement
  du 02/08/2026). C'est la phrase exacte du trou : ce qui reste à garder est la **méthode de
  sérialisation**, pas la signature du handler.
- Ce que cette step **ne** couvre pas, et qui appartient à M5 : le scan transversal — logs, URL,
  exports, cache persisté, attributs de trace. L'invariant (a) a deux moitiés (`plan.md` §17.4) ;
  celle-ci est la structurelle.

## Tests (écrits dans la même PR)
- Un type de réponse dont le `Visit…` écrit un champ absent de sa déclaration est **détecté**.
- Un type de réponse qui embarque ou référence un type du store est détecté.
- Aucun type de réponse n'expose un des champs nommés, à aucune profondeur.
- Les portes restent **mordantes** : chacune est vue tomber sur une sonde jetable, et le constat écrit
  — une porte qu'on n'a pas vue rougir ne prouve rien.

> **La première livraison n'a tenu que les trois premiers points**, et la revue du 30/08/2026 l'a dit :
> les sondes avaient été jouées à la main puis retirées, donc rien dans le dépôt ne distinguait une
> porte mordante d'une porte débranchée. `TestLesPortesMordentSurLeTemoin` tient le quatrième — un
> témoin **par règle**, permanent. Voir DN-8.

## Definition of Done
- [x] `make check` vert — rc=0
- [x] la mutation « ajouter `PasswordHash` au DTO de `/auth/me` » fait rougir — M4
- [x] la mutation « écrire un `Visit…` à la main qui ajoute un champ » fait rougir — M1
- [x] la mutation « embarquer le type de domaine de l'opérateur dans une réponse » fait rougir — M3
- [x] ce qui reste hors de portée est écrit là où il vit, pas seulement dans cette fiche

## Décisions

### DN-1 — La règle est une **localisation**, pas une inspection du corps du `Visit…`
La règle livrée est : tout type qui implémente une interface `…ResponseObject` est **déclaré dans le
fichier engendré**. Elle ne regarde pas ce que la méthode écrit.

L'alternative — « le `Visit…` doit encoder `response` » — est **mesurée fausse le jour de sa
livraison** : cinq `…429JSONResponse` engendrés encodent `response.Body` et non `response`, parce
qu'ils portent aussi un en-tête `Retry-After` ; et trois `…204Response` n'encodent rien du tout. Huit
faux positifs sur trente-deux `Visit…`. Une garde qui refuse du légitime finit retirée.

La localisation ferme trois chemins sur quatre : implémenter une interface engendrée exige d'écrire son
`Visit…` ; poser cette méthode sur un type engendré est une redéclaration que le compilateur refuse ;
et l'hériter par embarquement laisse le type porteur déclaré hors du fichier engendré.

**Le quatrième a été trouvé en revue, après la première rédaction de cette fiche, qui affirmait
« sans contournement ».** Un `MarshalJSON` écrit à la main **sur un type engendré** compile — le
fichier engendré ne déclare pas cette méthode, donc ce n'est pas une redéclaration — et le `Visit…`
l'appelle, puisqu'il fait `json.NewEncoder(&buf).Encode(response)`. Sondé sur `Health200JSONResponse`,
les quatre règles restaient **vertes** ; ce qui rougissait était `TestHealthProbe`, un test de corps
exact, donc par route et non par propriété — précisément ce que cette step existe pour remplacer.

### DN-6 — La cinquième règle : **aucune** méthode écrite hors du fichier engendré
`handWrittenMethod` prend le jeu de méthodes du **pointeur** — le sur-ensemble, qui porte les
récepteurs valeur comme pointeur — et exige que chacune soit déclarée dans le fichier engendré.

La règle nomme « toute méthode » et non « `MarshalJSON` » : une liste laisserait `MarshalText`,
`UnmarshalJSON`, et celles que la bibliothèque standard ajoutera. Les méthodes **promues** d'un type
embarqué engendré sont déclarées dans le même fichier, donc elles passent ; embarquer un type non
engendré est déjà refusé par `assertEmbedsOnlyGeneratedTypes`.

### DN-2 — La liste de champs interdits est courte **délibérément**, et le contrat dit pourquoi
Le contrat déclare aujourd'hui un champ `secret` et un champ `recoveryCodes` : ce sont les affichages
**uniques** qu'exige l'invariant (b) — montrés une fois à la création, jamais réaffichés. Une porte
qui refuserait « tout champ dont le nom contient `secret` » refuserait le comportement correct du
produit.

La liste ne porte donc que des **colonnes nommées** — `password_hash`, `mfa_totp_secret`,
`token_hash`, `code_hash`, `ceremony` — sur le nom Go *et* sur le tag JSON, parce que le nom Go est ce
qu'un relecteur voit et le tag ce qui part sur le fil. Elle vieillit mal par construction : c'est la
règle de **forme** (DN-3) qui attrape les secrets de demain.

### DN-3 — La règle de forme refuse le **paquet**, pas le champ
Rien de ce qu'un type de réponse atteint, à quelque profondeur, ne vient d'un paquet de ce dépôt autre
que `internal/bff`. `time.Time` et les types d'`openapi_types` passent : ce qui est interdit n'est pas
d'être écrit ailleurs, c'est d'être un type de domaine **de ce dépôt**.

C'est la moitié que la porte de step-004 ne pouvait pas tenir, et pas seulement parce qu'elle regarde
autre chose : les handles du store (`Logins`, `Sessions`, `MFA`, `Counter`) n'ont que des champs **non
exportés**, et `session.Manager` y porte la clé HMAC du sceau de cookie. Une réponse qui en porterait
un passerait la porte de forme sans qu'elle ait rien à dire.

### DN-4 — Le second chemin est gardé au **site d'appel**, faute de type qui le dise
`writeJSON` garde son `body any`. Le resserrer à `Error` fermerait la porte au premier refus qui
portera autre chose, et il n'existe aucun type Go qui dise « un DTO engendré » : les **dix** interfaces
`…ResponseObject` sont par opération, et aucune n'est implémentée par `Error`. Ce qui est gardé est
donc le type **statique** de l'argument à chaque site d'appel, résolu par le type-checker.

`types.Unalias` y est indispensable et non décoratif : `errorResponse` **est** `Error`, et sans lui la
porte refuserait les huit sites légitimes le jour de sa livraison.

### DN-5 — Le témoin anti-vide est celui qui existait déjà, et c'est **vérifié**
Les quatre règles vivent dans la boucle de `TestResponseTypesDeclareTheirFields` et partagent son
`require.Positivef(population, …)`. M2 le mesure plutôt que de le supposer : population vidée et
témoin retiré, les quatre règles sont **vertes** — elles passent en n'ayant rien cherché. Témoin
remis, rc=1.

Pour le second chemin, le témoin est neuf : `require.GreaterOrEqual(sites, 8)`, un **plancher** et non
une égalité. Vérifié en le portant à 9 : la porte annonce « 8 site(s) d'appel pour 9 attendus », donc
elle compte réellement les huit.

### DN-7 — La porte ne voyait que `internal/bff`, et c'est le contournement qui rendait la step décorative
`HealthResponseObject` ne mentionne que `http.ResponseWriter`, et le dispatch du wrapper engendré est
une **assertion de type à l'exécution** : n'importe quel paquet peut implémenter l'interface. La porte,
elle, énumérait `packages.Load(".")`.

Sondé le 30/08/2026 : un `internal/leak` rendant un `store.Operator` complet compile, `Health` le sert,
`password_hash` part sur le fil — et les cinq règles rendent **rc=0**.

`TestAucuneMethodeDeSerialisationNEstEcriteAilleurs` charge `./...` et porte sur la **méthode** et non
sur le type : implémenter une de ces interfaces exige d'écrire une méthode de ce nom et de cette
signature, où qu'elle soit. Elle est donc strictement plus forte que la provenance, et attrape du même
coup le troisième contournement — poser un `Visit…` sur un type **engendré qui n'en portait pas**
(`Health`, `Me`, `MfaChallenge`), ce qui compilait et que « une redéclaration que le compilateur
refuse » déclarait impossible.

La signature est vérifiée avec le nom, sans quoi un homonyme sans rapport ferait rougir la porte sans
rien pouvoir servir.

### DN-8 — Un témoin **par règle**, permanent, parce que le premier prouvait la mauvaise borne
La première version n'avait qu'un témoin — le paquet `testdata/fuite` — et une assertion qui demandait
seulement que « quelque chose ait parlé ». Débranchée, la règle de domaine laissait le témoin **vert** :
le type y était attrapé par la règle des méthodes.

Un paquet de `testdata/` est de surcroît lui-même « du domaine » pour le parcours, donc il rougit dès
la racine et n'éprouve jamais la descente. Le témoin de la règle de domaine s'exerce donc sur
`store.Operator` **tel que `internal/bff` l'importe** — le même objet du type-checker que celui qu'un
DTO atteindrait —, et celui de la règle des colonnes sur un struct fabriqué.

Chacune des trois est vue rougir sur son propre témoin, débranchée une par une.

### DN-9 — Un seul parcours, parce que les deux jumeaux avaient **déjà** divergé
Le premier jet portait deux marcheurs présentés comme suivant « la même règle de descente ». Ils n'en
suivaient pas la même : l'un traitait une map comme fatale et l'autre y descendait, l'un connaissait
les interfaces et l'autre les ignorait en silence — en une seule rédaction, dans la porte même qui
existe pour interdire cela.

Fusionnés. Et la branche des interfaces est resserrée du même coup : `error` a une méthode, et
`encoding/json` sérialise les champs exportés de sa valeur **dynamique** — un `*pgconn.PgError` y
mettrait la requête et le nom de la contrainte. `streamedBodies` nomme ce qui est admis (`io.Reader`,
`io.ReadCloser`) au lieu d'admettre toute interface non vide. `json.RawMessage` est refusée nommément :
son contenu n'est déclaré nulle part, et une règle de forme y verrait un `[]byte` parfaitement borné.

### DN-10 — `writeJSON` ne doit jamais être passé de main en main
`var emit = writeJSON` puis `emit(w, 403, session)` n'est pas un appel dont le `Fun` résout sur la
fonction : le site n'entre dans aucune population, les huit sites directs restent en place, le plancher
est satisfait, et la porte est **verte** pendant qu'un type de domaine part sur le fil.
`assertNeverPassedAround` exige que le nom n'apparaisse qu'en position d'appel.

**La première sonde de ce cas était mal construite** : elle remplaçait un site direct au lieu d'en
ajouter un, donc c'est le plancher qui rougissait — rc=1 pour la mauvaise borne. Refaite en ajoutant.

## Mutations, une par une, `-count=1`, lues au code de sortie

| Mutation | Attendu | Mesuré |
|---|---|---|
| M1 — un type de réponse écrit à la main dans `api.go`, avec son `Visit…`, qui sérialise un secret | rouge | rc=1 · « `Health200Leak` implémente une interface `ResponseObject` sans venir du contrat » |
| M2 — population vidée, témoin **en place** | rouge | rc=1 · « aucun type n'implémente une interface `ResponseObject` » |
| M2 bis — population vidée, témoin **retiré** | **vert** | rc=0 · les quatre règles passent en n'ayant rien cherché |
| M3 — champ `store.Operator` dans `CurrentOperator` | rouge | rc=1 · « `Me200JSONResponse.Operator.Stored` est un `…/internal/store.Operator`, un type de domaine de ce dépôt » |
| M4 — champ `PasswordHash string` dans `CurrentOperator` | rouge | rc=1 · « `Me200JSONResponse.Operator.PasswordHash` porte `operators.password_hash` » |
| M6 — M4 rejouée, liste de champs **vidée** | **vert** | rc=0 · une `string` n'est pas un type de domaine : les deux règles ne se couvrent pas |
| M5 — `writeJSON(w, 403, resolved)` dans `guard.go` | rouge | rc=1 · « `guard.go:137:40` sérialise un `…/internal/store.Session` » |
| **M7 — `MarshalJSON` écrit à la main sur `Health200JSONResponse`** | rouge | rc=1 · « porte une méthode écrite à la main ». **Avant DN-6, rc=0.** |
| **M8 — un type de réponse dans `internal/leak`, servi par `Health`** | rouge | rc=1 · « internal/leak.VisitHealthResponse est une méthode … écrite à la main ». **Avant DN-7, rc=0** — c'est le contournement qui rendait la step décorative |
| **M9 — `MarshalJSON` à la main sur `Error`** | rouge | rc=1 · « porte une méthode écrite à la main : MarshalJSON ». **Avant DN-7, rc=0** — `Error` n'implémente aucune interface, donc il n'entrait dans aucune population |
| **M10 — `VisitHealthResponse` posé sur `Health`, type engendré nu** | rouge | rc=1 · **avant DN-7, rc=0**, alors que le commentaire disait le compilateur garant |
| **M11 — `emit := writeJSON` puis `emit(w, 403, resolved)`, en *plus* des huit sites** | rouge | rc=1 · « nomme writeJSON hors d'une position d'appel » |
| W1/W2/W3 — chacune des trois règles **débranchée** | rouge sur son témoin | rc=1 · « elle est débranchée », une par une |

M4 et M6 forment la paire qui compte : elles montrent que la liste de champs est bien le **juge** du
cas qu'elle prétend garder, et que la règle de forme ne la couvre pas — une `string` mal nommée n'est
pas un type de domaine.

**M7 n'était pas au plan** : elle vient de la revue, et elle a trouvé un chemin que la première
rédaction déclarait fermé. Elle est la preuve que la cinquième règle était nécessaire, et la seule
mutation de cette step qui ait rougi *après* avoir été verte.

Une huitième a été jouée par accident et mérite d'être écrite : le premier essai de M5 n'a pas trouvé
son motif et **n'a rien changé**. Le `rc=0` disait « je n'ai rien modifié », pas « la garde tient ».
C'est le mode d'échec que ce dépôt a déjà nommé, et il s'est présenté ici.

## Ce qui n'est pas testable, écrit là où il vit
`respond.go` porte désormais la raison pour laquelle `body` reste un `any`, et le nom de la porte qui
tient ce que la signature ne peut pas. `api.go`, `me.go` (deux fois) et `enumeration_test.go`
affirmaient chacun quelque chose que cette step rend faux ; les quatre sont corrigés, au **passé** là
où la mesure d'origine mérite d'être conservée.

## Hors périmètre
Le scan transversal de l'invariant (a) — logs, URL, export, cache, trace → step-103. Le corps de
message et sa garde → step-103. Les secrets d'identifiants de bind → step-066 (invariant b).
