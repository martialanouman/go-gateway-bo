# step-003 — Contrat Admin : client Go généré, OAuth2 + mTLS, mock Prism

> **Jalon :** M0 (§3.2, §5.1) · **Statut :** LIVRÉE (02/08/2026)
> **Dépend de :** step-000 · **Bloque :** toute step appelant la passerelle

## But
Brancher le BFF sur `@martialanouman/gateway-api-contracts` et en tirer **un seul** client Go typé vers
l'API Admin, plus un mock local — pour que les écrans se développent sans la passerelle, ce qui est la
condition de faisabilité du projet (`plan.md` §16).

## Périmètre (ce que fait CETTE PR)
- `oapi-codegen` sur `openapi-admin.yaml` du package npm → client Go généré sous
  `internal/gateway/`. Le YAML **n'est jamais copié** dans le dépôt : la cible de génération le lit
  depuis `node_modules`, et un test vérifie qu'aucune copie ne traîne.
- Authentification sortante : **OAuth2 client_credentials** (jeton machine mis en cache, renouvelé
  avant expiration, renouvellement non concurrent) + **mTLS**. Base URL, identifiants et CA par
  configuration (§1.8).
- Traduction de l'enveloppe plate `{ code, message, errors[] }` vers une erreur typée du BFF (§1.4),
  réexposée dans la **même forme** au client — *la réexposition elle-même attend step-004, faute de
  route à servir : voir DN-12*. Le contrat 2.x **déclare les réponses d'erreur par opération** — 401,
  403, 404, 409, 422 — plus `ServiceUnavailable` : le mapping les couvre toutes, et **distingue
  `ServiceUnavailable` d'un module désactivé** (§1.4), qui n'est pas une erreur.
- Timeouts courts, retry **seulement** sur les méthodes idempotentes.
- `make mock` : Prism sur le même YAML ; bascule réel/mock par configuration.

## Points d'implémentation clés
- **Le jeton machine porte `content:read` en permanence.** La restriction par opérateur est
  **entièrement** à la charge du BFF — c'est l'origine de l'invariant (c) et du test d'énumération de
  step-025. Le dire dans le code, une fois, à l'endroit qui compte.
- **Ne jamais faire pression sur l'API Admin** (invariant e) : le tableau de bord est un observateur.
  Un retry agressif sur un incident transformerait une panne de visualisation en amplification de
  charge sur le plan de données.
- Le renouvellement de jeton est un point de concurrence : deux requêtes simultanées sur un jeton
  expiré ne doivent en déclencher qu'un seul.
- Le client généré est du code produit par un outil : il n'est pas relu ligne à ligne, mais la
  **cible de génération est commitée** et la CI vérifie que le fichier est à jour.

## Tests (écrits dans la même PR)
- **Scénario** `passerelle.feature` : *Étant donné* le mock Prism, *Quand* le BFF liste les clients,
  *Alors* il obtient une réponse typée ; *Quand* la passerelle répond une erreur `{ code, message }`,
  *Alors* le BFF rend son erreur typée équivalente.
- Unitaire : le renouvellement se déclenche avant expiration et **une seule requête part** quand deux
  appels concurrents trouvent le jeton expiré.
- Unitaire : aucun retry sur `POST` non idempotent.
- Un test échoue si un YAML de contrat est copié dans le dépôt.

## Definition of Done
- [x] **`make check` vert** (02/08, onze portes) · **`make mock` sert les 133 opérations** —
      `TestTheMockServesEveryOperationTheContractDeclares` confronte deux sources (les routes que
      Prism annonce au démarrage, les `operationId:` que le contrat déclare : **133 = 133**) puis
      **interroge** chacune : aucun refus de routage. *Ce que la sonde ne prouve pas est écrit dans le
      test : elle établit le routage, pas la validité de chaque réponse. Et elle lance le binaire de
      Prism sur un port libre, pas la cible `make mock` elle-même — même contrat, même binaire.*
- [x] **aucun secret dans le dépôt ; identifiants et CA par configuration** —
      `TestVariablesListsEveryNameLoadReads`, `TestDotenvExampleListsExactlyWhatLoadReads`,
      `TestLoadGateway/nomme_chaque_variable_que_le_mode_real_exige_et_qui_manque`,
      `TestLoadGateway/ne_recopie_jamais_le_secret_client_dans_le_message`, et le scénario godog
      « la passerelle réelle sans identifiants empêche le démarrage », qui exerce le **binaire
      compilé**. *La première moitié — « aucun secret dans le dépôt » — n'a pas de porte : rien ne
      cherche un secret dans l'arbre. Elle est tenue par `.gitignore` et par des valeurs vides dans
      `.env.example`, ce qui est un état, pas une garde. Dit plutôt que coché en silence.*
