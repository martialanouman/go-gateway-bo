# step-023 — MFA TOTP : enrôlement, vérification, codes de récupération

> **Jalon :** M1 (§6.9) · **Statut :** FAIT (12/08/2026)
> **Dépend de :** step-022 · **Bloque :** step-025, step-028

## But
Le second facteur qui marche partout, y compris sur un poste sans authentificateur de plateforme :
une application TOTP, des codes de récupération pour le jour où le téléphone est perdu, et un secret
qui ne se réaffiche jamais.

## Périmètre (ce que fait CETTE PR)
- `pquerna/otp` : génération du secret, URI `otpauth://`, vérification avec fenêtre de dérive
  **écrite et justifiée**.
- `POST /auth/mfa/totp/enroll` et `POST /auth/mfa/verify` : le second facteur élève la session de
  step-022. Le verrou d'essais par opérateur (migration 00007) est venu de la revue, pas du plan.
- Secret **chiffré au repos** (AES-GCM, `DASHBOARD_TOTP_ENCRYPTION_KEY`) dans
  `operators.mfa_totp_secret`.
- **Anti-rejeu** : le dernier pas consommé est mémorisé par opérateur, un code déjà servi est refusé.
- Dix **codes de récupération**, hachés comme un mot de passe (step-021), montrés une seule fois, à
  usage unique, avec le compte des codes restants.
- La migration qu'exigent l'anti-rejeu et les codes de récupération : le §3.1 ne les déclare pas, et
  step-005 a renvoyé ce qu'elle ne savait pas encore décrire « à la step qui le spécifiera ».

---

## Décisions notables

### DN-1 — `verify` exige le cookie **et** le challenge
Le cookie dit *qui*, le challenge dit *« le mot de passe vient d'être présenté, il y a moins de cinq
minutes »*. Aucun des deux ne dit ce que dit l'autre : sans le challenge, une session de premier
facteur volée resterait élevable pendant douze heures par qui obtient un code. C'est aussi le
consommateur que `logins.go` réservait explicitement à cette step — sans lui, `mfa_challenges` restait
une table qu'on émet et que rien n'atteint. Consommé **sur succès seulement** : une faute de frappe ne
doit pas obliger à refaire toute la connexion.

### DN-2 — L'anti-rejeu est **monotone**, pas « pas deux fois le même »
`operators.mfa_totp_last_step`, et un code n'est accepté que si son pas est **strictement** au-delà du
dernier consommé. Avec une fenêtre de ±1 pas, refuser seulement l'identique laisserait rejouer le code
du pas précédent, encore dans la fenêtre. L'atomicité vient du `WHERE` : `RowsAffected() > 0` **est**
le verdict, et deux requêtes concurrentes se sérialisent sur le verrou de ligne.

### DN-3 — Le pas se calcule sur l'horloge de **PostgreSQL**
DN-9 de step-022 appliquée telle quelle. Rien dans `internal/mfa` ne lit d'horloge : le pas arrive en
argument. C'est pourquoi `totp.Validate` n'est employé nulle part — seul `hotp.ValidateCustom`, qui
prend le compteur en argument.

### DN-4 — Deux chemins d'enrôlement, un seul de vérification
Les deux enrôlements rendent des formes différentes — un secret et une URI d'un côté, des options de
cérémonie de l'autre — donc un `oneOf` de réponse dont oapi-codegen fait un type opaque. Les deux
vérifications rendent le même 204, donc un corps discriminé suffit et l'opération reste unique. Le
§5.1 est **amendé**, avec la raison écrite là où la route est déclarée.

### DN-5 — `verify` rend 204, et le client redemande `/auth/me`
`/auth/me` est le **seul** endroit d'où le client apprend ses droits ; en faire un second qui rende
aussi les permissions garantirait qu'ils divergent. C'est `Me` qui gagne `secondFactors` — un booléen
et un compte, ce dont step-027 et step-028 ont besoin, et rien qui se rejoue.

### DN-6 — Le remplacement exige de **présenter le facteur qu'il détruit**

Le premier enrôlement est libre : il faut bien pouvoir entrer une première fois, et il n'y a rien à
prouver. Le remplacement détruit le secret en place **et ses dix codes de récupération** — il exige
donc de présenter l'un ou l'autre.

Le bit `elevated` seul n'y suffisait pas : il vaut douze heures, donc un cookie de session élevée capté
suffisait à évincer définitivement l'opérateur. Le geste qui détruit un facteur était protégé moins que
celui qui l'utilise, lequel exige un challenge frais de cinq minutes.

