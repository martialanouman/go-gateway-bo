# step-022 — Session BFF : cookie signé, `/auth/me`, `/auth/logout`

> **Jalon :** M1 (§6.9, §4.2) · **Statut :** FAIT
> **Dépend de :** step-021 · **Bloque :** step-023, step-024, step-025, step-027

## But
Savoir qui est connecté d'une requête à l'autre, et le savoir de la même façon depuis n'importe
laquelle des instances. `/auth/me` devient le seul endroit d'où le client apprend ce qu'il a le droit
de faire — l'UI se rend sur des **permissions**, jamais sur un rôle codé en dur (§4.2).

## Périmètre (ce que fait CETTE PR)
- Session **avec état** : une ligne par session (migration `00005`) et un cookie porteur d'un
  identifiant opaque **signé** (`DASHBOARD_SESSION_SECRET`), `HttpOnly`, `Secure`, `SameSite=Lax`,
  sans `Domain`.
- Deux niveaux dans la même session : premier facteur franchi, et **second facteur vérifié**
  (`elevated_at`). Le second est ce que step-025 exigera de toute écriture.
- Middleware de résolution de session, avec sa politique d'expiration **tranchée et écrite**
  (absolue, glissante, ou les deux).
- `GET /auth/me` : opérateur, **union des permissions** de ses rôles, état du second facteur,
  expiration.
- `POST /auth/logout` : la session est supprimée et le cookie expiré.

## Points d'implémentation clés
- **Avec état, et la raison n'est pas le confort.** Un jeton signé sans état ne se révoque pas avant
  son expiration, or trois choses de ce jalon l'exigent : le logout, la désactivation d'un opérateur
  (step-029), et l'élévation qui change **au milieu** d'une session (step-023, step-024). `step-187`
  déclare d'ailleurs déjà purger les « sessions mortes » : le plan attend cette table. Le §3.1 ne la
  déclare pas, et step-005 l'a explicitement renvoyée « à la step qui saura ce qu'elle doit
  contenir » — c'est celle-ci, et elle écrit ce que la spec ne disait pas.
- **La signature ne remplace pas la lecture en base** : elle empêche de deviner un identifiant, elle
  ne dit rien sur le fait que la session vit encore. Les deux, dans cet ordre.
- **Fixation de session** : l'identifiant est régénéré au passage du premier facteur au second. Sans
  ça, un identifiant obtenu avant le second facteur reste valable après.
- `/auth/me` ne rend **aucun rôle nu** comme surface de décision : la spec interdit le contrôle de
  rôle côté client, et une liste de rôles dans le DTO invite à le réintroduire. Les rôles peuvent y
  figurer pour l'affichage ; ce sont les permissions qui décident.
- **Le DTO ne porte ni `password_hash`, ni `mfa_totp_secret`, ni les passkeys.** Le type de domaine du
  store ne traverse pas la frontière (§1.11) : c'est ici que la porte de step-004 cesse de garder une
  sonde de vivacité pour garder quelque chose.
- Le secret de signature n'a **aucun repli** : une clé par défaut serait publique, donc n'importe qui
  signerait une session. Le binaire refuse de démarrer sans elle.

## Tests (écrits dans la même PR)
- **Scénario** `session.feature` : login → `/auth/me` répond ; logout → `/auth/me` refuse ; cookie
  d'une session supprimée → refus.
- Un cookie dont la signature ne colle pas est refusé sans que la base soit interrogée.
- Une session expirée est refusée, et la ligne ne ressuscite pas.
- Deux pools distincts sur la même base (deux instances simulées) résolvent la même session.
- `/auth/me` rend l'**union** des permissions d'un opérateur à deux rôles, sans doublon.

## Definition of Done
- [x] `make check` vert
- [x] la politique d'expiration est écrite avec sa raison, pas seulement implémentée
- [x] la mutation « accepter un cookie non signé » fait rougir
- [x] la mutation « ne pas supprimer la ligne au logout » fait rougir — le cookie expiré seul ne
      protège rien, il suffit de le rejouer
- [x] la mutation « ne pas régénérer l'identifiant à l'élévation » fait rougir