- [x] **le code généré est à jour, vérifié en CI** — `make check-generated`, qui **supprime avant de
      régénérer** et lit son verdict dans `git status` ; câblée au job « Build client et déployable ».
      Quatre mutations la tiennent, dont celle où `git` échoue.
- [x] **la mutation « rendre le renouvellement concurrent » fait rougir le test de jeton** —
      `TestAdminClientFetchesASingleTokenWhenConcurrentCallsFindItExpired` et
      `TestAdminClientRenewsTheMachineTokenBeforeItExpires` : le compteur du faux endpoint passe de
      2 à **9** sous concurrence, et de 1 à **3** hors concurrence.

### Les quatre critères transverses de `CLAUDE.md`

1. **Le chemin qu'un humain traverse est traversé pour de bon.** Cette step ne livre pas d'écran ; le
   chemin humain qu'elle livre est celui de l'exploitant qui démarre le binaire mal configuré, et il
   est exercé sur le **binaire compilé**, lancé par le harnais avec un environnement réel — rien de
   simulé. Côté sortant, le mock Prism est la frontière autorisée. **À dire dans la PR** :
   `cmd/dashboard` n'appelle jamais `NewAdminClient` ; la couture configuration → client n'a pas
   encore de chemin produit, et c'est DN-12.
2. **Toute affirmation sur le monde extérieur confrontée à sa source.** C'est ce qui a coûté le plus
   cher ici : le bump du contrat est arrivé au huitième commit et n'a fait relire aucun texte qui
   parlait du contrat. Cinq DN, quatre commentaires de code et six passages de documentation
   affirmaient du faux ; tous ont été remesurés et corrigés, chacun citant sa mesure.
3. **Mutation partout où le retrait laisserait la suite verte.** Le tableau ci-dessus, en deux
   parties, avec trois lignes « aucune porte ne rougit » vérifiées et deux mutations rejetées comme
   invalides.
4. **Ce qui n'est pas testable est écrit là où il vit.** DN-14 recense quatre constats latents ; ils
   sont dans le code, et non seulement dans cette fiche — parce qu'elle part dans `steps/done/` et
   que la step qui appellera `add-credits` ne la lira pas.

## Hors périmètre
Les trois flux `stream-*` → step-043. Les permissions par opérateur → step-025. Le contrat du BFF
lui-même → step-004.

## Tableau des mutations

Tenu au fil de l'eau. Une ligne « aucune porte ne rougit » est un constat de la DoD (critère 4), pas
un aveu — à condition d'avoir été **vérifiée** et d'être écrite au-dessus de la ligne concernée.

