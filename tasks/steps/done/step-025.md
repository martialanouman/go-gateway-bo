# step-025 — `RequirePermission`, journal d'audit, second facteur obligatoire *(invariant c)*

> **Jalon :** M1 (§6.10, §3.1) · **Statut :** FAIT — deux PRs, voir « Découpage »
> **Dépend de :** step-020, step-022, step-023, step-024 · **Bloque :** step-029, et toute écriture du produit

## But
L'autorisation est appliquée **côté serveur**, une fois pour toutes et de façon vérifiable : chaque
opération de mutation exige une clé du catalogue, une session dont le second facteur est vérifié, et
laisse une ligne d'audit. Le rendu conditionnel de l'interface reste un confort — c'est ici que se
gagne l'invariant (c).

## Périmètre (ce que fait CETTE PR)
- `RequirePermission(permissions.Key)` posé en **middleware strict** : le gabarit d'oapi-codegen donne
  `StrictMiddlewareFunc(f, operationID)` (`internal/bff/bff.gen.go:1302`), donc une garde **par
  opération du contrat**, pas par préfixe de chemin.
- La table `operationID → permission requise` (+ « exige une session élevée »), et les exemptions
  **nommées avec leur raison**.
- L'écriture d'`audit_log` sur chaque mutation : opérateur, action, cible, avant/après, adresse.
- Le **second facteur obligatoire** : aucune session non élevée n'atteint une écriture ni
  `content:read`.
- Le **test d'énumération des routes**, bloquant et non désactivable.
- L'appel récurrent à `ensure_audit_log_partitions()`, ou l'écrit de qui le portera — voir plus bas.

### Cinq dettes que cette step hérite, et que ses prédécesseures ont laissées ouvertes

*Elles sont écrites **ici** et non seulement dans `steps/done/`, parce qu'une fiche archivée n'est
ouverte par personne : le renvoi doit aller vers la step qui paie, pas vers celle qui a créé.*

- **Trois routes d'authentification ne sont bornées par aucun compteur** :
  `POST /auth/mfa/totp/enroll` (step-023), `POST /auth/mfa/webauthn/register/begin` et
  `POST /auth/mfa/webauthn/assert/begin` (step-024). Une session de premier facteur suffit à les
  répéter — le verrou d'essais ne garde que la vérification. L'enrôlement TOTP y hache dix argon2id
  par appel ; les cérémonies WebAuthn, elles, ne coûtent qu'une ligne dans `webauthn_challenges`, que
  rien ne purge avant step-187. Cette step reprend ces chemins pour les garder : c'est le moment.
- **`POST /auth/mfa/webauthn/register/finish` doit être audité même s'il reste exempté de garde.**
  Il pose un second facteur, et c'est précisément l'événement qu'une enquête sur compte compromis va
  chercher — « un facteur a été ajouté le … ». La liste d'exemptions ci-dessous parle de permission,
  pas d'audit : les deux ne se confondent pas.
- **`DELETE /auth/mfa/webauthn/passkeys/{passkeyId}` doit sortir des exemptions d'audit** — et pas
  des exemptions de permission. La rédaction précédente disait « c'est la seule opération de
  `/auth/mfa/*` qui exige une permission » ; **c'est faux, et DN-4 le corrige** ici, au contrat et au
  §5.1. Elle porte déjà sa garde d'élévation (step-024, DN-9), elle gagne son audit, et elle n'exige
  aucune clé du catalogue.

## Découpage : deux PRs, et la ligne de fracture n'est pas la taille

La step part en **deux PRs**, contre la règle « une step = une PR » du manuel. La raison n'est pas le
volume mais le fait que les deux moitiés ne se relisent pas avec les mêmes questions, et qu'une seule
des deux est urgente.

**PR 1/2 — le journal d'audit, ses partitions et les bornes héritées.** Tout y a un client réel
aujourd'hui et s'exerce de bout en bout : la panne de partitions était datée au 1er octobre 2026, les
six écritures d'audit sont déclenchées par de vraies routes, et les trois bornes ferment des chemins
gratuits. Elle se juge sur « la trace est-elle complète et propre ? ».

