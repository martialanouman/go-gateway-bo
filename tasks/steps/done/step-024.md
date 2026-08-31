# step-024 — MFA WebAuthn / passkey

> **Jalon :** M1 (§6.9) · **Statut :** FAIT le 27/08/2026
> **Dépend de :** step-023 · **Bloque :** step-025, step-028
>
> *La dépendance à step-023 n'est pas technique — les deux cérémonies sont indépendantes. Elle est
> celle du refus « retirer le dernier facteur enferme l'opérateur » : sans TOTP livré, la règle n'a
> qu'un cas et ne se teste pas.*

## But
Le second facteur que la spec privilégie quand l'appareil le supporte : une clé liée à l'origine, que
l'hameçonnage ne transporte pas. Les deux cérémonies — enregistrement et assertion — vivent
entièrement côté serveur ; le client ne fait que relayer ce que le navigateur produit.

## Périmètre (ce que fait CETTE PR)
- `go-webauthn/webauthn` : enregistrement d'une passkey, assertion, élévation de la session de
  step-022.
- `rpID` et `origin` **de configuration serveur** (`DASHBOARD_WEBAUTHN_RP_ID`,
  `DASHBOARD_WEBAUTHN_ORIGIN`), vérifiés à chaque cérémonie.
- Défis à **usage unique**, de courte durée, liés à la session — la migration qui les porte s'écrit
  ici, et **le §3.1 s'amende dans la même PR**.
- Stockage des authentificateurs **dans leur propre table** et non dans la colonne `jsonb` que le
  §3.1 déclarait, avec le **compteur de signature** — voir DN-4.
- Plusieurs passkeys par opérateur ; suppression d'une passkey.

## Points d'implémentation clés
- **`rpID` et `origin` ne se lisent jamais dans la requête.** Les lire là reviendrait à laisser
  l'attaquant choisir le domaine contre lequel la clé s'authentifie — c'est exactement la propriété
  que WebAuthn achète, et la seule façon de la perdre.
- **Le compteur de signature qui recule signale un authentificateur cloné** : l'assertion est refusée.
  Mais certains authentificateurs rendent toujours zéro : ce cas est **admis explicitement et nommé**,
  jamais contourné en désactivant le contrôle.
- **Un défi rejouable annule la cérémonie.** Usage unique, expiration courte, lié à la session qui l'a
  demandé.
- **Retirer la dernière passkey d'un opérateur qui n'a pas de TOTP l'enferme dehors** : refusé, et
  expliqué en nommant ce qui manque.
- Un opérateur peut détenir TOTP **et** passkey. Le serveur les accepte à parité.

---

## Décisions (DN)

### DN-1 — `go-webauthn/webauthn` **v0.18.0**, publiée le jour même
`plan.md:115` relevait v0.17.4 (22/05) ; v0.18.0 est sortie le 27/08 à 12:38, quelques heures avant
cette step. OSV ne déclare aucune vulnérabilité pour ce module, aucune version — `govulncheck` ne
départageait donc pas les deux, et la surface employée est identique, vérifiée signature par
signature.

Ce qui a décidé : **`WithRegistrationOrigin` / `WithLoginOrigin` n'existent pas en 0.17.4**, où une
réponse est vérifiée contre *toutes* les origines configurées — une cérémonie commencée sur l'une se
finit sur une autre. Lier chaque cérémonie à une seule origine est précisément ce que la fiche demande
de tenir. La mutation en deux temps le prouve (voir le tableau).

Second apport : un `rpID` en adresse IP est désormais refusé par `webauthn.New`, ce qui transforme un
défaut latent — un tel rpID n'a jamais pu aboutir côté navigateur — en erreur de configuration
visible au démarrage.

Les ruptures annoncées par le guide de migration portent sur les extensions typées et les options
implémentées hors module. Nous n'utilisons ni l'une ni l'autre.

### DN-2 — `rpID` et `origin` de configuration, jamais de la requête
Deux variables, obligatoires et sans repli, mais **qui ne sont pas des secrets** : le navigateur les
voit à chaque cérémonie. Ce qu'elles gardent tient à leur provenance.

Leur *validité* n'est pas jugée par `internal/config` : la spécification WebAuthn §5.1.3 dit ce qu'est
un domaine valable, la bibliothèque l'applique, et le redire ailleurs en ferait deux rédactions dont
une périmerait. `cmd/dashboard` construit donc le manager **avant de lier son port**.

