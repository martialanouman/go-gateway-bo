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
  step-022.
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

### DN-6 — Le ré-enrôlement exige une session **déjà élevée**
Le premier enrôlement est libre : il faut bien pouvoir entrer une première fois. Le remplacer exige
d'avoir franchi celui qui est en place, sans quoi quiconque détient le mot de passe contourne le
second facteur en s'en attachant un neuf — et toute la step ne garderait rien. Pas d'état « en attente
de confirmation » : le mode d'échec « je n'ai pas scanné » se rattrape par un code de récupération,
montré au même écran et à la même seconde.

### DN-7 — Le challenge meurt après cinq échecs
`mfa_challenges.failures`. Combiné au verrou de step-021, un attaquant obtient ~25 essais par quart
d'heure sur 10⁶ codes. C'est aussi ce qui borne le **coût** du chemin de récupération, où chaque essai
paie dix argon2id — 260 ms et 64 MiB. Un challenge mort et un code faux rendent le même 401.

### DN-8 — Fenêtre de dérive : ±1 pas
Le défaut de `pquerna/otp` est `Skew: 0`, **relevé sur v1.5.0 et non supposé** : il refuserait un
téléphone en avance d'une seconde. Deux pas doubleraient la durée pendant laquelle un code intercepté
vaut encore. SHA-1, six chiffres, 30 s, secret de 20 octets : arbitrage d'interopérabilité et non de
sécurité — beaucoup d'applications ignorent les paramètres de l'URI. Ce qui protège est le secret.

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

## Tableau des mutations — **mesurées, pas prévues** (12/08/2026)

Chacune jouée sur un dépôt commité, une par une, avec `-count=1`.

| Mutation appliquée | Ce qui est tombé |
|---|---|
| **anti-rejeu retiré** (`WHERE` inconditionnel) | 2 unitaires + « le même code deux fois » et « le pas précédent » |
| **anti-rejeu réduit à l'égalité** (`<>` au lieu de `<`) | `TestUnPasAnterieurAuDernierConsommeEstRefuse` + « le pas précédent ne se rejoue pas non plus » |
| **fenêtre élargie à ±10 pas** | `TestUnCodeADeuxPasEstRefuse` + « le code à deux pas est refusé » |
| **secret stocké en clair** (chiffrement **et** déchiffrement) | `TestCeQuiVaEnBaseNEstPasLeSecretEnClair` + 3 |
| **code de récupération marqué au lieu d'être détruit** | 2 unitaires + « un code de récupération ouvre une fois et une seule » |
| **`ConsumeChallenge` rend vrai sans écrire** | `TestUnChallengeNeSeConsommeQuUneFois`, `TestUnChallengeConsommeResteEnBase` |
| **le handler n'appelle plus `ConsumeChallenge`** | « un challenge déjà servi ne ressert pas » — *scénario écrit après la mutation, voir plus bas* |
| **contrôle d'appartenance du challenge retiré** | « le challenge d'un autre opérateur n'élève rien » — *idem* |
| **données associées retirées** (des deux côtés) | `TestUnSecretDeplaceSurUneAutreLigneNeSeDechiffrePas`, et rien d'autre |
| **borne d'essais retirée** | 2 unitaires + « cinq codes faux tuent le challenge » |
| **exigence de session élevée retirée du ré-enrôlement** | « remplacer un second facteur depuis une session non élevée est refusé » |
| **jeton de session non régénéré à l'élévation** | `TestLElevationInvalideLeJetonPrecedent` + 6 scénarios |
| **arrêt au premier code de récupération qui colle** | **rien — verte, et le constat est écrit au-dessus de la ligne** |

## Ce que les mutations ont trouvé, et qui n'existait pas avant elles

**Deux gardes n'étaient tenues par rien**, et les deux ont été écrites après la mesure :

- **le contrôle d'appartenance du challenge.** Le retirer laissait les quarante scénarios et toutes
  les suites unitaires verts. Sans lui, le challenge dirait « un mot de passe vient d'être présenté
  quelque part » : quiconque en obtient un — le sien, en se connectant — élèverait la session d'un
  autre avec son propre code.
- **l'appel du handler à `ConsumeChallenge`.** Le store savait refuser un challenge déjà servi, mais
  rien n'exigeait que le handler l'appelle : un challenge de cinq minutes aurait valu douze heures.

**Deux mutations étaient mal construites et se lisaient comme des succès.** Les deux sont refaites
dans le tableau ci-dessus, et ce sont les deux formes du piège :

- « stocker le secret en clair » et « retirer les données associées » ne mutaient qu'**un sens** du
  chiffrement. Elles cassaient l'aller-retour — que n'importe quel test de vérification attrape — au
  lieu de perdre la propriété visée. Le rouge disait « le déchiffrement ne marche plus », pas « la
  garde a sauté ».
- « le jeton non régénéré » écrivait `coalesce($2, token_hash)`, où `$2` n'est **jamais** nul : un
  no-op qui rendait vert, donc un test qui semblait tenir.

**Et le cache de `go test` a rendu une mutation verte.** `appartenance-retiree` a d'abord été mesurée
sans `-count=1` et a rendu `ok (cached)` sur `cmd/dashboard` alors que le défaut était bien là. Toutes
les mesures ont été refaites avec `-count=1`. Un `ok` mis en cache est indiscernable d'un `ok` gagné.

## Ce qui n'a pas été testé, et pourquoi

- **L'arrêt au premier code de récupération** (le seul rouge manquant). Ce qui le garderait est un
  test de durée sur un écart de 260 ms, que le dépôt écarte partout ailleurs pour instabilité en CI.
  Le constat de la mesure est écrit au-dessus de la boucle, comme pour `hmac.Equal` et
  `subtle.ConstantTimeCompare`.
- **Un journal.** Un secret illisible en base et un hachage de code abîmé sont **silencieux** : aucun
  journal n'atteint encore `internal/mfa` ni `internal/auth`. Le premier journal du BFF devra les
  remonter — le manque est écrit sur les deux fonctions concernées.

## Definition of Done
- [x] `make check` vert
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
- **Aucun anti-brute-force sur `/auth/mfa/verify` au-delà du compteur par challenge.** Le calcul est
  écrit en DN-7 et tient ; ce qu'il ne couvre pas est un attaquant qui relogue depuis des sources
  variées pour renouveler ses challenges. La dimension `source` de `login_attempt_counters` le
  bornerait — à trancher par step-025, qui reprend ce chemin.
- **L'`issuer` de l'URI `otpauth://` est codé en dur.** Deux déploiements du même produit apparaissent
  sous le même nom dans le téléphone d'un opérateur qui enrôle les deux. La sortie est une variable de
  configuration, et elle appartient à la step qui aura une préproduction.