**PR 2/2 — `RequirePermission`, l'exigence d'élévation, et la porte d'énumération.** Aucune de ces
trois choses n'a de client dans M1 : les **huit** mutations existantes sont exemptées de permission,
et les deux autres opérations sont des lectures. Elle se juge sur « la porte forcera-t-elle step-029 et
M3 à déclarer leur garde ? ». DN-8 à DN-13.

La fiche est partie dans `done/` avec la seconde, et c'est là que la ligne de `todo.md` a été
cochée.

## Décisions — PR 1/2

### DN-1 — Les partitions se renouvellent au démarrage **et** toutes les 24 heures
`audit_log` est partitionné par mois et n'en portait que deux, août et septembre 2026 : **toute
écriture aurait été refusée le 1er octobre**, et comme l'audit partage la transaction de l'action
qu'il trace, c'est l'action métier qui serait tombée. `ensure_audit_log_partitions()` est idempotente
(`CREATE TABLE IF NOT EXISTS`), donc deux instances concurrentes ne se gênent pas.

L'appel au démarrage précède `net.Listen` et son échec refuse de servir : une instance qui lierait
son port puis refuserait chaque écriture est déjà dans le pool du load balancer. Le ticker couvre ce
que l'appel de démarrage ne couvre pas — un process qui tourne plus d'un mois, c'est-à-dire le
produit stable qu'on ne redéploie plus. Élargir `ARRAY[0, 1]` à douze mois est refusé nommément par
la migration 00002 : cela déplacerait la date de la panne au lieu de créer ce qui manque.

### DN-2 — `store.Fields` : le type interdit d'y verser un objet de domaine
`before_json` / `after_json` se composent par `Text`, `Number` et `Flag`, jamais par le marshal d'un
type de domaine. Ce n'est pas une liste blanche qu'on relit : c'est l'**absence de méthode** pour y
mettre autre chose. Marshaler un type de domaine y ferait entrer ce qu'il porte aujourd'hui — un mot
de passe haché, un secret de second facteur, un corps de message — et tout ce qu'on lui ajoutera
demain, sans qu'aucune relecture ne le voie. C'est la règle du DTO de sortie (§1.11) appliquée à une
écriture.

`ip_address` va en clair, délibérément : le HMAC des adresses garde `login_attempt_counters`, la
seule table qu'une requête **non authentifiée** fait écrire. Le journal n'est écrit que par des
actions authentifiées, et une enquête a besoin de l'adresse telle quelle.

### DN-3 — L'audit d'une action locale partage sa transaction ; le trou du proxy est écrit
`RecordTx` écrit dans la transaction de l'action : ou les deux, ou aucune. C'est ce qui rend la trace
non contournable — et c'est aussi pourquoi une partition manquante ferait tomber l'action.

Pour une action **proxyfiée** vers la passerelle il n'y a pas de transaction commune : `Record`
écrit après le succès, et une panne entre les deux perd la trace. Le trou est réel, il est écrit ici
et dans le code, et **M3 en héritera** — le découvrir alors coûterait une passe.

### DN-4 — Le retrait d'une passkey n'exige **aucune** permission
La fiche, le §5.1 et le contrat disaient le contraire : « la seule opération de ce préfixe qui exige
une permission ». **Les trois sont corrigés dans cette PR.**

Aucune clé du catalogue ne convient : retirer sa propre passkey est du self-service, pas un acte sur
autrui. En créer une (`mfa:manage`) ferait une quatrième clé orpheline — donc une clé qu'il faudrait
attacher aux neuf rôles pour que le self-service marche, c'est-à-dire une clé qui n'exclut personne.
Elle garde son exigence d'élévation et gagne une ligne d'audit ; c'est `operators:manage` qui gardera
le geste **sur autrui**, en step-029.

### DN-5 — Six des huit mutations de `/auth/` sont auditées, et les deux exemptées le sont nommément
Les deux ouvertures de cérémonie WebAuthn n'ont aucun effet durable : un défi tiré, remplacé au
prochain appel, consommé ou échu en cinq minutes. Les tracer produirait du bruit qu'une enquête
devrait apprendre à écarter, ce qui est le meilleur moyen de lui faire écarter autre chose. Un
scénario garde l'exemption elle-même.