### DN-3 — Le harnais godog n'a pas besoin de `localhost` ; les parcours, si
L'origine est une valeur **déclarée des deux côtés**, jamais déduite de la connexion. Le binaire des
scénarios écoute donc toujours sur `127.0.0.1:<port éphémère>` en déclarant
`dashboard.exemple.test` — et c'est ce qui donne leur force aux onze scénarios : un code qui lirait
l'origine dans la requête verrait `http://127.0.0.1:…` et refuserait tout.

`web/playwright.config.ts` passe en revanche de `127.0.0.1` à `localhost`. Aucun parcours n'exerce
encore de passkey ; déclarer une origine en `localhost` tout en visitant une IP ferait de cette
configuration un mensonge, et c'est step-027 qui le paierait.

### DN-4 — Une table `webauthn_credentials`, et la colonne `jsonb` disparaît
Le §3.1 déclarait `operators.mfa_webauthn_credentials`, créée par 00001 et **qu'aucun code Go n'a
jamais lue**. La fiche reprenait cette colonne ; elle est écartée pour une raison mécanique.

Le refus du compteur qui recule s'écrit dans une table `WHERE sign_count < $2`, avec `RowsAffected()`
pour verdict — le patron monotone de DN-2 de step-023, déjà éprouvé et déjà muté. Dans un tableau
`jsonb` il faudrait un `jsonb_set` sur un chemin calculé, et l'atomicité se raisonnerait au cas par
cas plutôt qu'une fois. `mfa_recovery_codes` est le précédent exact : step-023 a préféré une table à
un tableau, et le §3.1 ne la déclarait pas non plus.

La colonne est **supprimée** dans la même migration. La laisser ferait coexister deux endroits qui
prétendent porter les passkeys, dont un vide.

### DN-5 — Les défis vivent dans leur table, liés à `sessions.id`
`00005_sessions.sql` portait déjà la promesse. Une table distincte de `mfa_challenges` : les deux
objets n'ont ni la même clé, ni la même durée, ni le même contenu — l'un porte l'empreinte d'un jeton
rendu au client, l'autre un état que le serveur seul relit.

Elle porte un **`purpose`**, et un seul défi vit à la fois par (session, objet) : l'ouverture éteint
celui qu'elle remplace, dans la même instruction. Deux onglets rendraient sinon indécidable celui que
la finition doit relire, et le choisir par sa date ferait dépendre une garde d'un tri.

### DN-6 — Le compteur de signature est monotone, et le zéro est admis nommément
`RowsAffected() == 0` est le verdict. La seconde moitié de la condition admet le zéro permanent —
certains authentificateurs ne comptent pas. Ce qu'elle laisse alors passer est écrit : sur ces
appareils-là le clonage ne se détecte pas, aucune information n'en parvient, et refuser tout le monde
n'en produirait aucune.

La garde est en base et non en Go : la bibliothèque pose bien un `CloneWarning`, mais deux assertions
concurrentes le liraient toutes deux avant qu'aucune n'écrive.

### DN-7 — Le verrou d'essais est partagé avec le TOTP, et le prix est écrit
Aucun changement de schéma : `login_attempt_counters` admet `scope = 'mfa'` depuis 00007, et
`Manager.Lock`/`Fail`/`Succeed` ne connaissent aucune méthode.

Un compteur séparé pour WebAuthn était tentant — une signature ne se force pas comme six chiffres —
mais **deux gardes dont l'une masque l'autre valent une garde et une illusion**, ce que DN-7 de
step-023 a découvert en retirant le compteur par challenge.

Le prix : cinq assertions refusées tiennent l'opérateur hors de **tous** ses seconds facteurs pendant
un quart d'heure, TOTP compris. Un scénario l'exerce nommément.

### DN-8 — Retirer le dernier facteur est refusé, et la garde est une transaction **en deux
instructions**

Une transaction dont le premier geste verrouille la ligne de l'opérateur, et non une garde dans le
`WHERE` comme le plan l'annonçait : deux retraits concurrents de deux passkeys distinctes se
verraient chacun l'autre encore présente, et les deux réussiraient.

**La première rédaction du correctif était fausse, et la revue l'a réfutée par la mesure.** Elle
plaçait le `FOR UPDATE` et l'inventaire dans la **même instruction** — ce qui ne sert à rien : en
READ COMMITTED, attendre un verrou de ligne ne rafraîchit pas le snapshot de l'instruction pour les
*autres* relations. Reproduit en forçant la séquence, verrou observé dans `pg_locks` : la seconde
transaction, débloquée par le commit de la première, lisait encore `n=2` alors qu'il n'en restait
qu'une. Elle aurait supprimé la dernière.