## Hors périmètre
La vérification du second facteur → step-023 et step-024 ; cette step ne fait que porter le niveau.
Les gardes de permission et l'audit → step-025. Les écrans → step-027. La purge des sessions
expirées → step-187.

## Décisions

### DN-1 — Absolue 12 h **et** glissante 2 h, parce qu'aucune ne garde ce que garde l'autre

```
expires_at   = created_at + 12 h   — jamais repoussé, pas même à l'élévation
last_seen_at = now()               — repoussé à chaque requête résolue

vivante ⇔ now() < expires_at ET now() < last_seen_at + 2 h
```

L'absolue borne ce qu'un cookie volé vaut **au maximum** : sans elle, une session dont on se sert ne
meurt jamais, et celle d'un voleur actif non plus. La glissante ferme le poste qu'on a quitté : sans
elle, un cockpit laissé ouvert à midi reste exploitable le soir. Douze heures couvrent un poste et son
dépassement sans couper un opérateur au milieu d'un incident ; deux heures, c'est plus long qu'une
réunion et plus court qu'une demi-journée.

`last_seen_at` est repoussé à **chaque** requête résolue, sans seuil d'économie. Un `UPDATE` HOT sur
une table de quelques centaines de lignes pour 100–300 opérateurs ne mérite pas la complexité d'une
écriture paresseuse, dont le mode d'échec — une session qui meurt alors qu'on l'utilisait — est bien
pire que son coût.

Ce sont des **constantes**, pas des variables d'environnement : une durée de session n'est pas un
réglage de déploiement, et en faire un obligerait à décrire dans `.env.example` un arbitrage qui se lit
mieux à côté de ce qu'il protège.

### DN-2 — L'élévation vaut toute la session

`elevated_at IS NOT NULL` **et** session vivante. Pas de seconde échéance qui périmerait l'élévation
seule : step-025 exigera l'élévation pour toute écriture, et sur un cockpit où l'écriture est fréquente,
une fenêtre courte produirait plusieurs TOTP par heure. Le mode d'échec attendu n'est pas qu'on la
subisse, c'est qu'on demande à la desserrer — et une garde desserrée ne garde plus rien.

La colonne est un instant et non un booléen : elle date l'événement pour l'audit et laisse la porte
ouverte à une fenêtre le jour où une step la voudra. Elle ne fait rien expirer aujourd'hui.

### DN-3 — Le cookie est posé dès `POST /auth/login`

La session naît au franchissement du **premier** facteur, non élevée. L'alternative — ne l'ouvrir
qu'après le second — est infaisable : step-023 exige « une session de premier facteur » pour son
enrôlement, sans quoi on attacherait un authentificateur à un compte qu'on ne détient pas.

Conséquence assumée, à porter dans step-025 et step-027 plutôt qu'à re-trancher : **un mot de passe
seul ouvre une session**, et `/auth/me` lui répond. C'est step-025 qui décidera si les lectures
exigent aussi l'élévation, et step-027 qui renverra une session non élevée vers l'écran du second
facteur. Ce qui rend les deux décisions possibles est le champ `elevated`, livré ici.

### DN-4 — Le `Set-Cookie` n'est pas déclaré au contrat, et un middleware **strict** le pose

La première rédaction du plan disait l'inverse. Trois raisons l'ont renversée, mesurées sur le gabarit
`strict-interface.tmpl` d'oapi-codegen v2.8.0 :

1. **Le contrat mentirait au client.** `openapi-typescript` rendrait `headers: { "Set-Cookie": string }`
   dans `api.gen.ts`, alors que `HttpOnly` interdit au navigateur de le lire. Le précédent
   `Retry-After` ne s'y oppose pas : c'est un en-tête écrit *pour* le client.
2. Le code engendré ferait `w.Header().Set` — correct pour un cookie, faux pour deux. Le jour où
   step-027 voudra un jeton anti-CSRF, l'écrasement serait silencieux.
3. Ce qui a de la valeur — les cinq attributs — ne rentre pas dans le contrat, qui ne verrait qu'un
   `string` opaque fabriqué à la main de toute façon.