**Seuls les succès sont journalisés.** Un refus est déjà compté par le verrou d'essais, et
journaliser les échecs de connexion ouvrirait une écriture par requête non authentifiée : c'est
précisément ce que `login_attempt_counters` existe pour éviter d'exposer.

`register/finish` est **audité bien qu'exempté de garde** : il pose un second facteur, l'événement
qu'une enquête sur compte compromis cherche en premier. Exemption de garde et exemption d'audit ne se
confondent pas.

### DN-6 — Les trois routes gratuites sont bornées par un compteur d'**appels**, pas d'échecs
`POST /auth/mfa/totp/enroll`, `register/begin` et `assert/begin` réussissent à chaque fois : les
trois dimensions existantes de `login_attempt_counters` ne comptent que des échecs et ne les voyaient
jamais passer. La migration 00009 en ajoute deux qui comptent des appels — la divergence avec les
noms `failures` et `last_failure_at` est écrite dans la migration plutôt que laissée à découvrir.

Deux dimensions et non une : un enrôlement hache dix argon2id là où une ouverture écrit une ligne, et
un budget commun serait trop lâche pour l'un ou trop serré pour l'autre. Cinq enrôlements et vingt
ouvertures par quart d'heure ; **une garde qui refuse du légitime finit retirée**, et une clé qu'on
cherche produit de vraies reprises.

**Et la borne de l'enrôlement ferme un canal que la migration 00007 ne voyait pas.** Vérifié en
écrivant cette fiche : `EnrollTotp` appelle `verifyPresentedFactor` pour le remplacement, mais jamais
`Fail` — un code faux présenté à l'enrôlement ne faisait monter aucun compteur. Qui détenait le mot
de passe pouvait donc chercher un code à six chiffres par cette route, sans borne, exactement ce que
00007 avait fermé sur `/auth/mfa/verify`. Le compteur d'appels le ramène à cinq essais par quart
d'heure — le même débit que le verrou d'essais.

**L'ordre — consulter le verrou puis compter — n'est écrit qu'une fois**, dans `store.Counter.Admit`.
Il l'a d'abord été deux fois, un appelant chacun, et la mutation qui l'inverse est restée verte sur
celui des deux qu'aucun scénario d'échéance n'atteint. C'est ce qui a fait replier les deux gestes en
une méthode.

### DN-7 — `pgx` nu confirmé, et le critère de réexamen était un proxy

`plan.md` §19 fixait le réexamen à cette step et nommait deux déclencheurs. Mesurés :

| Déclencheur | Aujourd'hui |
|---|---|
| « un store au-delà d'une vingtaine de requêtes » | **29** littéraux SQL nommés, 42 sites d'appel |
| « une requête à plus de cinq ou six colonnes » | **dix** — `internal/store/webauthn.go:137` |

Les deux ont tiré, et le second dès step-024. Des trois jambes de la décision de step-020, **une est
cassée** : « `sqlc` n'aurait presque rien à engendrer » n'est plus vrai. Les deux autres tiennent, et
la première tient plus fort qu'alors — le second analyseur SQL doit désormais avaler une table
partitionnée, une fonction PL/pgSQL, `uuidv7()`, `make_interval(secs => $n)` et `nullif($1, '')::inet`.

**La troisième a cessé d'être une affirmation pour devenir une mesure.** Le plan nommait précisément
le défaut que `sqlc` supprime par construction : une liste d'arguments de `Scan` tenue à la main. Il
a été reproduit sur le pire cas du dépôt — le scan à dix colonnes de `passkeysOf` — en intervertissant
deux champs **de même type**, ce qui compile et passe le typage :

| Mutation | Résultat |
|---|---|
| `BackupEligible` et `BackupState` intervertis (deux `bool` adjacents) | rouge |
| `CredentialID` et `PublicKey` intervertis (deux `[]byte` adjacents) | rouge |

Le défaut n'est pas silencieux ici : les testcontainers l'attrapent. `pgx` nu tient.

**Et le critère lui-même était un proxy, qui a mal tiré.** « Vingt requêtes, six colonnes » mesure une
taille ; ce qui décide est l'observabilité d'un `Scan` mal ordonné, une propriété du harnais et non du
compte de requêtes. Le déclencheur juste est écrit dans `plan.md` §19 à la place de l'ancien : **un
`Scan` dont la mutation d'interversion de deux champs de même type reste verte**. Falsifiable, et
c'est la discipline que le dépôt applique déjà.

