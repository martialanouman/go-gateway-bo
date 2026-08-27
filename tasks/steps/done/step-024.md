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

### DN-8 — Retirer le dernier facteur est refusé, et la garde est une transaction
Une transaction dont le premier geste verrouille la ligne de l'opérateur, et non une garde dans le
`WHERE` comme le plan l'annonçait. La correction vient d'un raisonnement, pas d'un échec : deux
retraits concurrents de deux passkeys distinctes se verraient chacun l'autre encore présente — les
sous-requêtes lisent le snapshot de leur instruction, pas l'effet d'une transaction voisine non
commitée — et les deux réussiraient.

Trois issues et non deux : « je n'ai rien trouvé » et « je refuse de vous enfermer dehors » ne se
disent pas de la même façon à l'opérateur.

### DN-9 — Supprimer une passkey exige l'élévation, mais pas de la présenter
DN-6 de step-023 exige de présenter le facteur qu'on remplace. La symétrie s'arrête ici : une passkey
se retire précisément quand on ne l'a plus — appareil perdu, clé cassée. L'exiger rendrait le geste
impossible dans le seul cas qui le motive.

Ce que l'élévation seule ne couvre pas est écrit dans le §6.9 : elle vaut douze heures. Ce qui reste
est borné par DN-8 et par l'audit de step-025.

**Conséquence pour step-025** : cette opération est la **seule mutation** de son préfixe. Elle doit
être gardée, donc hors de la liste d'exemptions `/auth/mfa/*` que `step-025.md:37` déclare. Les quatre
autres opérations y restent.

### DN-10 — Le premier facteur est libre, le suivant exige l'élévation
Aucun facteur enrôlé → une session de premier facteur suffit ; c'est l'amorçage. Un facteur déjà en
place — TOTP ou passkey → session élevée exigée, sans quoi quiconque détient le mot de passe se donne
un second facteur et toute la step ne garde rien.

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
| `user_verified` affecté au lieu d'être latché | `TestLaVerificationDeLUtilisateurNeRecuePas` |
| `purpose` retiré du `WHERE` | `TestUnDefiDAssertionNeSeRelitPasCommeUnEnregistrement` |
| session retirée du `WHERE` | `TestLeDefiDUneAutreSessionNeSeRelitPas` |
| l'ouverture n'éteint plus le défi précédent | `TestOuvrirUneCeremonieEteintCelleQuElleRemplace` |
| **retrait du dernier facteur autorisé** | `TestRetirerLaDernierePasskeySansTOTPEstRefuse` + le scénario |
| **défi jamais consommé** | « une attestation d'enregistrement déjà servie ne se rejoue pas » |
| origines élargies, **cérémonie toujours liée** | **rien — et c'est le témoin** : le refus tient par le liage, pas par la configuration |
| origines élargies **et cérémonie déliée** | « une assertion signée pour une autre origine est refusée » |
| élévation non exigée à l'ajout d'un facteur | « enregistrer une clé d'accès sans avoir franchi le facteur en place » |
| verrou d'essais non consulté | trois scénarios, dont deux de TOTP — le seau est bien partagé |
| `passkeys: string`, `passkeyId: number`, `method` sans `webauthn` | `typecheck-web`, une erreur chacune |

### Ce que les mutations ont trouvé

**Un scénario qui se lisait bien et ne gardait pas ce qu'il prétendait.** « Un défi d'assertion déjà
servi ne se rejoue pas » restait vert avec la consommation du défi entièrement retirée : sur le chemin
d'assertion, le challenge de premier facteur est consommé au succès et refuse le rejeu bien avant que
le défi de cérémonie n'ait son mot à dire. Il gardait donc l'anti-rejeu de step-023. Le rejeu porte
désormais sur l'enregistrement, qui n'exige aucun challenge — le défi y est la seule garde.

**Deux pièges de mesure, tous deux lisibles comme des succès :**

- Trois mutations SQL écrites `AND $n IS NOT NULL` **rougissaient pour la mauvaise raison** :
  PostgreSQL perd le typage d'un paramètre qui n'apparaît plus ailleurs, et l'erreur était
  `could not determine data type of parameter`. Refaites avec un cast explicite, chacune fait tomber
  exactement le test qui la garde, et rien d'autre.
- La première mutation de l'anti-rejeu retirait la lecture du verdict de `ConsumeCeremony` **sans
  cesser de consommer** : elle ne retirait donc pas la garde. C'est le même défaut que les mutations
  à sens unique du chiffrement, en step-023.