Le mécanisme est un `StrictMiddlewareFunc` : le **seul** point du code engendré qui tienne à la fois le
`ResponseWriter` et l'antériorité sur `Visit…Response(w)`. Un middleware chi ne reprendrait la main
qu'après `WriteHeader`. C'est déjà le mécanisme auquel step-025 s'est engagée pour `RequirePermission`.

Ce qu'on perd : `kin-openapi` aurait pu exiger la présence du cookie via un `required: true`. Ce qui le
remplace exige **davantage** — le pas « le navigateur reçoit un cookie de session » vérifie les cinq
attributs.

### DN-5 — Un paquet `internal/session`, pour la cohésion aujourd'hui et une direction d'import demain

`internal/auth` porte le premier facteur : argon2id, les compteurs, l'adresse source.

**Correction de revue (11/08/2026)** : la première rédaction affirmait au présent une direction
`auth → session` qui n'existe pas — `go list` montre qu'`internal/auth` n'importe pas `internal/session`,
les deux sont frères et c'est `internal/bff` qui les compose. Ce que la séparation achète **dès
maintenant** est qu'un importeur de la session n'emporte pas le hachage des mots de passe, ce dont
step-025 profitera. La direction viendra avec step-023, quand elle élèvera la session depuis le chemin
d'authentification.

### DN-6 — L'identifiant régénéré à l'élévation, la ligne conservée

C'est le `token_hash` qui tourne, pas la clé primaire : step-024 liera ses défis WebAuthn à `sessions.id`,
et une référence vers une ligne qui disparaît à chaque élévation serait ingérable. `expires_at` n'est pas
repoussée non plus — l'élévation n'achète pas du temps, elle change ce que la session autorise.

### DN-7 — `format: uuid` n'est pas déclaré sur l'identifiant du DTO

Il n'achèterait **aucune** validation : `kin-openapi` ignore les formats qu'on ne lui a pas enregistrés.
Il ferait en revanche engendrer un `openapi_types.UUID`, donc une conversion depuis le `uuid::text` que
la base rend, dont la branche d'erreur serait inatteignable. Que ce soit un UUIDv7 est dit par le §1.5 et
tenu par le `DEFAULT uuidv7()` de la migration, pas par un type sur le fil.

### DN-8 — Une base en panne rend 500, jamais 401

Le middleware **porte** l'erreur jusqu'au handler plutôt que de l'avaler. Les confondre ferait se
reconnecter l'opérateur en boucle pendant que la panne dure, et masquerait l'incident derrière un écran
de connexion. Même arbitrage qu'au login de step-021.

Le middleware, lui, ne refuse jamais : c'est ce qui garde `GET /health` conforme à sa fiche — la sonde
répond même sur une base tombée, et un middleware qui refuserait ferait redémarrer un process sain.

### DN-9 — `Delete` prend l'identifiant de session, pas l'empreinte du jeton

Le logout vient de résoudre la session, donc il tient sa clé primaire. Repasser par l'empreinte
demanderait de resceller le cookie pour retrouver ce qu'on a sous la main, et fermerait « la session que
porte ce jeton » là où on veut fermer « celle qu'on vient de résoudre ».

### DN-10 — Le préfixe `__Host-`

Il fait **appliquer par le navigateur** ce que la fiche exige par écrit : `Secure`, `Path=/`, aucun
`Domain`. Ce qu'il achète en plus : un sous-domaine compromis ne peut plus écraser le cookie de session.

Le risque était qu'un cookie `Secure` soit refusé en développement, sur `http://localhost`. Mesuré
plutôt que supposé — voir « Ce qui a été mesuré » ci-dessous.

### DN-11 — L'élévation est livrée sans appelant de production

`Sessions.Elevate` et `Manager.Elevate` n'ont aucun appelant avant step-023, qui vérifiera le second
facteur. C'est le même refus symétrique que `IssueChallenge` livré sans `Consume` (step-021, DN-9) : ce
qui se décide ici est la **régénération**, qui appartient au geste de session, et l'exposer par une route
reviendrait à livrer la vérification, explicitement hors périmètre. Le geste est gardé par un test, pas
par une route.

## Tableau des mutations

Tenu au fil de l'eau, sur un dépôt commité. Chaque ligne a été **jouée**, et deux d'entre elles ont
d'abord révélé un défaut du test plutôt que du produit.