## Décisions — PR 2/2

### DN-8 — La garde est un `StrictMiddlewareFunc`, et le refus est l'**écriture**, pas le retour

`plan.md` disait « middleware **chi** » ; il est corrigé dans cette PR. Un middleware chi ne reprend
la main qu'après `Visit…Response(w)`, sur une réponse déjà écrite.

Le refus s'écrit sur le `ResponseWriter`, puis le middleware rend `(nil, nil)` : lu dans
`bff.gen.go:1360-1368`, les trois branches du wrapper sont alors fausses et rien n'est réécrit
par-dessus. **Rendre `(nil, nil)` sans écrire laisserait `net/http` servir un 200 vide** — un test le
tient, parce que c'est le mode d'échec qui se lit comme un succès.

**Une affirmation de la rédaction d'origine était fausse et se corrige ici.** Elle disait : « ne
jamais rendre une interface typée nulle (`var r XResponseObject; return r`), celle-ci est non nulle
et déclenche le 500 ». Mesuré : `XResponseObject` étant une *interface*, une variable nulle de ce
type **est** nulle, et la mutation reste verte. Le vrai piège est de rendre l'objet de réponse d'une
**autre** opération — la branche `response != nil` tire alors sur `unexpected response type`, donc
500 au lieu de 403. C'est cette mutation-là qui est mesurée, et c'est exactement le défaut auquel
l'alternative « une table `operationID → constructeur du 403` » exposerait.

### DN-9 — Une seule table, dix opérations, et le défaut **fermé**

Garder et exempter sont deux réponses à la même question — « cette opération a-t-elle été
décidée ? » — donc une seule table. Avec deux structures, une opération absente des deux est un trou
qu'il faut penser à chercher.

Elle couvre les dix opérations et non les seules mutations, et une opération absente est **refusée**.
C'est ce qui rend bruyant le piège des deux vocabulaires : la clé est le nom de méthode Go que le
wrapper passe (`Login`), quand le YAML déclare `login`. Écrite en camelCase, l'entrée devient
inatteignable — refuser la rend visible au premier appel, là que laisser passer aurait ouvert la
garde en silence.

### DN-10 — Trois refus, trois conditions qu'il ne faut pas confondre

- **401** sur une session fermée : le remède est de se reconnecter.
- **403 `mfa_required`** sur une session vivante non élevée. Ni 401 — se reconnecter **boucle**,
  puisque cela rend précisément une session de premier facteur — ni 409, contrairement aux quatre
  refus de `/auth/mfa/*` : là-bas le 409 dit « un facteur existe déjà, franchissez-le pour en ajouter
  un autre », un conflit d'état dont le remède est nommé ; ici c'est une interdiction pure.
- **403 `permission_denied`** sur une clé absente, **et le message la nomme** : la charte exige qu'un
  contrôle interdit soit expliqué, et c'est la clé qu'un administrateur cherchera dans l'éditeur de
  rôle. Elle ne révèle rien — le catalogue entier part au client dans `permissions.gen.ts`.
- **500** sur une panne de lecture : une base injoignable lue comme « vous n'avez pas le droit »
  ferait chercher un problème de rôle pendant que la panne est ailleurs.

`DELETE /auth/mfa/webauthn/passkeys/{passkeyId}` **garde son 409 dans le handler** : le déplacer dans
la table offrirait un client de façade au mécanisme, au prix d'un changement de statut sur une route
livrée et d'un retour sur la distinction ci-dessus.

### DN-11 — Le mécanisme n'a aucun client, et la couture qui le rend exerçable a son propre garde-fou

Aucune des dix opérations n'exige de clé : les **huit** mutations vivent sous `/auth/`, où
l'autorisation est l'affaire de chaque route, et les deux autres opérations sont des lectures. Le
premier `requires` arrive avec `POST /operators`, en step-029.

Le risque est celui que le dépôt nomme — « des tests de complaisance sur du code défensif jamais
produit ». Ce qui le borne : le mécanisme est tenu par des **unitaires** qui traversent le wrapper
engendré, pas par des scénarios qui feraient semblant ; et la porte est la vraie livraison.