Et un piège de méthode : le script qui jouait les mutations lisait les lignes `--- FAIL` au lieu du
code de retour de `go test`. Une mutation qui cassait la compilation se lisait « verte ». Tout a été
remesuré sur `rc`.

**Un défaut introduit puis refermé dans le même diff.** `presentedFactorIsWellFormed` convertissait la
méthode d'enrôlement vers l'enum de la vérification, qui venait de gagner `webauthn` : un `webauthn`
envoyé à `enrollTotp` serait devenu bien formé, puis serait parti sur le repli TOTP.

**Trois textes faux hérités de step-023**, trouvés en amendant le §3.1 et corrigés : la colonne
`mfa_challenges.failures` que le §3.1 **et** le contrat décrivaient encore alors que la revue de
step-023 l'avait retirée, et `login_attempt_counters.scope` qui y valait `(email|source)` alors que
00007 admet `mfa`.

## Ce qui n'est pas testé, et pourquoi

- **Le compteur de signature n'est pas observé par un scénario.** Un authentificateur virtuel qui
  reculerait son compteur ne dirait rien du produit — il dirait ce que le harnais a bien voulu écrire.
  La monotonie vit dans un `UPDATE` et s'observe dans `internal/store`, où elle est mutée.
- **Deux scénarios ne gardent pas seuls ce qu'ils nomment**, et le constat est écrit au-dessus de
  chacun : « un défi d'assertion ne finit pas un enregistrement » reste vert le `purpose` retiré,
  parce que l'analyseur d'attestation refuse de toute façon une réponse d'assertion ; « le défi ouvert
  dans une autre session n'élève rien » reste vert la session retirée, parce que se reconnecter ferme
  la session et que la clé étrangère emporte ses défis. Deux gardes chaque fois, et c'est le `WHERE`
  qui compte — tenu par les unitaires, qui rougissent tous les deux.
- **Aucune attestation n'est vérifiée** : nous ne consultons aucun registre de métadonnées, donc le
  modèle d'authentificateur n'est pas contrôlé. Une valeur qu'on ne contrôle pas vaut moins que son
  absence.

## Definition of Done
- [x] `make check` vert, `make e2e` vert
- [x] la politique sur le compteur à zéro est écrite, avec le cas légitime qu'elle admet
- [x] la mutation « lire `origin` dans la requête » fait rougir — jouée en deux temps, voir le tableau
- [x] la mutation « accepter un défi déjà consommé » fait rougir
- [x] la mutation « ignorer le compteur de signature » fait rougir
- [x] la mutation « autoriser le retrait du dernier facteur » fait rougir

## Suivis ouverts

1. **`displayName` est codé en dur** (`internal/mfa/webauthn.go`), comme l'`issuer` du TOTP : deux
   déploiements du même produit s'affichent sous le même nom dans l'appareil de l'opérateur. Même
   suivi que le n°3 de step-023, et la même sortie — une variable de plus, le jour où il y a une
   préproduction.
2. **`POST /auth/mfa/webauthn/register/begin` n'est borné par aucun compteur**, exactement comme
   `enrollTotp` : une session de premier facteur suffit à le répéter. À borner par step-025, qui
   reprend ce chemin. Le coût y est en revanche bien moindre — une cérémonie ne hache rien.
3. **Le premier enrôlement reste libre pour toute session de premier facteur**, hérité de step-023 :
   sur un déploiement neuf, un mot de passe volé pendant cette fenêtre vaut un compte complet. C'est
   le problème d'amorçage classique du MFA ; la fenêtre mérite d'être bornée quand step-029 saura
   enrôler pour le compte d'un autre.
4. **`descope/virtualwebauthn` est épinglée sur `go-webauthn v0.16.5`.** Elle fonctionne contre
   0.18.0 — les onze scénarios le montrent — mais un durcissement futur de la bibliothèque serveur
   pourrait la mettre en défaut, et le symptôme serait une suite rouge sans cause lisible dans le
   produit. Le repli est écrit dans DN-12 : un authentificateur à la main, ~150 lignes.
5. **Aucune passkey ne porte de nom.** step-028 devra en donner un pour que l'écran distingue deux
   appareils ; la colonne s'écrira avec la step qui saura ce qu'elle doit contenir, comme step-005 l'a
   fait pour `sessions`.

## Hors périmètre
L'exigence de second facteur sur les écritures → step-025. Le choix d'affichage entre passkey et TOTP,
et la détection du support par le navigateur → step-028. La réinitialisation du second facteur d'un
autre opérateur → step-029. La purge des défis morts → step-187.