**Et le challenge frais, qui était le correctif retenu d'abord, est inutilisable** : se reconnecter
pour en obtenir un ferme la session présentée — c'est la remédiation de step-022 — donc la désélève.
Exiger l'élévation *et* un challenge frais rendait le remplacement inatteignable. Mesuré : le scénario
qui l'exerçait rendait 409 en boucle. C'est le scénario qui l'a dit, pas la relecture.

Un code du facteur en place est par ailleurs une preuve **plus forte** que le mot de passe. Un code de
récupération convient aussi : celui qui a perdu son téléphone est précisément celui qui veut
réenrôler, et n'accepter qu'un code TOTP en ferait une impasse.

Pas d'état « en attente de confirmation » : le mode d'échec « je n'ai pas scanné » se rattrape par un
code de récupération, montré au même écran et à la même seconde.

### DN-7 — Un verrou d'essais **par opérateur**, et la fausse arithmétique qui l'a fait manquer

La première rédaction bornait les essais **par challenge** — cinq — et en déduisait « cinq tentatives
de connexion par quart d'heure, donc cinq challenges, donc vingt-cinq essais ». **C'était faux**, et la
source le disait : `RecordFailure` n'est appelé que depuis le chemin d'**échec** de `auth.Login`, et le
chemin de succès appelle `ClearFailures`. Une connexion réussie n'incrémente aucun compteur. Qui
détient le mot de passe émet donc autant de challenges qu'il veut, depuis une seule adresse, sans
qu'aucun verrou ne le voie : de l'ordre de 231 000 essais pour une chance sur deux, soit quelques
heures.

La migration 00007 ajoute une troisième dimension à `login_attempt_counters`, sur l'identifiant de
l'opérateur, et réutilise tel quel l'incrément atomique de step-021. Cinq essais par quart d'heure sur
10⁶ codes dont trois sont valables à la fois : une chance sur deux demanderait de l'ordre de
quatre-vingts ans.

*(Correction du 29/08/2026, en step-025 : ce chiffre est faux d'un facteur soixante. Sur ses propres
prémisses — 231 000 essais pour une chance sur deux, 175 200 essais par an à cinq par quart d'heure —
le verrou achète de l'ordre de **seize mois**. Le calcul refait est dans `internal/mfa/manager.go`.
step-025 a par ailleurs fermé un second seau que l'enrôlement ouvrait, et qui divisait ce délai par
deux.)*

Le verrou est consulté **avant** toute dépense — sinon il protégerait le compte sans
protéger le serveur — et son franchissement rend un 429 avec sa durée, comme la connexion.

**Le compteur par challenge disparaît avec lui.** Au même seuil, celui de l'opérateur compte à travers
toutes les connexions, donc il mord toujours le premier : celui du challenge n'était plus observable,
ni par un test ni par une mutation. Deux gardes dont l'une masque l'autre valent une garde et une
illusion.

Le prix, écrit plutôt que tu : le verrou porte sur l'opérateur, donc qui détient son mot de passe peut
le tenir hors de son propre second facteur, un quart d'heure à la fois. Ce n'est pas une capacité
neuve — cinq mots de passe faux verrouillent déjà son adresse depuis 00004.

### DN-8 — Fenêtre de dérive : ±1 pas

C'est exactement ce que `totp.Validate` emploie — `Skew: 1`, lu dans `totp/totp.go:34-49` de la
v1.5.0 — donc ce que les applications compatibles Google Authenticator supposent.

**Une rédaction précédente affirmait le contraire**, « le défaut de la bibliothèque est zéro, relevé et
non supposé » : ce zéro est la valeur zéro du **champ** `ValidateOpts.Skew`, que la documentation
décrit, et non ce que la fonction fait. Le chiffre était juste, l'objet mesuré ne l'était pas — le même
défaut que « une mesure sur un proxy » en step-022. L'arbitrage ne bouge pas ; sa raison, si.

Zéro refuserait un téléphone en avance d'une seconde ; deux doubleraient la durée pendant laquelle un
code intercepté vaut encore. SHA-1, six chiffres, 30 s, secret de 20 octets : arbitrage
d'interopérabilité et non de sécurité. Ce qui protège est le secret.