La source des permissions passe par un type de fonction plutôt que par le `*session.Manager` :
`internal/bff` ne monte aucune base, et sans cette couture la branche « la clé manque » n'aurait
aucun test avant step-029 — donc la mutation qui retire la comparaison resterait verte. Toute couture
a son propre risque, celui de vérifier ce que la production ne câble pas ; il est fermé par
`TestLaGardeEstCablee`, qui exige du type-checker que le montage atteigne `(*session.Manager).Grants`.

**Sa première rédaction était verte pour la mauvaise raison**, et c'est écrit dans le test : elle
cherchait l'appel « quelque part dans le paquet », or `me.go` appelle déjà `Grants` pour rendre les
permissions à l'écran. Elle était donc vraie avec ou sans garde câblée. Les appels sont désormais
rattachés à la fonction qui les porte.

### DN-12 — La porte tire ses cas du contrat, et lit l'audit dans le **code**

Cinq propriétés, et deux sens plutôt qu'un : toute opération du contrat a une entrée, **et** toute
entrée désigne une opération du contrat — sans le second, une entrée en camelCase passerait, la
première ne regardant que les opérations qui ont une entrée. Puis : toute clé citée existe au
catalogue — le seul endroit du dépôt qui tienne ce sens, `catalog.go:90-98` documente le piège ;
toute exemption porte sa raison ; et **toute opération gardée déclare son 403 au contrat**, sans quoi
le refus écrit à la main ne serait conforme à rien et c'est le scénario de step-029 qui le
découvrirait.

Le pont camelCase → PascalCase n'est pas une transformation de chaîne mais une **résolution par le
type-checker** dans `StrictServerInterface` : le jour où oapi-codegen nommerait autrement, la porte le
dit au lieu de ne plus rien trouver.

**La cinquième lit le code.** Une table « voici les opérations auditées » se déclare vraie sans
preuve : une opération listée dont le handler cesse d'écrire y resterait, verte. Ce qui est lu est
l'appel réel, avec un **point fixe** sur les appels intra-paquet — la lecture reste donc vraie le jour
où une écriture passe par un helper extrait. L'exemption est vérifiée dans les deux sens : une
opération déclarée exemptée qui écrirait quand même fait rougir, parce que l'exemption mentirait.

`chi.Walk` ne pouvait pas remplacer tout ça : mesuré en step-004, le choix d'implémentation vit dans
un champ non exporté de closure qu'aucune réflexion n'atteint.

### DN-13 — Le contrat porte **huit** mutations, et c'est la porte qui l'a dit

Sept `POST` et un `DELETE`, contre deux `GET`. La fiche et un commentaire fraîchement écrit disaient
« neuf » : le chiffre venait d'un décompte des opérations **exemptées** — neuf des dix — glissé en
« neuf mutations », et il avait traversé un plan, une description de PR et une relecture.
`internal/bff/audit.go` avait raison depuis la PR 1/2 (« six des huit mutations »), et personne ne
confrontait les deux. La porte l'a dit à sa première exécution.

## Mutations mesurées — PR 2/2

| Mutation | Ce qui rougit |
|---|---|
| la comparaison de permission retirée | `TestUneSessionSansLaCleEstRefusee` |
| l'exigence d'élévation retirée | `TestUneSessionNonElevueEstRefuseeAvantTouteLecture` |
| le défaut ouvert au lieu de fermé | `TestUneOperationQueLaTableNeDecidePasEstRefusee` |
| `(nil, nil)` sans écrire → 200 vide | `TestUneSessionNonElevueEstRefuseeAvantTouteLecture` |
| la réponse typée d'une **autre** opération → 500 | idem |
| la panne de lecture déguisée en refus | `TestUnePanneDeLectureDesPermissionsNestPasUnRefus` |
| la garde retirée du montage | `TestLaGardeEstCablee` |
| la source des permissions n'est plus la vraie | idem |
| le montage sur une source de façade | idem |
| une entrée retirée de la table — **en retirant** | porte, propriété 1 |
| une entrée écrite en camelCase | porte, propriété 1 bis |
| une clé absente du catalogue | porte, propriété 2 |
| une exemption sans raison écrite | porte, propriété 3 |
| une opération gardée sans 403 au contrat | porte, propriété 4 |
| la population du contrat vidée | le plancher, pas une assertion muette |
| une mutation cesse d'auditer | porte, propriété 5 — le détecteur |
| une exemption d'audit sur une opération qui écrit | porte, propriété 5, sens inverse |
| le point fixe retiré du détecteur | porte, propriété 5 |