### Les deux échéances

| Mutation appliquée | Ce qui tombe |
|---|---|
| borne **absolue** retirée du `WHERE` de `Resolve` | `TestUneSessionAuDelaDeSonEcheanceAbsolueNEstPlusVivante` — **après correction du test**, qui était vert pour la mauvaise borne : voir ci-dessous |
| borne **glissante** neutralisée (paramètre conservé) | `TestUneSessionOisiveAuDelaDeLaFenetreNEstPlusVivante` et `TestUnRefusNeProlongeJamaisLaSession`, plus le scénario « deux heures sans requête » |
| `Resolve` repousse **aussi** `expires_at` | `TestLEcheanceAbsolueNEstJamaisRepoussee` — **après correction du test**, voir ci-dessous |

**Les deux corrections que la mutation a provoquées.** Le premier helper reculait les trois horodatages
ensemble : la fenêtre glissante refusait donc dans tous les cas, et retirer la borne absolue laissait la
suite **entièrement verte**. Trois helpers l'ont remplacé, un par borne. Puis la mutation « repousser
aussi l'échéance absolue » est passée verte à son tour : une session ouverte et résolue à la même
milliseconde ne distingue pas `now() + 12 h` de son échéance d'origine — d'où `openedAgo`, qui recule la
naissance sans toucher la dernière vue.

### Le sceau du cookie

| Mutation appliquée | Ce qui tombe |
|---|---|
| `hmac.Equal` rendu toujours vrai | `TestUneSignatureAltereeEstRefusee`, `TestUnCookieScelleAvecUneAutreCleEstRefuse`, `TestUnCookieMalScelleNAtteintPasLaBase`, `TestLElevationNAtteintPasLaBaseSurUnCookieForge`, plus le scénario « un cookie que ce serveur n'a pas scellé » |
| le cookie porte l'**empreinte** au lieu du jeton | `TestUnJetonScelleSeRelitEtRendLEmpreinteQuiSeraStockee` |
| `HttpOnly` retiré · `Secure` retiré | `TestLeCookieDeSessionPorteSesCinqAttributs`, et le pas « le navigateur reçoit un cookie de session » |
| `Cleared` avec un `MaxAge` nul | `TestLeCookieDeDeconnexionRecouvreCeluiDeLaSession` |
| **`hmac.Equal` remplacé par une comparaison ordinaire** | **rien** — mesuré. Un test de durée sur un écart de l'ordre de la nanoseconde ne prouverait rien. Le constat est écrit au-dessus de la ligne, comme pour `subtle.ConstantTimeCompare` en step-021 |

### La session en base

| Mutation appliquée | Ce qui tombe |
|---|---|
| `Elevate` ne régénère pas le jeton | `TestLElevationInvalideLeJetonPrecedent` |
| `DISTINCT` retiré de l'union | `TestLesPermissionsSontLUnionDesRolesDetenusSansDoublon` et le pas « aucune permission n'est rendue deux fois » |
| `LEFT JOIN` durci en `JOIN` | `TestUnOperateurSansAucunRoleRendUnEnsembleVide` |
| garde du statut élargie aux comptes désactivés | `TestUnOperateurDesactiveNeResoutPlusSaSession` |
| `Delete` ne supprime rien | `TestFermerUneSessionEmpecheDeLaRejouer`, `TestDeuxPoolsDistinctsResolventLaMemeSession` |
| `Elevate` : fenêtre glissante neutralisée | `TestUneSessionOisiveNeSEleveJamais` *(ajouté en revue)* |
| `Elevate` : garde du statut élargie | `TestUnOperateurDesactiveNEleveJamaisSaSession` *(ajouté en revue)* |
| `Manager.Elevate` rend le cookie présenté | **ne compile pas** — `rotate` n'a pas ce cookie en portée *(garde par construction, ajoutée en revue)* |
| `GrantsOf` ne garde que le rôle le plus fourni | le scénario de l'union, qui ne le voyait pas avant la revue |

### Les routes