### DN-9 — AES-256-GCM, clé dérivée par HKDF, **identifiant d'opérateur en données associées**
La passphrase est lue par le `requiredSecret` existant, même seuil et même recette que les deux autres
secrets ; `crypto/hkdf` en dérive les trente-deux octets. Sans les données associées, un `UPDATE` qui
recopie la colonne d'une ligne sur une autre donnerait à un opérateur le second facteur d'un autre, et
rien ne le refuserait. Le format porte sa marque (`v1.`).

### DN-10 — Dix codes de récupération, argon2id, **détruits** à la consommation
Base32 de Crockford, dix caractères, cinquante bits. Argon2id et non SHA-256, à l'inverse du jeton de
challenge et de celui de session : ces deux-là font 256 bits tirés d'un CSPRNG, sans déficit
d'entropie à compenser. Cinquante bits se parcourent en quelques dizaines d'heures contre du SHA-256.
Détruit et non marqué : rien à réafficher, donc rien à fuir.

### DN-11 — `Elevate` prend un identifiant de session, pas le cookie présenté
Le handler strict n'a pas la requête : passer par l'empreinte obligerait à faire voyager le cookie
dans le contexte, donc à promener un secret plus loin qu'il n'a besoin d'aller. Le middleware a déjà
résolu la session, donc le handler tient sa clé primaire — comme `Close`. Le test jumeau de
`session_test.go` disparaît avec le paramètre qu'il gardait, et c'est une garde plus forte : il n'y a
plus de cookie sur ce chemin.

---

## Tableau des mutations — **mesurées, pas prévues**

Vingt et une mutations, jouées une par une sur un dépôt commité, avec `-count=1`. Les treize premières
à la livraison (12/08/2026), les huit dernières après la revue.

| Mutation appliquée | Ce qui est tombé |
|---|---|
| **anti-rejeu retiré** (`WHERE` inconditionnel) | 2 unitaires + « le même code deux fois » et « le pas précédent » |
| **anti-rejeu réduit à l'égalité** (`<>` au lieu de `<`) | `TestUnPasAnterieurAuDernierConsommeEstRefuse` + « le pas précédent ne se rejoue pas non plus » |
| **fenêtre élargie à ±10 pas** | `TestUnCodeADeuxPasEstRefuse` + « le code à deux pas est refusé » |
| **secret stocké en clair** (chiffrement **et** déchiffrement) | `TestCeQuiVaEnBaseNEstPasLeSecretEnClair` + 3 |
| **code de récupération marqué au lieu d'être détruit** | 2 unitaires + « un code de récupération ouvre une fois et une seule » |
| **`ConsumeChallenge` rend vrai sans écrire** | `TestUnChallengeNeSeConsommeQuUneFois`, `TestUnChallengeConsommeResteEnBase` |
| **le handler n'appelle plus `ConsumeChallenge`** | « un challenge déjà servi ne ressert pas » |
| **contrôle d'appartenance du challenge retiré** | « le challenge d'un autre opérateur n'élève rien » |
| **données associées retirées** (des deux côtés) | `TestUnSecretDeplaceSurUneAutreLigneNeSeDechiffrePas`, et rien d'autre |
| **exigence de preuve retirée du remplacement** | « remplacer son authentificateur en présentant son code réussit » |
| **jeton de session non régénéré à l'élévation** | `TestLElevationInvalideLeJetonPrecedent` + 6 scénarios |
| **`.Strict()` retiré de `ChallengeDigest`** | `TestUnChallengeNonCanoniqueNEstPasLeMemeChallenge`, ses trois cas |
| **nonce constant sous GCM** | `TestDeuxChiffrementsDuMemeSecretSousLaMemeCleDifferent` |
| **`ConsumeChallenge` appelé *aussi* sur échec** | « une faute de frappe n'oblige pas à refaire la connexion » + 2 |
| **`!state.Enrolled` retiré** | « présenter un code sans avoir enrôlé est refusé, pas une panne » |
| **bornes de forme retirées** (`maximumCodeLength`, `Method.Valid()`) | « une requête de second facteur mal formée est refusée sur sa forme » |
| **correspondance de Crockford altérée** (`I→7`, `O→9`) | `TestLesConfusionsDeCrockfordSontResolues`, ses trois cas |
| **verrou d'essais non consulté** | « cinq codes faux verrouillent le second facteur » + « se reconnecter ne lève pas le verrou » |
| **arrêt au premier code de récupération qui colle** | **rien — verte, et le constat est écrit au-dessus de la ligne** |

## Ce que les mutations et la revue ont trouvé

**Onze gardes n'étaient tenues par rien**, et leurs tests ont tous été écrits *après* la mesure qui les
a trouvées nues. Les cinq qui comptent :