**Une mutation a d'abord survécu, et elle était mal construite** : « rendre une interface typée
nulle » ne reproduisait rien — voir DN-8, où l'affirmation qu'elle devait vérifier se révèle fausse et
se corrige.

**Une porte a d'abord été verte pour la mauvaise raison** : `TestLaGardeEstCablee`, avant d'être
resserrée sur le corps des fonctions — voir DN-11.

## Mutations mesurées — PR 1/2

Jouées une par une, `-count=1`, lues au code de sortie.

| Mutation | Ce qui rougit |
|---|---|
| `EnsureAuditPartitions` retirée du démarrage | scénario des partitions |
| le branchement du ticker retiré | `TestLeDemarrageEntretientLesPartitionsDAudit` |
| l'audit du login non écrit | « une connexion réussie laisse exactement une trace » |
| l'audit du retrait de passkey retiré | « retirer une clé d'accès laisse une trace » |
| l'adresse de l'appelant non transmise | « l'événement porte l'adresse de l'appelant » |
| le secret versé au journal | « le journal ne porte ni le secret ni les codes de récupération » |
| le verrou d'enrôlement non consulté | « six enrôlements d'affilée sont bornés » |
| l'enrôlement non compté | « six enrôlements d'affilée sont bornés » |
| la borne des cérémonies ne refuse plus | « vingt et une ouvertures d'affilée sont bornées » |
| les deux cérémonies ne partagent plus leur seau | « le seuil des cérémonies est commun … » |
| compter avant de consulter le verrou | « le verrou se lève tout seul, et la fenêtre oublie » |
| la fenêtre n'oublie pas (`CASE` retiré) | « le verrou se lève tout seul, et la fenêtre oublie » |

**Deux mutations ont d'abord survécu, et les deux étaient mal construites** : l'une remplaçait la
dimension des cérémonies par celle de l'enrôlement — les deux continuaient de la partager, donc le
défaut visé n'était pas reproduit ; l'autre inversait l'ordre sur le chemin des cérémonies, qu'aucun
scénario d'échéance n'atteint. La seconde a révélé un vrai défaut de conception et a été corrigée
dans le code, pas dans la mutation.

**Le 429 déclaré au contrat n'a pas de mutation**, et c'est mesuré plutôt que supposé : le retirer du
YAML fait disparaître le type engendré, donc le code ne compile plus. La conformité est tenue par le
compilateur, pas par un test.

## Points d'implémentation clés
- **La garde se pose par `operationID` parce que c'est ce que le code engendré offre.** Une garde
  montée sur un préfixe de chemin garde ce que le préfixe attrape, pas ce que le contrat déclare : le
  jour où une opération change de chemin, elle sort de la garde sans que rien ne le dise.
- **Le test d'énumération ne doit pas tirer ses cas de la table qu'il garde.** La population des
  opérations de mutation se lit dans le **YAML** (`POST`, `PATCH`, `PUT`, `DELETE`) ; la table de
  gardes est l'**objet** testé, jamais la source des cas. Une porte dont les cas viennent de la donnée
  qu'elle garde ne voit pas sa dérive — et la mutation qui compte est de **retirer** une entrée, pas
  d'en altérer une.
- **`chi.Walk` seul ne suffira pas** : mesuré en step-004, toutes les routes sous `/api` sont servies
  par le même wrapper engendré, et le choix d'implémentation vit dans un champ non exporté de closure
  qu'aucune réflexion n'atteint (`internal/bff/router_test.go:180-189`). Le walk prouve qu'une route
  est montée ; c'est la confrontation contrat ↔ table qui prouve qu'elle est gardée.
- **Les exemptions sont une liste courte et justifiée dans le code** : `/auth/login`, `/auth/mfa/*`,
  `/auth/logout`, `/health`. Une liste qui s'allonge sans raison écrite est le premier état d'une
  garde désactivée.