Le verrou est donc pris dans **sa propre instruction**, et l'inventaire dans la suivante — celle-ci
prend son snapshot après l'attente, et voit ce que la précédente a commité.

Trois issues et non deux : « je n'ai rien trouvé » et « je refuse de vous enfermer dehors » ne se
disent pas de la même façon à l'opérateur.

### DN-9 — Supprimer une passkey exige l'élévation, mais pas de la présenter
DN-6 de step-023 exige de présenter le facteur qu'on remplace. La symétrie s'arrête ici : une passkey
se retire précisément quand on ne l'a plus — appareil perdu, clé cassée. L'exiger rendrait le geste
impossible dans le seul cas qui le motive.

La session élevée reste requise, et son absence rend **409 et non 401** : `notAuthenticated()` dit
« reconnectez-vous », ce qui est faux d'une session vivante — et dont le remède **boucle**, puisque se
reconnecter rend précisément une session de premier facteur. La route sœur avait raison ; la revue a
relevé l'écart.

Ce que l'élévation seule ne couvre pas est écrit dans le §6.9 : elle vaut douze heures. Ce qui reste
est borné par DN-8 et par l'audit de step-025.

**Conséquence pour step-025**, et la première rédaction se trompait. *(Correction du 29/08/2026, en
step-025 : la phrase qui suit se trompe elle aussi. Le retrait n'exige **aucune** permission —
retirer sa propre clé est du self-service, et aucune clé du catalogue n'y correspond. Voir DN-4 de
`step-025.md`. Le reste du paragraphe, sur l'audit, était juste.)* Le retrait est la seule opération
de ce préfixe qui exige une **permission**, mais **pas la seule qui écrive** : `register/finish`
insère une passkey, et les deux `begin` écrivent un défi. Exempter `/auth/mfa/*` sauf le `DELETE`
laisserait donc **l'ajout d'un second facteur partir sans écriture d'audit** — précisément
l'événement qu'une enquête sur compte compromis va chercher. `register/finish` doit être audité
même s'il reste exempté de garde de permission.

### DN-10 — Le premier facteur est libre, le suivant exige l'élévation — **sur les deux routes, et
aux deux temps de la cérémonie**

Aucun facteur enrôlé → une session de premier facteur suffit ; c'est l'amorçage. Un facteur déjà en
place — TOTP ou passkey → session élevée exigée, sans quoi quiconque détient le mot de passe se donne
un second facteur et toute la step ne garde rien.

**La revue a trouvé deux trous dans cette règle, et les deux étaient exploitables.**

Le premier : `POST /auth/mfa/totp/enroll` jugeait « un facteur est-il en place ? » sur
`mfa_totp_secret IS NOT NULL`. Une passkey n'y comptait pas. Un opérateur qui n'avait qu'une passkey
se faisait donc enrôler une application d'authentification par quiconque détenait son mot de passe —
l'enrôlement rendant le secret **et** dix codes de récupération —, puis la vérification élevait la
session sans que la clé ait jamais été présentée. Le scénario qui le garde a d'abord rendu 200.

La preuve ne peut pas être présentée sur cette route : son corps ne déclare que `totp` et
`recovery_code`, et y ajouter `webauthn` ferait passer une assertion par un champ `code`. C'est donc
l'élévation qui en tient lieu.

Le second : la garde ne vivait que sur `register/begin`. Le défi vit cinq minutes et la session
survit à l'élévation : une cérémonie ouverte à l'amorçage — quand elle était légitimement libre —
attachait encore une passkey cinq minutes plus tard, sur une session jamais élevée, à un compte qui
en portait désormais un. Elle est rejouée à la finition.

### DN-11 — Les options de cérémonie sont un DTO déclaré, pas le type de la bibliothèque
La règle d'or est sans réserve. Le contrat déclare les champs dont le client a besoin pour appeler
`navigator.credentials.create()` et `.get()`, et rien d'autre — pas d'extensions, pas de préférence
d'attestation, que nous ne demandons pas.

L'asymétrie avec les corps **reçus**, qui sont des objets libres, est délibérée : c'est en sortie que
déclarer garde quelque chose, puisqu'un champ absent du struct ne peut pas fuir. En entrée, un champ
non déclaré est simplement ignoré, et retyper la réponse d'un authentificateur en ferait deux
rédactions dont une périmerait.

**`additionalProperties: true` sur les deux objets libres n'est pas décoratif**, et c'est une mesure :
sans lui, `openapi-typescript` rend `Record<string, never>`, un type où aucune clé ne peut être
écrite. Relevé sur le fichier engendré, avant qu'un écran de step-027 n'en dépende.

### DN-12 — L'authentificateur du harnais est `descope/virtualwebauthn` v1.0.5
Dépendance de test. Elle est épinglée sur `go-webauthn v0.16.5` et n'avait donc jamais vu les
validations durcies de 0.18.0. Les deux qui pouvaient mordre ont été vérifiées sur sa source avant
l'écriture — elle émet bien `rawId`, désormais exigé, et un authentificateur sans option n'émet aucune
sortie d'extension, que la bibliothèque rejette maintenant par défaut. Les onze scénarios le
confirment sur le livré.

---

## Mutations — mesurées une par une, `-count=1`, sur un dépôt commité

| Mutation appliquée | Ce qui est tombé |
|---|---|
| **compteur non monotone** (`$2::bigint >= 0`) | `TestLeCompteurDeSignatureNAvanceQue` |
| **le zéro refusé** — garde rendue *plus stricte* | `TestUnCompteurToujoursAZeroEstAccepte` |
| **le verdict du compteur jeté** (`return true, err`) | « une clé d'accès dont le compteur a reculé est refusée » |
| `user_verified` affecté au lieu d'être latché | `TestLaVerificationDeLUtilisateurNeRecuePas` |
| `purpose` retiré du `WHERE` | `TestUnDefiDAssertionNeSeRelitPasCommeUnEnregistrement` |
| session retirée du `WHERE` | `TestLeDefiDUneAutreSessionNeSeRelitPas` |
| l'ouverture n'éteint plus le défi précédent | `TestOuvrirUneCeremonieEteintCelleQuElleRemplace` |
| usage unique retiré du `WHERE` | `TestUnDefiDeCeremonieSeRelitEtNeSeConsommeQuUneFois` |
| appartenance de la passkey (`!mine`) retirée | `TestRetirerLaPasskeyDUnAutreOperateurNeLaTrouvePas` |
| **`FOR UPDATE` et inventaire dans la même instruction** | `TestUnRetraitConcurrentNEmportePasLaDernierePasskey` |
| **retrait du dernier facteur autorisé** | `TestRetirerLaDernierePasskeySansTOTPEstRefuse` + le scénario |
| **défi jamais consommé** | `TestUnDefiDeCeremonieSeRelitEtNeSeConsommeQuUneFois` |
| origines élargies, **assertion toujours liée** | **rien — et c'est le témoin** |
| origines élargies **et assertion déliée** | « une assertion signée pour une autre origine est refusée » |
| origines élargies, **enregistrement toujours lié** | **rien — second témoin** |
| origines élargies **et enregistrement délié** | « une clé d'accès enregistrée depuis une autre origine est refusée » |
| **élévation non exigée à l'ajout** (`register/begin`) | « enregistrer une clé d'accès sans avoir franchi le facteur en place » |
| **élévation non rejouée à la finition** | « une cérémonie ouverte avant qu'un facteur n'existe ne l'attache pas après » |
| **élévation non exigée au retrait** | « retirer une clé d'accès sans avoir franchi le second facteur » |
| **`EnrollTotp` aveugle aux passkeys** | « enrôler une application d'authentification sans franchir la clé en place » |
| identifiant comparé en `uuid` et non en texte | « un identifiant de clé d'accès mal formé est refusé sur sa forme » |
| retrait qui rend 409 au lieu de 204 | « retirer une clé d'accès quand il en reste une autre réussit » |
| verrou d'essais non consulté | quatre scénarios, dont deux de TOTP et le croisé |
| `passkeys: string`, `passkeyId: number`, `method` sans `webauthn`, finition sans 409 | `typecheck-web`, une erreur chacune |

### Ce que les mutations ont trouvé, avant la revue

**Un scénario qui se lisait bien et ne gardait pas ce qu'il prétendait.** « Un défi d'assertion déjà
servi ne se rejoue pas » restait vert avec la consommation du défi entièrement retirée : sur le chemin
d'assertion, le challenge de premier facteur est consommé au succès et refuse le rejeu bien avant que
le défi de cérémonie n'ait son mot à dire. Il gardait donc l'anti-rejeu de step-023. Déplacé sur
l'enregistrement, qui n'exige aucun challenge.

**Deux pièges de mesure, tous deux lisibles comme des succès :**

- Des mutations SQL écrites `AND $n IS NOT NULL` **rougissaient pour la mauvaise raison** :
  PostgreSQL perd le typage d'un paramètre qui n'apparaît plus ailleurs. Refaites avec un cast
  explicite, chacune fait tomber exactement le test qui la garde.
- La première mutation de l'anti-rejeu retirait la lecture du verdict de `ConsumeCeremony` **sans
  cesser de consommer** : elle ne retirait donc pas la garde.

Et un piège de méthode : le script qui jouait les mutations lisait les lignes `--- FAIL` au lieu du
code de retour de `go test`. Une mutation qui cassait la compilation se lisait « verte ».

### Ce que la revue a trouvé, et qu'aucune mutation n'avait vu

Trois lectures indépendantes, chacune sur un angle. Elles ont trouvé **deux failles exploitables** que
les treize premières mutations n'atteignaient pas — parce qu'on ne mute que ce qu'on a pensé à écrire.

1. **Un opérateur qui n'avait qu'une passkey n'était protégé par rien.** `EnrollTotp` jugeait sur
   `mfa_totp_secret IS NOT NULL` ; une passkey n'y comptait pas. La PR créait le trou en ajoutant un
   second type de facteur sans élargir la garde de l'autre chemin.
2. **La garde du dernier facteur ne tenait pas**, et sa première correction non plus : `FOR UPDATE` et
   inventaire dans la même instruction ne sérialisent rien. Réfuté par la mesure, verrou observé dans
   `pg_locks`.

Plus quatre gardes qu'aucun test ne tenait — le verdict du compteur de signature, le liage d'origine
de l'**enregistrement**, l'élévation au **retrait**, et la fenêtre entre l'ouverture d'une cérémonie
et sa finition. Chacune a désormais son scénario, et chacune a été mutée.

Et deux défauts de forme : un `passkeyId` qui n'est pas un UUID rendait **500**, statut que le contrat
ne déclare pas ; une clé déjà enregistrée ailleurs violait l'index et rendait **500** aussi, ce qui en
faisait un oracle — 500 contre 200 disait à qui détient un authentificateur s'il est enrôlé quelque
part dans le déploiement.

**Un correctif en a masqué un autre**, et c'est le genre d'effet qu'on ne voit qu'en remutant : traiter
la clé déjà enregistrée comme un refus a intercepté le rejeu d'attestation *avant* l'anti-rejeu, et
rejouer la garde d'élévation à la finition a rendu deux scénarios inopérants. Les trois mutations
correspondantes, vertes après coup, ont été remesurées et les scénarios réparés.

## Ce qui n'est pas testé, et pourquoi

- **Deux scénarios sont doublés** et ne gardent pas seuls ce qu'ils nomment : le rejeu d'attestation
  est intercepté par le refus de clé déjà enregistrée, et « un défi d'assertion ne finit pas un
  enregistrement » n'atteint jamais l'analyseur puisque le décor a déjà consommé le défi
  d'enregistrement. Le constat est écrit au-dessus de chacun ; les deux gardes sont tenues par les
  unitaires de `internal/store`, qui rougissent.
- **`WithExclusions` n'est gardé par rien**, et ne garde rien : vérifié dans la bibliothèque,
  `CreateCredential` ne consulte jamais la liste d'exclusion — c'est un indice pour le client. La
  garde réelle est l'index unique, qui a son test.
- **Aucune attestation n'est vérifiée** : nous ne consultons aucun registre de métadonnées, donc le
  modèle d'authentificateur n'est pas contrôlé.
- **Le refus de démarrage sur un `rp_id` en adresse IP n'a pas de scénario.** Vérifié à la main sur le
  binaire — il refuse en nommant la cause, avant de lier son port — mais le pas de configuration
  existe et aurait pu le porter. C'est une dette, pas une impossibilité.

## Definition of Done
- [x] `make check` vert, `make e2e` vert
- [x] la politique sur le compteur à zéro est écrite, avec le cas légitime qu'elle admet
- [x] la mutation « lire `origin` dans la requête » fait rougir — jouée en deux temps sur **les deux**
      cérémonies, chacune avec son témoin
- [x] la mutation « accepter un défi déjà consommé » fait rougir — au store ; au niveau scénario elle
      est doublée par le refus de clé déjà enregistrée, et le constat est écrit
- [x] la mutation « ignorer le compteur de signature » fait rougir — **au SQL et au produit**. La
      première rédaction de cette case sur-affirmait : elle était vraie du `WHERE` et fausse du
      verdict, que rien ne tenait. La revue l'a mesuré, un scénario le garde désormais
- [x] la mutation « autoriser le retrait du dernier facteur » fait rougir — et la garde elle-même a dû
      être refaite : sa première forme ne sérialisait rien

## Suivis ouverts

**Chacun est désormais inscrit dans la fiche de la step qui le paiera**, et pas seulement ici : une
fiche de `done/` n'est ouverte par personne, et le renvoi doit aller vers la step qui paie plutôt que
depuis celle qui a créé. Ce qui suit reste la trace, pas le porteur.

### Ont trouvé leur porteur

| Dette | Inscrite dans |
|---|---|
| `register/begin` et `assert/begin` ne sont bornés par aucun compteur | `step-025.md`, périmètre |
| `register/finish` doit être audité même exempté de garde | `step-025.md`, périmètre |
| Le retrait d'une passkey doit sortir des exemptions | `step-025.md`, périmètre |
| Aucune passkey ne porte de nom | `step-028.md`, périmètre |
| Le premier enrôlement est libre pour toute session de premier facteur | `step-029.md`, périmètre |

### N'en ont pas, et c'est assumé

1. **`displayName` est codé en dur** (`internal/mfa/webauthn.go`), comme l'`issuer` du TOTP : deux
   déploiements du même produit s'affichent sous le même nom dans l'appareil de l'opérateur. La sortie
   est une variable de plus, le jour où il y a une préproduction — aucune step planifiée n'en a une.
2. **« Un seul défi vivant par session et par objet » est une propriété que l'ouverture produit, et
   qu'aucun index n'impose.** Deux ouvertures concurrentes ne se voient pas et insèrent toutes deux ;
   la lecture prend le plus récent, ce qui rend le comportement déterministe sans rendre l'invariant
   vrai. Conséquence réelle : un double-clic peut faire consommer le défi de l'autre onglet et refuser
   une cérémonie légitime. Un index unique partiel `(session_id, purpose) WHERE consumed_at IS NULL`
   le tiendrait, mais entre en tension avec la CTE qui éteint le précédent dans la même commande — à
   mesurer avant d'y toucher, pas à écrire de confiance.
3. **Un authentificateur au compteur cassé verrouille l'opérateur sur tous ses facteurs.** Cinq
   assertions refusées pour compteur reculé ferment aussi le TOTP et les codes de récupération, un
   quart d'heure. C'est DN-7 appliqué à un mode d'échec légitime. Le découpler rouvrirait le trou que
   DN-7 ferme ; le laisser expose un opérateur au matériel défaillant. Aucune des deux sorties n'est
   évidente.
4. **`descope/virtualwebauthn` est épinglée sur `go-webauthn v0.16.5`.** Elle fonctionne contre
   0.18.0 — les scénarios le montrent — mais un durcissement futur de la bibliothèque serveur pourrait
   la mettre en défaut, et le symptôme serait une suite rouge sans cause lisible dans le produit. Le
   repli est écrit dans DN-12 : un authentificateur à la main, ~150 lignes.
5. **Le scénario du `rp_id` en adresse IP ne garde pas l'ordre.** Il garde que le domaine vient de la
   configuration et qu'un domaine inutilisable arrête le démarrage. Mesuré, la construction déplacée
   après `net.Listen` le laisse vert : il observe la sortie du process, pas son écoute. L'ordre est
   tenu par un commentaire et par rien d'autre.

## Hors périmètre
L'exigence de second facteur sur les écritures → step-025. Le choix d'affichage entre passkey et TOTP,
et la détection du support par le navigateur → step-028. La réinitialisation du second facteur d'un
autre opérateur → step-029. La purge des défis morts → step-187.

## Ses dettes ont un porteur depuis le 31/08/2026

Elles sont inscrites au **registre de `tasks/todo.md`**, qui les rassemble toutes et que
`TestChaqueDetteNommeUnPorteurQuiExisteEtResteAFaire` empêche de nommer une step inexistante ou déjà
cochée. Le texte ci-dessus n'est pas réécrit : il dit ce qui a été mesuré à la date où il a été
écrit.

Ce qui a changé n'est pas le constat, c'est qu'il cesse de n'exister que dans une fiche archivée —
« une fiche archivée n'est ouverte par personne », et c'était vrai des quarante-neuf.

Le `displayName` codé en dur → **step-031**. L'authentificateur au compteur cassé → **step-029**.
L'index du défi unique → **step-187**. `virtualwebauthn` épinglée → **step-032**. L'ordre du `rp_id`
→ **step-186**.