| Mutation appliquée | Ce qui tombe |
|---|---|
| le login ne pose plus le cookie | le pas « le navigateur reçoit un cookie de session » |
| le middleware strict n'écrit pas le cookie déposé | le même pas |
| le cookie est posé **même sur une erreur** | `TestUnHandlerEnEchecNePoseAucunCookie` — écrit **parce que** cette mutation ne faisait rougir personne |
| `/auth/me` rend 200 sans session | quatre scénarios de `session.feature` *(la première rédaction disait trois ; recompté en revue)* |
| le DTO annonce le second facteur comme vérifié | le pas « le second facteur n'est pas vérifié » |
| le middleware tient toute session pour vivante | quatre scénarios |
| l'erreur de base se lit comme une session absente | le scénario « une base en panne ne se lit pas comme une session fermée » |
| **le logout ne supprime pas la ligne** *(la DoD la nomme)* | le scénario du rejeu — le cookie renvoyé rouvre la session |
| le logout ne pose pas le cookie d'expiration | le pas « le cookie de session est expiré » |
| `401` retiré des statuts de `/auth/me` côté client | `pnpm typecheck` sur `api.test-d.ts` |
| le re-login ne ferme plus la session présentée | le scénario « se reconnecter ferme la session que le navigateur présentait » *(ajouté en revue)* |
| `withoutCaching` retiré du groupe `/api`, ou `Vary` sans `Cookie` | le pas « la réponse interdit toute mise en cache » *(ajouté en revue)* |
| décodage du sceau rendu non strict | `TestUnSceauNonCanoniqueEstRefuse` *(ajouté en revue)* |
| `sessionFrom` tient toute requête pour authentifiée | le scénario « sans cookie, la route de session refuse » *(ajouté en revue)* |

### Ce que la mutation a corrigé dans les **tests**, pas dans le produit

| Ce qui était faux | Ce qui l'a démasqué |
|---|---|
| `age()` reculait les trois horodatages, donc aucun test ne pouvait rougir pour l'échéance absolue | la mutation « borne absolue retirée » restée verte |
| l'échéance absolue comparée sur une session ouverte à la milliseconde près | la mutation « repousser aussi `expires_at` » restée verte |
| le pas altérait le **dernier** caractère du sceau, dont seuls deux bits sur six sont significatifs — le décodeur rendait les mêmes octets, et le scénario passait sur un serveur correct | le scénario rouge alors que le produit était juste |

### Ce qui n'est gardé par rien, vérifié plutôt que supposé

| Ligne | Constat |
|---|---|
| `hmac.Equal` | ~~aucune porte~~ **refermé en step-031** : `TestLeSceauNeSeCompareQuEnTempsConstant` exige l'appel dans `Unseal` **et** y refuse toute comparaison d'octets. Le constat au-dessus de la ligne a été réécrit avec elle |
| le préfixe `__Host-` lui-même | ~~aucune porte du dépôt~~ **faux, corrigé en revue** : `TestLeCookieDeSessionPorteSesCinqAttributs` exige le préfixe, et le remplacer par `dashboard_session` fait rougir. Ce qui reste vrai est que les **scénarios** ne le voient pas — le harnais porte ses cookies à la main et accepterait n'importe quel nom |
| `Elevate`, en tant que geste **atteignable depuis une route** | aucune, et c'est DN-11 : il n'a pas d'appelant de production avant step-023. Ses gardes, elles, sont désormais tenues — voir la section suivante |
| la valeur des durées (12 h, 2 h) | aucune porte : ce qui est gardé est que les **deux bornes existent et mordent**, pas leur valeur. Les changer laisse tout vert — c'est une décision, pas un invariant |

### Ce que la revue a trouvé, et ce qu'elle a fermé

Trois lentilles indépendantes, dont une qui a **rejoué 23 lignes du tableau ci-dessus** : 22 exactes,
une fausse. Ce qui suit est ce qu'aucune n'aurait dû avoir à trouver.