- **`audit_log` ne reçoit ni secret ni corps de message.** `before_json` / `after_json` sont produits
  par un réducteur qui **énumère les champs autorisés**, jamais par le marshal d'un type de domaine :
  la même règle que le DTO de sortie (§1.11), appliquée à une écriture. Un payload piégé le vérifie.
- **L'audit est écrit dans la transaction de l'action quand l'action est locale.** Pour une action
  proxyfiée vers la passerelle il n'y a pas de transaction commune : l'audit s'écrit après le succès,
  et ce trou-là s'écrit là où il vit — M3 en héritera, et le découvrir alors coûterait une passe.
- **Cette step est la première dont une écriture dépend des partitions d'`audit_log`.** step-005
  (DN-11) a mesuré que `ensure_audit_log_partitions()` n'est appelée qu'à l'application de la
  migration, et qu'aucun appelant récurrent n'existe : sur une base migrée aujourd'hui, **toute
  écriture d'audit sera refusée au troisième mois**. Comme l'audit partagera la transaction de
  l'action, c'est l'action qui tombera. Cette step livre l'appel récurrent, ou écrit noir sur blanc qui
  le porte et quand — elle ne peut pas l'ignorer.

## Tests, et la forme qui convenait à chaque risque

- **La porte d'énumération**, bloquante — `internal/bff/enumeration_test.go`. Cinq propriétés, cas
  tirés du contrat, jamais de la table gardée. Détail en DN-12.
- **Les unitaires de la garde**, à travers le wrapper engendré réel — `internal/bff/guard_test.go`.
  C'est la forme que DN-11 impose : le mécanisme n'a aucun client, et un scénario qui prétendrait
  l'exercer ferait semblant.
- **Les scénarios de la PR 1/2** couvrent la trace : une mutation réussie écrit exactement une ligne,
  une mutation refusée n'en écrit aucune, le payload piégé ne laisse ni secret ni code au journal.

**Deux exigences de la rédaction d'origine sont parties chez step-029, et la raison est écrite en
DN-11** : « un opérateur sans `operators:manage` est refusé » et « une session non élevée est refusée
sur une écriture » n'ont **aucune route sur laquelle s'écrire** dans M1. `step-029.md` les porte
(section « Tests »), et sa DoD s'engage à faire rougir cette porte-ci.

## Definition of Done
- [x] `make check` vert, `make e2e` vert
- [x] **retirer une garde fait rougir** — mesuré sur les trois refus du middleware, et sur le
      **câblage** séparément : la garde retirée du montage fait rougir `TestLaGardeEstCablee`, et
      rien d'autre, ce qui est écrit plutôt que caché
- [x] la mutation « retirer l'exigence de session élevée » fait rougir
- [x] la mutation « retirer l'écriture d'audit d'une mutation » fait rougir — **le détecteur
      statique**, pas un scénario
- [x] la mutation « retirer une entrée de la table » fait rougir la porte — **en retirant**, pas en
      altérant
- [x] le sort des partitions d'`audit_log` est réglé : appel au démarrage et ticker quotidien (DN-1)

## Hors périmètre
`usePermission` / `PermissionGate` côté client → step-040. L'écran de consultation du journal
d'audit → step-184. La rétention et le détachement des partitions → step-187. Les gardes des écrans
métier → leurs steps respectives, qui consomment ce middleware sans le redéfinir.

## Dettes ouvertes par cette step, avec leur porteur

- ~~**Trois rédactions du même SQL de compteur.**~~ **Payée le 29/08/2026**, et l'intitulé était faux
  dans le sens qui arrange. Mesuré ligne à ligne : `MFA` et `Counter` étaient le **même** SQL à la
  source de la dimension près — `LockFor` au caractère près, `RecordFailure` au `RETURNING` près — et
  `Logins` est une requête d'une autre forme, deux dimensions en une instruction avec le seuil filtré
  en Go. Deux rédactions, donc, pas trois. Et une quatrième
  duplication que la note ne voyait pas : le `DELETE` de `ClearFailures`, écrit deux fois à
  l'identique, plus le calcul de `Lock.Remaining`, écrit **cinq** fois.

  `Counter` est désormais la rédaction unique de tout accès **mono-dimension** ; `Logins` garde la
  seule requête qui en couvre deux. Le repli a un gain qui se mesure : `Counter` n'avait **aucun test
  de niveau store** — il n'était exercé que de bout en bout — et hérite de ceux de `MFA`. Une seule
  mutation, retirer la fenêtre d'oubli, fait maintenant rougir le test Go du second facteur *et* le
  scénario de l'enrôlement ; avant, elle en atteignait un seul.