- **le contrôle d'appartenance du challenge.** Sans lui, le challenge dirait « un mot de passe vient
  d'être présenté quelque part » : quiconque en obtient un élèverait la session d'un autre.
- **l'appel du handler à `ConsumeChallenge`.** Le store savait refuser un challenge déjà servi, mais
  rien n'exigeait qu'on l'appelle — un challenge de cinq minutes aurait valu douze heures.
- **le `.Strict()` de `ChallengeDigest`.** Le jeton fait quarante-trois caractères base64url dont le
  dernier ne porte que deux bits significatifs : sans lui, quatre valeurs distinctes ouvraient la même
  ligne. C'est le piège déjà payé en step-022, sur le sceau du cookie.
- **le nonce de GCM.** Le test qui prétendait le garder comparait les chiffrés de deux secrets
  **différents** — vrai quel que soit le nonce. Douze zéros constants le laissaient vert. Le vrai test
  vit dans le paquet, parce que `seal` n'est pas exporté.
- **« le challenge n'est pas consommé sur échec »**, la propriété centrale de DN-1, qu'aucun scénario
  n'observait — donc le produit pouvait régresser vers « une faute de frappe = refaire la connexion ».

**Quatre pièges de mesure**, consignés parce qu'ils se relisent tous comme des succès :

- deux mutations ne touchaient qu'**un sens** du chiffrement : elles cassaient l'aller-retour, que
  n'importe quel test de vérification attrape, au lieu de perdre la propriété visée ;
- « le jeton non régénéré » écrivait `coalesce($2, token_hash)`, où `$2` n'est jamais nul — un no-op ;
- le **cache de `go test`** a rendu une mutation verte. Tout a été refait avec `-count=1` ;
- `elevation()`, dans le harnais, ne lisait jamais le statut de `/auth/me` : un corps d'erreur se
  démarshalait en zéros, donc « le second facteur n'est pas encore vérifié » — le pas négatif de six
  scénarios — était vert sur *toute* réponse qui n'était pas un 200. C'est ce qui rendait invisible la
  garde du challenge non consommé.

## Ce qui n'est pas testé, et pourquoi

- **L'arrêt au premier code de récupération** — le seul rouge manquant. Ce qui le garderait est un test
  de durée sur un écart de 260 ms, que le dépôt écarte partout pour instabilité en CI. Le constat de la
  mesure est écrit au-dessus de la boucle, comme `hmac.Equal` en step-022.
- **Un journal.** Un secret illisible en base et un hachage de code abîmé sont silencieux : aucun
  journal n'atteint encore `internal/mfa` ni `internal/auth`.
- **Trois branches de course** — `!consumed`, `!elevated` de `VerifyMfa`, `!found` de l'enrôlement — ne
  sont atteignables que par deux requêtes en vol ou une désactivation entre le middleware et le
  handler. Aucun test ne les exerce, et c'est écrit ici plutôt que couvert par un test qui ferait
  semblant.

## Definition of Done
- [x] `make check` vert et `make e2e` vert
- [x] la fenêtre de dérive et le format de chiffrement sont écrits avec leur raison
- [x] la mutation « retirer l'anti-rejeu » fait rougir
- [x] la mutation « élargir la fenêtre à ±10 pas » fait rougir
- [x] la mutation « stocker le secret en clair » fait rougir la lecture de colonne
- [x] la mutation « ne pas détruire un code de récupération consommé » fait rougir

## Hors périmètre
WebAuthn → step-024. L'exigence de second facteur sur les écritures → step-025. L'écran d'enrôlement,
le QR et le téléchargement des codes → step-028. La réinitialisation du second facteur d'un autre
opérateur → step-029.

## Suivis ouverts