| Trouvé | Comment il tenait avant | Ce qui le tient maintenant |
|---|---|---|
| **Se reconnecter ne fermait pas la session présentée.** Un opérateur qui croit son cookie compromis n'avait aucune remédiation avant step-029 : le navigateur échange sa valeur, donc plus rien n'atteint l'ancienne — valable 12 h, et celui qui en détient la copie avec elle | rien ; le cas n'était pas envisagé | `closePresentedSession` + le scénario « se reconnecter ferme la session que le navigateur présentait » |
| **Les trois gardes d'`Elevate` n'étaient tenues par rien** — fenêtre glissante, statut de l'opérateur, et le cookie rendu. Les tests de `Resolve` ne disent rien d'une seconde méthode qui lui ressemble | rien : les trois mutations étaient vertes | deux tests de store, et le compilateur pour la troisième (`rotate` n'a pas le cookie présenté en portée) |
| **Le scénario de l'union ne prouvait pas l'union** : `billing_readonly` ⊂ `billing_admin`, donc un serveur qui ne garde que le rôle le plus fourni restait vert | rien | `billing_admin` + `account_manager` — six clés propres à chacun, six partagées |
| **`/auth/me` sans aucun cookie** n'était exercé par rien : tous les scénarios passaient par une connexion | rien | un scénario dédié ; un `sessionFrom` qui tiendrait toute requête pour authentifiée fait rougir |
| **Aucun en-tête de cache sur `/api`** alors que `/auth/me` rend l'identité et l'ensemble des permissions | rien | `no-store` + `Vary: Cookie` sur le groupe, avec leur pas de scénario |
| **Quatre encodages acceptés pour un même sceau** — les bits de remplissage du dernier caractère base64 | rien, et c'est le piège déjà payé une fois par un pas de scénario | `RawURLEncoding.Strict()` + `TestUnSceauNonCanoniqueEstRefuse` |
| **`expiresAt` annonçait une échéance que la session n'atteint pas** dans le cas courant | le contrat le documentait, le nom disait le contraire | renommé `absoluteExpiresAt` avant que step-027 en fasse un décompte |

**Quatre affirmations fausses**, toutes de la même famille — un texte qui décrit un mécanisme et que
personne ne relit contre lui : la sonde `/health` « ne touche pas la base » (fausse dès qu'un cookie
accompagne la requête), la direction d'import de DN-5, « le seul type que le reste du serveur
manipule », et « `__Host-` n'est gardé par aucune porte » alors que le test que j'avais écrit l'exige.

## Ce qui a été mesuré

**`__Host-` et `Secure` sur `http://localhost`** — l'affirmation « les navigateurs traitent localhost
comme une origine sûre » porte sur le monde extérieur, donc elle se confronte à sa source. Mesurée le
10/08/2026 dans Chromium (Playwright, serveur d'essai posant le cookie sur `http://localhost`) :

```
__Host-dashboard_session  accepté  · secure: true  · httpOnly: true · sameSite: Lax · path: /
temoin_sans_prefixe       accepté  ← le témoin : s'il manquait aussi, la sonde serait cassée
```

Le repli prévu — un nom nu avec les mêmes attributs à la main — n'a pas eu lieu d'être. **Rien dans le
dépôt ne garde cette propriété** : le harnais godog porte ses cookies à la main et accepterait
n'importe quel nom ; c'est écrit au-dessus de `CookieName`.

**La porte anti-copie** (`api/openapi-bff.yaml`, en-tête) — re-sondée le 10/08/2026 en rejouant la
mesure : `openapi-admin.yaml` 0/28, `openapi-public.yaml` 1/5. Inchangé, mais mesuré et non déduit.

## Ses dettes ont un porteur depuis le 31/08/2026

Elles sont inscrites au **registre de `tasks/todo.md`**, qui les rassemble toutes et que
`TestChaqueDetteNommeUnPorteurQuiExisteEtResteAFaire` empêche de nommer une step inexistante ou déjà
cochée. Le texte ci-dessus n'est pas réécrit : il dit ce qui a été mesuré à la date où il a été
écrit.

Ce qui a changé n'est pas le constat, c'est qu'il cesse de n'exister que dans une fiche archivée —
« une fiche archivée n'est ouverte par personne », et c'était vrai des quarante-neuf.

Le préfixe `__Host-` qu'aucun scénario ne voit, et les durées de session → **step-027**, premier
parcours authentifié contre le binaire. `hmac.Equal` → **step-031**.