- **Ce qui reste de cette dette, et qui n'est pas payé.** La marque « payée » ci-dessus vaut pour le
  mono-dimension. La branche `CASE` de la fenêtre d'oubli et l'`ON CONFLICT DO UPDATE` restent écrits
  **deux fois** — `counters.go` et `logins.go` —, parce que la requête à deux dimensions ne se replie
  pas. Le scénario d'origine survit donc, en plus petit : changer la politique d'oubli et ne toucher
  que `Counter` donnerait au premier et au second facteur deux politiques différentes, et le
  commentaire de `logins.go` qui dit « la même valeur, délibérément » deviendrait faux en silence.
  **Toujours sans porteur, et cette fois avec la raison mesurée** : replier la requête bi-dimension
  remanierait le chemin consulté avant tout argon2id, pour un gain de forme.
- **Un refus de permission ne laisse aucune trace côté serveur.** `internal/bff` ne reçoit aucun
  `*slog.Logger` (`router.go:151-156`), et le journal d'audit ne porte que les **succès** : un 403 de
  `RequirePermission` n'existe nulle part. → **step-029**, qui livre les premières routes gardées.
  Renvoyer la dette à step-060, qui apporte le journal avec le premier appel à la passerelle, la
  daterait **plus tard que la step qui la fait mordre** — step-029 est en M1, step-060 en M3.

  La forme proposée n'exige aucun journal : **auditer les refus de permission**. La raison écrite de
  ne journaliser que les succès — une écriture par requête **non authentifiée** — ne vaut pas ici : un
  403 de permission vient d'une session vivante *et* élevée. Les **500**, eux, restent sans trace, et
  ça reste l'affaire de step-060.
- **Aucune durée de rétention n'existe nulle part.** Le §3.1 renvoie à un document compagnon absent
  du dépôt. `audit_log` croît sans borne. → **step-187**, avec le détachement des partitions.
- **`GET /audit-log` filtrera sur `target_type` sans index.** La table est partitionnée par mois, donc
  un filtre par cible balaiera chaque partition retenue. → **step-184**, qui livre l'écran.
- ~~**`pgx` nu vs `sqlc` : le point de réexamen est re-daté à step-029.**~~ **La première rédaction de
  ce point était fausse, et le reste de cette puce la corrige.** Elle re-datait sans avoir mesuré les
  deux déclencheurs que `plan.md` nommait — or les deux avaient tiré, et le second dès step-024.
  Le réexamen a donc eu lieu ici, à la date prévue. **Verdict : `pgx` nu, confirmé** ; voir DN-7.
- ~~**L'enrôlement TOTP ne compte aucun échec dans la dimension qui convient.**~~ **Payée
  séparément le 29/08/2026**, et l'intitulé sous-estimait le défaut : ce n'était pas une dimension mal
  choisie mais un **second seau de cinq essais**, indépendant de celui de la vérification — dix
  devinettes par quart d'heure au lieu de cinq. Le remplacement consulte désormais le même verrou et
  compte dans le même seau. La correction a aussi refait le calcul qui rassurait : « quatre-vingts
  ans » était faux d'un facteur soixante, le verrou en achète **seize mois**.

## Ses dettes ont un porteur depuis le 31/08/2026

Elles sont inscrites au **registre de `tasks/todo.md`**, qui les rassemble toutes et que
`TestChaqueDetteNommeUnPorteurQuiExisteEtResteAFaire` empêche de nommer une step inexistante ou déjà
cochée. Le texte ci-dessus n'est pas réécrit : il dit ce qui a été mesuré à la date où il a été
écrit.

**La fenêtre d'oubli écrite deux fois y reste sans porteur, délibérément**, avec la raison mesurée
qu'elle porte déjà. Le registre l'inscrit sous cette forme plutôt que de la taire : une dette qu'on
choisit de garder n'est pas une dette qu'on oublie.