| Mutation appliquée (le défaut réel qu'elle rejoue) | Ce qui tombe |
|---|---|
| **Renouvellement de jeton rendu concurrent** — assemblage à la main avec une source **non** réutilisée, l'oubli du `ReuseTokenSource` (*mutation nommée par la DoD*) | compteur du faux endpoint de jeton : 1 → **3**, et 2 → **9** sous concurrence |
| **503 traité comme un module désactivé** (`Code: "module_disabled"`) (*mutation nommée par DN-8*) | `TestServiceUnavailableStaysAnError` |
| **503 avalé** — la traduction rend `nil` | idem |
| Garde sur la méthode HTTP retirée (client *moins* prudent) | `ne_rejoue_jamais_un_POST` : 1 → 2 |
| 429 ajouté aux statuts rejouables | `ne_rejoue_pas_sur_429` : 1 → 2 |
| 503 ajouté aux statuts rejouables | `ne_rejoue_pas_sur_503` : 1 → 2 |
| Une seconde tentative supplémentaire | 502 et 504 : 2 → 3 |
| `Timeout` retiré du client du contexte | « l'appel n'a jamais rendu la main : le Timeout ne borne pas l'obtention du jeton » |
| `Certificates` retiré du `tls.Config` | `PresentsItsCertificateOnBothOutboundCalls` |
| `content:read` retiré des scopes demandés | test des scopes |
| Erreurs de chargement du matériel mTLS avalées | `An error is expected but got nil.` |
| Corps d'erreur non conforme avalé en silence | `TestErrorFromNamesAnUnreadableBody` |
| Détail champ par champ perdu | `TestErrorFromKeepsTheFlatEnvelope` |
| `Error()` recopie le message amont (fuite potentielle, invariant a) | les six rendus de `TestErrorRendersNoUpstreamFreeText` |
| Appel de `requireRealGatewayMaterial` retiré | le test de config **et** le scénario godog : « il a démarré avec une configuration incomplète » |
| Mode absent replié sur `mock` (le défaut permissif que DN-9 écarte) | `un_mode_absent_vaut_real` |
| Clémence du mode `mock` retirée (garde *trop large*) | 7 tests, dont `n'exige_que_l'adresse_du_mock_en_mode_mock` |
| Une validation du secret qui cite sa valeur | `ne_recopie_jamais_le_secret_client…` |
| Copie du contrat déposée dans le dépôt, puis **renommée**, puis ré-extensionnée | la porte anti-copie, sur **toutes** les signatures de l'échantillon — le nom n'y est pour rien. *(L'échantillon comptait 8 et 5 signatures au moment de cette mutation ; il en compte 28 et 7 depuis le correctif de revue trois lignes plus bas — la valeur d'alors est laissée, la mutation n'a pas été rejouée sur l'échantillon élargi.)* |
| Contrat du BFF légitime + overlay déposés | la porte **passe** — le légitime n'est pas refusé |
| Génération cassée (overlay retiré, configuration renommée, outil retiré de `tool`) | `check-generated`, qui régénère au lieu de comparer |
| Une action de l'overlay ne cible plus rien | `does nothing` — le mode strict |
| Client engendré retiré du suivi git | `check-generated` (`git status`, là où `git diff HEAD` reste muet) |
| **Binaire Prism renommé** | `TestScenarios` **et** la sonde échouent — ni vert, ni skip |
| Base URL affublée du préfixe `/v1` que Prism ne sert pas | scénario de liste : 404 |
| `Bearer` retiré | scénario de liste en **401** — la preuve qu'il traverse l'authentification sortante |
| Sonde pointée sur une route inexistante | 118 routes sur 133 en refus de routage |
| `.feature` renommé | `0 scénario(s) exécuté(s) pour un plancher de 2` — **trou trouvé ainsi**, la suite passait sans rien exécuter |
| Dédoublonnage de `config.Variables()` retiré | la porte `.env.example` — le commentaire qui le disait sans effet a été corrigé |
| Drainage de la réponse abandonnée au rejeu (`discard`) retiré | **aucune porte ne rougit** — ce qu'il empêche s'observe sous charge ; écrit au-dessus de la fonction |
| Branche `HEAD` du filtre de rejeu retirée | **aucune porte ne rougit** — le contrat ne déclare aucune opération HEAD ; écrit au-dessus de la fonction |
| Garde de faute de frappe du harnais godog retirée | **aucune porte ne rougit** — elle protège l'auteur d'un futur scénario, pas un comportement du produit. Seule des trois lignes de ce genre à n'avoir pas son constat écrit au-dessus d'elle : il est ici, faute d'un endroit où il servirait mieux |

### Mutations des correctifs de revue

Un correctif est du code comme un autre : il repasse par le rouge et par la mutation.

| Mutation appliquée | Ce qui tombe |
|---|---|
| Garde du schéma de l'URL de base retirée (le bloquant : passerelle réelle jointe en clair) | `refuse_une_URL_de_base_en_clair_en_mode_real` |
| Même garde rendue **plus stricte** — insensible au mode | 9 tests, dont `n'exige_que_l'adresse_du_mock_en_mode_mock` : elle ne déborde pas sur le mock |
| Même garde rendue sensible à la casse | `accepte_une_URL_de_base_en_https_quelle_qu'en_soit_la_casse` |
| `return value` → `return parsed.String()` dans la lecture d'URL | les deux tests de rendu — là où cette mutation laissait **toute la suite verte** avant le correctif |
| `Error()` remis sur récepteur pointeur | les 4 sous-tests « la valeur » (`%v`, `%s`, `%+v`, slog texte) |
| `MarshalJSON` retiré | `json.Marshal`, pointeur **et** valeur |
| `GoString` retiré | `%#v`, pointeur **et** valeur |
| Garde de méthode déplacée **après** la branche réseau du rejeu | `NeverReplaysAMutationWhoseConnectionDropped` : 2 requêtes au lieu d'1 |
| Refus du mode inconnu retiré (retour au `!= real`) | les 4 modes inconnus |
| Refus laissant passer la seule valeur zéro | le cas `""` |
| `Certificates` vidé du `tls.Config` sortant | `PresentsItsCertificateOnBothOutboundCalls`, **désormais sur l'assertion** de certificat pair et non sur la poignée de main |
| Échantillon de signatures anti-copie ramené à 8 | `laisse passer une fiche de step` |
| Seuil anti-copie relevé à « toutes les signatures » | `copie dont le contrat a bougé en amont` |
| Capture du code de retour de `git` retirée de `check-generated` | la porte redevient **verte** sur un client divergent quand `git` échoue — le défaut revient |

| `encryptedEndpoints` comparant `scheme != "https"`, sensible à la casse (garde *trop stricte*) | `RefusesAPlaintextGatewayInRealMode/accepte_un_schéma_en_majuscules` |
| La même garde ne sortant plus tôt hors du mode `real` (garde *trop large*) | 5 tests du mode mock **et** les deux scénarios godog |
| Seul `BaseURL` gardé, `TokenURL` laissé libre | `…/refuse_un_tokenUrl_joint_en_clair` — c'est par là que passe le secret client |
| `encryptedEndpoints` jamais appelée (le défaut d'origine, côté client) | `…/refuse_une_API_jointe_en_clair` et `…/refuse_un_tokenUrl_joint_en_clair` |
| `APIError.As` retirée (le défaut d'origine) | `TestErrorAsCatchesBothSpellings/la_cible_valeur` et `…/sous_une_erreur_enveloppée` |
| `APIError.As` rendant `true` quel que soit le type de la cible | `…/ne_détourne_pas_la_cible_d'un_autre_type` |
| `GoString` reprenant les seuls noms de champs sous forme de chaînes | `TestGoStringStaysGoSyntax` |
| `redactedFields` recopiant le `FieldError` entier, message amont compris | `TestGoStringStaysGoSyntax`, `TestErrorRendersNoUpstreamFreeText/%#v` et `/la_valeur,_%#v` |
| Branche `req.Context().Done()` de l'attente avant rejeu retirée | `TestAdminClientStopsWaitingWhenTheCallerGivesUp` |
| Marque d'identité retirée du verdict anti-copie (le défaut d'origine) | `laisse_passer_un_contrat_du_BFF_à_chemins_relatifs` |
| Marque d'identité rendant toujours `true` | idem |
| Marque d'identité rendant toujours `false` | `reconnaît_une_copie_du_contrat_public/title` et `/url` |
| Identité exigée en entier au lieu d'une marque (garde *trop stricte*) | `reconnaît_une_copie_du_contrat_public/title` et `/url` |
| Moitié chemin de la signature anti-copie retirée | **aucune porte ne rougit** — annotation existante, re-vérifiée le 02/08 |

Deux de ces mutations ont d'abord **survécu** — la cible d'un autre type, et l'identité exigée en
entier. Les deux tests ont été renforcés, puis les mutations rejouées : c'est le tour de plus qui
sépare une garde d'une garde prouvée.

Une mutation de plus a été **rejetée** en cours de route : retirer `MarshalJSON` ne fait pas rougir
le rendu `slog` JSON, qui est couvert **deux fois** (le marshaler s'il existe, `Error()` sinon). Le
commentaire qui allait l'affirmer a été corrigé avant d'être écrit.

Deux mutations ont été **rejetées comme invalides** plutôt que comptées : `ReuseTokenSourceWithExpiry(…, 0)`, où `0` signifie « prends le défaut » et ne reproduit donc aucun défaut ; et la suppression du bloc de succès du décodeur d'erreur, qui casse la compilation au lieu de rejouer une faute. Toutes deux ont été refaites sous une forme qui reproduit l'erreur qu'on commet vraiment.

## Design arrêté (2026-08-01)

Les faits chiffrés ci-dessous ont été **mesurés** le 01/08/2026, pas déduits ; chaque décision cite
la mesure qui la fonde. Les arbitrages non tranchés par la spec ont été soumis au modèle Fable.

### DN-1 — Le contrat passe de 1.2.0 à 2.5.0, et l'écart avec 4.0.0 est une dette écrite

Le dépôt consommait **1.2.0**, le plan (§1.2) prescrit **2.5.0**, et la dernière version publiée est
**4.0.0** (publiée le 01/08 à 17:46 UTC). 4.0.0 est **inatteignable aujourd'hui** : `pnpm-workspace.yaml`
impose `minimumReleaseAge: 1440` en mode strict, et l'installation est refusée verbatim par
`ERR_PNPM_NO_MATURE_MATCHING_VERSION` tant qu'une version a moins de 24 h. Impossible même d'en
produire un lockfile.

2.5.0 est retenue plutôt que 2.4.0 (mûre plus tôt) parce que c'est la version que le plan **écrit
déjà** : l'adopter ne demande aucune correction de plan, tandis que toute autre version en
exigerait une avant la première ligne de code. Le diff 2.4.0→2.5.0 ne fait d'ailleurs que 8 lignes,
toutes des déclarations de réponses d'erreur sur deux opérations RGPD.

`ServiceUnavailable` **n'existe ni en 1.2.0 ni en 2.0.0** — il apparaît en 2.3.0. Rester en 1.2.0
rendait donc le périmètre écrit de cette step ininstanciable, ce qui exclut le statu quo.

Le diff 1.2.0→2.5.0 fait 82 lignes, relues : scopes déclarés par opération, `additionalProperties:
false` sur les corps de requête, `idempotency_key` obligatoire sur deux opérations de crédits,
`direction` restreinte à `enum: [mt]`, plafond `maximum` sur `credits`, réponses 401/403/404/409/422
déclarées par opération, et le composant `ServiceUnavailable`. Aucune n'appartient au périmètre M0,
qui porte sur les clients.

Le diff 2.5.0→4.0.0 ne touche que CDR, export, `search-messages` et le scope `msisdn:reveal` — hors
M0. **Dette consignée** : le bump vers 4.0.0 est du travail à part entière (§1.12), à traiter dans sa
propre step, jamais au milieu de celle-ci.

### DN-2 — Les deux collisions de noms Go se lèvent par un overlay OpenAPI local, pas par une copie

oapi-codegen v2.8.0 parse ce contrat **OpenAPI 3.1** sans erreur — ses 181 `type: [T, "null"]`
passent. Il échoue sur exactement **deux** collisions de noms Go, trouvées par itération.

> **Correction du 01/08, mesurée pendant l'implémentation.** Cette décision affirmait d'abord que les
> deux collisions avaient la même cause — un enum inline. C'est vrai de la première seulement :
> `Connector.status` est un enum inline dont oapi-codegen tire `ConnectorStatus`, nom que porte déjà
> le schéma de santé runtime. La seconde est d'une autre nature : `SenderId` est déclaré **deux fois
> en composants**, une fois sous `components.parameters` (un UUID de chemin) et une fois sous
> `components.schemas` (la ressource). C'est le **paramètre** que l'overlay renomme, le schéma gardant
> son nom, parce que tout le versant sender ids référence ce dernier.
>
> La conclusion ne change pas — l'overlay cible des composants dans les deux cas — mais la raison
> écrite était fausse, et une raison fausse se transmet à la prochaine session comme une vérité.
>
> **Seconde correction, 02/08, après revue.** Les numéros de ligne que cette correction citait
> (1517 et 1713) étaient ceux de **1.2.0**, relevés avant le bump. Sur le 2.5.0 réellement consommé :
> `grep -n "^    SenderId:"` rend **1586** et **1785**, et les `type: [T, "null"]` sont **181**, non
> 184. Le défaut est le même que celui que la première correction dénonçait, à un niveau de plus : une
> mesure juste au moment où on l'écrit devient fausse quand ce qu'elle mesure bouge, et le bump du
> contrat est arrivé au huitième commit sans faire relire un seul texte qui parlait du contrat.

La règle du dépôt veut qu'un **manque au contrat** se corrige par une PR amont. Ce n'en est pas un :
la collision est propre au générateur **Go** et n'existe pas côté TypeScript, que le même contrat
sert. Un overlay OpenAPI 1.0.0 (`output-options.overlay.path`) **patche sans copier** — c'est un
fichier de deux actions qui référence le contrat au lieu de le dupliquer, donc la règle d'or « le
YAML n'est jamais copié » est tenue.

Mesuré, et c'est ce qui rend l'overlay acceptable : son **mode strict échoue bruyamment** quand une
action ne s'applique à rien (message verbatim `does nothing`). L'overlay ne peut donc pas pourrir en
silence le jour où l'amont corrigera — il se périme de lui-même, en rouge.

Mesuré aussi : `x-go-name` posé sur la **propriété inline** ne renomme rien ; seul le **composant**
répond. Les deux actions ciblent donc les composants.

Une PR amont posant `x-go-name` (inoffensive pour TypeScript) reste souhaitable et se dépose
**après** cette step : en faire une dépendance bloquerait la step sur un autre dépôt.

### DN-3 — Les 133 opérations sont générées, aucune n'est exclue

oapi-codegen sait filtrer par `exclude-operation-ids`, ce qui permettrait d'écarter les trois
`stream-*` déclarées hors périmètre. Écarté : ce serait une liste à maintenir dans la configuration
de génération, qui divergerait silencieusement du contrat au fil des bumps — exactement l'écart
contrat/client que le dépôt combat. Les trois méthodes générées sont du code mort inoffensif que
step-043 remplacera ; le contrat reste la source de vérité, et le client le reflète intégralement.

### DN-4 — Le jeton machine s'appuie sur `x/oauth2`, et la mutation porte sur notre assemblage

`golang.org/x/oauth2` v0.36.0, **source lue** : `clientcredentials.Config.TokenSource(ctx)` rend
`oauth2.ReuseTokenSource(nil, source)`, et `reuseTokenSource.Token()` prend un `sync.Mutex` **sur
tout le corps, appel réseau compris** — deux appels concurrents trouvant le jeton expiré ne
déclenchent donc qu'**une seule** requête. `defaultExpiryDelta = 10 * time.Second` donne le
renouvellement anticipé, réglable par `ReuseTokenSourceWithExpiry`.

Réécrire ce cache pour avoir un mécanisme « à nous » à muter reviendrait à réimplémenter une
primitive de sécurité pour le confort d'un test. La mutation qu'exige la DoD reste possible et
**reproduit le défaut réel** : remplacer notre assemblage par une `TokenSource` non réutilisée —
l'oubli du `ReuseTokenSource`, qui est l'erreur qu'on commet vraiment. Elle vit dans notre code, et
le test l'observe à la frontière réseau (un faux endpoint de jeton qui **compte** les requêtes
reçues), pas sur un interne injecté.

### DN-5 — Le mTLS entre par le contexte, ce qui le fait couvrir aussi l'obtention du jeton

**Source lue** : `oauth2.NewClient(ctx, src)` prend comme transport de base celui du `*http.Client`
placé dans le contexte sous la clé `oauth2.HTTPClient`, et `clientcredentials` emprunte le même
chemin pour appeler la `tokenUrl`. Un unique `*http.Client` porteur du `tls.Config` (certificat
client + CA) injecté par le contexte couvre donc **les deux** appels sortants.

L'alternative — deux clients configurés séparément — laisse la porte ouverte à un jeton obtenu hors
mTLS, c'est-à-dire à une authentification sortante à moitié protégée que rien ne signalerait.

### DN-6 — Le retry ne rejoue que les lectures, une fois, et jamais quand la passerelle demande de reculer

L'invariant (e) fait du tableau de bord un **observateur** : un observateur qui martèle une
passerelle dégradée devient un amplificateur d'incident.

- Rejeu sur **GET et HEAD uniquement** — une tentative supplémentaire, jamais plus, avec un délai
  bref et du jitter.
- **Jamais** sur POST, PATCH ni DELETE. Même pour les verbes idempotents au sens de la RFC : une
  mutation est déclenchée par un opérateur présent à l'écran, et un rejeu automatique masque les
  conflits. Le cas réseau ambigu (la requête a peut-être été appliquée) est couvert par là même.
- **Jamais sur 429** : c'est l'API qui dit explicitement de reculer ; rejouer est une pression
  directe.
- **Jamais sur 503** : la description du contrat dit « réessayer *quand elle se rétablit* », pas
  immédiatement. Le rétablissement se constate par l'opérateur via l'état d'erreur et son bouton
  Réessayer — pas par une boucle automatique.
- Rejeu, en revanche, sur une **erreur de transport** — connexion refusée ou coupée avant toute
  réponse, l'accident d'une instance retirée du load balancer pendant un déploiement roulant. Cette
  branche manquait au texte d'origine de ce DN alors que le code la portait.

> **Correction du 02/08, après revue.** Ce DN affirmait que le cas réseau ambigu — la mutation dont la
> connexion tombe avant la réponse, et qui a peut-être été appliquée — était « couvert par là même ».
> Il ne l'était par **aucun test** : déplacer la garde de méthode *après* la branche réseau, qui est
> le défaut qu'on commet vraiment (« une connexion tombée, ça se rejoue »), laissait toute la suite
> verte, alors qu'un `POST` de suspension partait deux fois. Le comportement du produit était juste,
> la preuve manquait — les deux tests existants n'exerçaient que les croisements *mutation × 502* et
> *lecture × connexion tombée*, jamais celui qui compte.

### DN-7 — Un seul décodeur d'erreur, sur le couple (statut, corps), et non par opération

**Mesuré sur le code généré** : chaque opération ne matérialise un champ `JSON4xx` que pour les
statuts qu'elle déclare ; un statut non déclaré laisse tous les champs à `nil` et ne rend que `Body`
et `HTTPResponse`. S'appuyer sur les champs typés demanderait 133 mappings et laisserait sans
traitement tout statut non déclaré.

**Mesuré aussi** : `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `ValidationError` et
`ServiceUnavailable` sont tous des **alias du même type `Error`**. Un décodeur unique suffit donc,
qui lit le statut et le corps brut.

Un corps qui n'est **pas** l'enveloppe attendue est un cas réel et non théorique : mesuré, Prism
répond aux routes inconnues une erreur RFC 7807 (`type`/`title`/`status`/`detail`), et un proxy
intermédiaire répondrait du HTML. Le décodeur rend alors une erreur typée portant un code générique
plutôt que d'inventer un `code` ou de propager du vide.

> **Précision du 02/08, après revue.** L'argument ci-dessus a d'abord été écrit et illustré contre le
> contrat **1.2.0**, qui ne déclarait aucun 503. Sur le **2.5.0** consommé, `ServiceUnavailable`
> existe et **3 opérations sur 133** le déclarent (contenu et RGPD) — le généré porte donc trois
> champs `JSON503 *ServiceUnavailable`. L'argument tient d'autant mieux : les 130 autres opérations
> n'en déclarent pas, et c'est précisément ce que seul un décodeur sur (statut, corps) rattrape.
> Seul l'exemple choisi pour l'illustrer était mort.

**Invariant (a), corrigé après revue.** `Error()` était déclaré sur récepteur **pointeur**, si bien
que la *valeur* `APIError` n'implémentait ni `error` ni `fmt.Stringer` : `slog` la sérialisait par
réflexion, `Message` compris — le texte écrit par la passerelle, dont rien ne garantit qu'il ne
recopie pas un corps de SMS. Un `slog.Error("…", "err", *apiErr)`, forme qu'aucune règle n'interdit
puisque `errors.As` rend un pointeur qu'on déréférence machinalement, suffisait à le publier. Le
récepteur est désormais une valeur, et `MarshalJSON` et `GoString` ferment les deux échappatoires que
le commentaire d'origine se contentait de **nommer**.

### DN-8 — `ServiceUnavailable` est une erreur ; « module désactivé » n'a aucun signal au contrat

**Constat mesuré, à contre-courant de ce que le périmètre laissait attendre** — refait sur le 2.5.0
consommé après le bump, et non seulement sur le 1.2.0 de départ : le contrat n'exprime **nulle part**
un « module désactivé » — ni 501, ni en-tête, ni code d'erreur dédié. Les
seuls signaux voisins sont des booléens **par ressource** (`billing_enabled` sur un client, etc.),
qui voyagent dans des réponses 200.

Inventer une convention côté BFF fabriquerait un signal que la passerelle n'émet pas. La step tient
donc l'exigence par la négative, et c'est testable : **503 n'est jamais interprété comme un module
désactivé**. En M0, « module désactivé » n'arrive pas par le chemin d'erreur du tout — c'est un état
de *données*, tandis que 503 est une erreur avec Réessayer (§1.4). La question d'un signal plus riche
appartient à step-160, qui saura ce que « module » veut dire.

### DN-9 — La bascule réel/mock est explicite, et l'absence de configuration tombe du côté strict

`DASHBOARD_GATEWAY_MODE` vaut `real` ou `mock`, et **son absence vaut `real`**. En `real`, l'URL de
base, les identifiants OAuth2 et le matériel mTLS sont **tous obligatoires** : une production qui les
oublie ne démarre pas, et le message nomme chaque manquant (§1.8). En `mock`, seule l'URL est
utilisée.

La polarité est le cœur de la décision : une production accidentellement en `mock` reste possible,
mais l'écart est alors **explicite, greppable dans l'environnement** — alors qu'un défaut permissif
serait invisible.

Toutes les variables restent **lues inconditionnellement** dans le littéral `Config`, contrainte que
`config.Variables()` impose déjà (une lecture conditionnelle deviendrait invisible et `.env.example`
pourrait l'omettre sans rougir) ; c'est la **validation** qui dépend du mode, après chargement.

Conséquence assumée : le job CI « Build client et déployable », qui ne fournit que `DASHBOARD_ADDR`,
reçoit `DASHBOARD_GATEWAY_MODE=mock`.

### DN-10 — Les scénarios lancent Prism eux-mêmes, et le job « Tests Go » reçoit la seconde toolchain

Le `.feature` vit à côté du package qu'il décrit, donc dans `internal/gateway`, et tourne contre le
**mock Prism** — frontière du système sous test (§17.2).

Le harnais **lance Prism lui-même** depuis `web/node_modules/.bin/prism`, jamais par `npx` : mesuré,
le binaire local répond en **1,0 s** là où `npx` à froid coûtait 25 s — c'est cette mesure, corrigée
en cours d'arbitrage, qui a fait basculer la décision. Il réutilise une instance déjà lancée par
`make mock` si elle est signalée, et **échoue franchement** si le binaire ou le contrat manquent.
Aucun `t.Skip()`, aucun tag exclu, aucun build tag : un skip est vert.

Le job CI « Tests Go » n'avait ni node ni `node_modules` — donc pas même le YAML, qui ne vit que là.
Il reçoit l'action de setup existante et `packages: read`, comme les quatre jobs client.

L'alternative examinée — sortir `internal/gateway` dans une cible et un job dédiés — a été écartée :
elle obligeait à redéfinir `make test-go` en « l'arbre moins un package » par une exclusion sur le
**nom**, patron dont ce dépôt a déjà été mordu, et coulait dans le béton des décisions de CI qui
appartiennent à step-007 (« CI à deux toolchains »). Deux lignes dans un job existant laissent
step-007 libre de restructurer.

L'empiètement nominal sur step-007 se consigne ici et dans la PR ; ni `tasks/plan.md` ni la fiche de
step-007 ne sont amputés.

### DN-11 — La porte « le généré est à jour » supprime avant de régénérer

Calquée sur `make check-routes`, et pour la même raison écrite là-bas : une comparaison seule reste
verte quand plus rien ne régénère. Le fichier est **supprimé**, régénéré, puis comparé au commité.

### DN-12 — Ce que cette step ne livre pas, et pourquoi

Le périmètre dit que l'erreur traduite est « réexposée dans la même forme au client ». Aucune route
du BFF n'appelle encore la passerelle — la première arrive en step-004. Cette step livre donc
l'**erreur typée** de `internal/gateway` ; l'extension du DTO `errorResponse` de `internal/bff` avec
`errors[]` attend la route qui la servira, faute de quoi elle serait du code mort qu'aucun test ne
peut exercer de bout en bout.

> **Correction du pointeur, 02/08/2026, depuis step-004.** « La première arrive en step-004 » est
> faux : le périmètre de step-004 est `GET /health`, une sonde de vivacité qui ne touche ni la base ni
> la passerelle. La première route du BFF qui **appelle la passerelle** est **step-060** (groupes de
> clients, M3) — c'est elle qui portera l'extension d'`errorResponse` avec `errors[]`. Le raisonnement
> de ce DN est intact ; seule sa cible était erronée.

### DN-13 — En mode `mock`, le jeton est statique et visiblement factice

*(Décision prise pendant l'implémentation ; elle vivait dans le code sans être consignée ici, ce
qu'une revue a relevé.)*

Mesuré : Prism applique le `security` global du contrat et répond **401 sans en-tête
`Authorization`**, mais accepte **n'importe quel** `Bearer`. Il n'y a pas de `tokenUrl` en face. Le
mode `mock` pose donc une `oauth2.StaticTokenSource` portant une valeur qui se lit comme ce qu'elle
est, et **n'appelle aucun endpoint de jeton** — c'est l'inverse d'un identifiant en dur : une valeur
qui n'ouvre rien.

### DN-14 — Ce qui est connu, latent, et volontairement non traité ici

Quatre constats de revue portent sur du code qu'**aucun appelant n'atteint encore** — la première
route du BFF vers la passerelle arrive en **step-060** (corrigé le 02/08/2026 : ce DN disait
step-004, dont le périmètre est une sonde de vivacité qui ne joint pas la passerelle). Les corriger à
l'aveugle, sans le trafic qui dirait le bon réglage, coûterait plus que de les écrire. Ils sont donc
consignés, et chacun l'est aussi **au-dessus de la ligne concernée** dans le code :

- **Le contexte de l'appelant n'atteint pas l'obtention du jeton.** `oauth2.Transport` appelle
  `Source.Token()` sans `ctx`, et `reuseTokenSource` tient son mutex pendant l'appel réseau. Si le
  `tokenUrl` part en trou noir, les appels concurrents s'y sérialisent, chacun pour la durée du
  `Timeout`, sans qu'un contexte d'appelant annulé ne les libère. La voie propre est un
  `TokenSource` qui prenne le contexte de la requête.
- **`MaxConnsPerHost` n'est pas posé** : le pool borne les connexions *inactives*, rien ne borne les
  connexions ouvertes. C'est le seul cadran qui limiterait la pression de l'invariant (e), et il se
  règle sur une concurrence réelle qui n'existe pas encore.
- **`Proxy` n'est pas posé**, là où `http.DefaultTransport` pose `ProxyFromEnvironment` : divergence
  silencieuse d'avec le défaut, à trancher quand un déploiement dira s'il a un proxy d'egress.
- **`idempotency_key` est engendré non-pointeur et sans `omitempty`** sur les deux opérations de
  crédits que 2.5.0 a durcies : l'oublier compile et envoie l'UUID zéro, qui *a l'air valide*. Aucune
  de ces opérations n'est appelée en M0, mais la step qui les appellera doit le savoir.