*(Note de step-024 : les deux premiers ont été inscrits dans les fiches qui les paieront —
`step-025.md` pour la borne de l'enrôlement, `step-029.md` pour la fenêtre d'amorçage. Ils restaient
ici sans porteur, et une fiche de `done/` n'est ouverte par personne.)*
- **`POST /auth/mfa/totp/enroll` n'est borné par aucun compteur**, contrairement à la vérification :
  une session de premier facteur suffit à le répéter, puisqu'un remplacement seul exige une preuve.
  À borner par step-025, qui reprend ce chemin.

  **La première rédaction de ce suivi le surdimensionnait, et c'est corrigé ici** (19/08/2026). Elle
  disait « 269 ms et 64 MiB de pic » en citant l'avertissement d'`internal/auth/argon2.go` sur les
  profils à 512 MiB. Cet avertissement porte sur le pic **simultané** — or les dix hachages sont
  séquentiels. Mesuré : le pic système d'un enrôlement est de 131 MiB, **exactement celui d'un login**
  ; seul le total alloué diffère (640 contre 64 MiB), et il est transitoire. Le coût réel est donc dix
  fois plus de processeur par requête que `/auth/login`, sur une porte qui exige un mot de passe valide
  là où celle-ci est ouverte à tous. La porte la plus large existe déjà et n'est pas de cette step.
  Un raisonnement juste transposé à un objet où il ne s'applique pas — le même défaut que la revue a
  trouvé trois fois ailleurs dans cette PR.
- **Le premier enrôlement est libre pour toute session de premier facteur.** Sur un déploiement neuf,
  aucun opérateur n'est enrôlé : un mot de passe volé pendant cette fenêtre vaut un compte complet,
  second facteur compris. C'est le problème d'amorçage classique du MFA, et DN-6 l'assume — mais la
  fenêtre mérite d'être bornée le jour où step-029 saura enrôler pour le compte d'un autre.
- **L'`issuer` de l'URI `otpauth://` est codé en dur.** Deux déploiements du même produit apparaissent
  sous le même nom dans le téléphone d'un opérateur qui enrôle les deux.
- **`minimumTOTPEncryptionKeyLength` compte des caractères, pas de l'entropie.** Trente-deux `a` de
  suite passent. Le README recommande un CSPRNG ; rien ne l'applique.
- **Le conteneur PostgreSQL des scénarios meurt parfois sous la charge**, et **ce n'est pas un
  problème d'outillage local** : mesuré le 27/08/2026 en relisant le journal du job en échec de la
  PR 52, c'est lui qui a fait rougir « Tests Go » sur la CI — `connection refused` sur le port du
  conteneur, en plein milieu de la suite. Cet échec a bloqué un bump de `kin-openapi` pendant huit
  jours en faisant croire à une rupture de la bibliothèque, alors que la même version passe toute la
  suite sur un `main` à jour. Le coût n'est donc pas l'inconfort d'une suite rouge : c'est une
  dépendance qu'on n'ose plus bumper, et un diagnostic qu'il faut refaire à la main.

  *(Une rédaction du 27/08 avait annoncé le retrait de cette entrée et de la suivante, au motif
  qu'elles n'étaient pas des dettes du produit. Le retrait n'a jamais eu lieu — le message de commit
  décrivait une intention et non le diff — et il aurait été faux : la preuve ci-dessus est arrivée
  une heure plus tard.)*

  Le symptôme en local est différent et vient du même défaut : `terminating connection due to
  unexpected postmaster exit`, observé deux fois pendant les mesures de mutation de step-023 et une
  fois pendant celles de step-024. Ce n'est pas un défaut du produit, mais ça rend une suite rouge
  sans cause lisible — et, on le sait maintenant, ça se paie aussi en CI.
- **Le timeout du harnais godog est passé de 2 s à 15 s** (19/08/2026), parce que l'enrôlement le
  dépassait sur le runner de la CI. C'est une borne anti-suspension et non une assertion de
  performance — la raison est écrite là où elle vit, sur `browser` dans `cmd/dashboard/main_test.go`.
  Ce qu'on perd : une régression qui rendrait une route dix fois plus lente ne rougirait plus ici. Rien
  ne la garderait par ailleurs, et c'était déjà vrai à deux secondes.

## Ses dettes ont un porteur depuis le 31/08/2026

Elles sont inscrites au **registre de `tasks/todo.md`**, qui les rassemble toutes et que
`TestChaqueDetteNommeUnPorteurQuiExisteEtResteAFaire` empêche de nommer une step inexistante ou déjà
cochée. Le texte ci-dessus n'est pas réécrit : il dit ce qui a été mesuré à la date où il a été
écrit.

Ce qui a changé n'est pas le constat, c'est qu'il cesse de n'exister que dans une fiche archivée —
« une fiche archivée n'est ouverte par personne », et c'était vrai des quarante-neuf.

L'entropie de la clé TOTP, l'`issuer` de l'URI, la boucle des codes de récupération et les trois
branches de course → **step-031**. Le conteneur PostgreSQL et le délai godog → **step-032**. Le
journal de `internal/mfa` et `internal/auth` → **step-060**.
