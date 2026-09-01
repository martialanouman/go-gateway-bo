# step-021 — Login email/mot de passe (`argon2id`) + anti-brute-force partagé

> **Jalon :** M1 (§6.9) · **Statut :** FAIT
> **Dépend de :** step-020 · **Bloque :** step-022, step-023, step-024, step-027

## But
Vérifier qu'un opérateur est bien qui il prétend être, sans jamais dire lequel des deux facteurs a
échoué, et sans qu'une machine puisse essayer indéfiniment. Rien n'est encore protégé : cette step
livre le premier facteur et la porte qui le limite, pas la session.

## Périmètre (ce que fait CETTE PR)
- `internal/auth` : hachage **argon2id** (`golang.org/x/crypto/argon2`), paramètres mesurés sur la
  machine cible et écrits, encodage **PHC** (`$argon2id$v=19$m=…,t=…,p=…$sel$hash`), vérification en
  temps constant.
- `POST /auth/login` au contrat du BFF : adresse + mot de passe → verdict et **challenge de second
  facteur** à usage unique, de courte durée, en base.
- **Anti-brute-force partagé entre instances** : compteur d'échecs et verrouillage temporaire en
  PostgreSQL, par compte **et** par adresse source. Migration `00004`.
- `make bootstrap`, **seconde moitié** : crée le premier opérateur, lit ses valeurs dans
  l'environnement, et **ne recrée personne** dès qu'un opérateur existe.

  > **Amendement du 08/08/2026, à la livraison de step-020.** Ces trois lignes disaient « refuse de
  > s'exécuter dès qu'un opérateur existe », et le README avec elles. step-020 a livré la première
  > moitié de la commande **rejouable**, parce qu'un déploiement l'appelle à chaque fois et que le
  > seed doit pouvoir reprojeter le catalogue : une commande qui échouerait dès le second passage
  > obligerait à la retirer du déploiement, donc à ne plus jamais resemer.
  >
  > Ce qui ne se rejoue pas est la **création du compte**, pas la commande : `bootstrap` sème, puis
  > crée le premier opérateur **s'il n'y en a aucun**, et le dit quand il n'en crée pas. Le mode
  > d'échec que le « refuse » visait — un second compte propriétaire créé en douce par quelqu'un qui
  > relance la commande avec d'autres variables — est couvert à l'identique, sans casser la
  > rejouabilité. La DoD et les tests ci-dessous sont amendés dans le même sens.
- Les variables nouvelles dans `internal/config` et `.env.example`, sans valeur par défaut.

## Points d'implémentation clés
- **PostgreSQL et non Redis, et ce n'est pas un pis-aller.** Redis n'entre qu'en step-044, et le plan
  écrit que son Pub/Sub est « au mieux une fois » ; un compteur d'échecs qui repart de zéro au
  redémarrage annule la protection qu'il prétend porter. La base est déjà partagée par les ≥2
  instances (§4.1), donc « partagé entre instances » est acquis sans brique nouvelle.
- **Aucun oracle d'énumération** : même code, même corps, et **même durée** pour « adresse inconnue »
  et « mot de passe faux ». Sans hachage factice sur l'adresse inconnue, l'écart de durée fait
  l'oracle à lui seul — argon2id coûte des dizaines de millisecondes, l'absence de calcul en coûte
  zéro.
- **Le verrouillage se dit**, avec sa durée restante. Un refus muet fait retenter l'opérateur, puis
  ouvrir un ticket ; et la charte interdit un contrôle qui refuse sans expliquer.
- **Le challenge est un objet en base, pas un jeton signé.** La session signée appartient à step-022 ;
  un challenge doit être révocable à la seconde où il est consommé (anti-rejeu), ce qu'un jeton sans
  état ne permet pas. Ce sont deux objets de nature différente, pas deux mécanismes redondants.
- **Les paramètres argon2id se relèvent, ils ne se devinent pas** : mémoire, itérations, parallélisme
  sont mesurés ici, et l'encodage PHC est ce qui permettra de les relever plus tard sans invalider les
  hachages existants.
- **Le README décrit déjà cette step** — le sel d'anti-brute-force, le refus de rejouer `bootstrap`,
  la lecture par l'environnement plutôt que par `argv` que `ps` afficherait (step-005, DN-12). Ce
  texte se confronte au livré et se corrige s'il ment (critère 2 de la DoD).

## Tests (écrits dans la même PR)
- **Scénario** `login.feature` : identifiants justes → challenge émis ; mot de passe faux → refus ; N
  échecs → verrouillage annoncé ; verrou expiré → un nouvel essai est possible.
- Unitaire : un hachage produit avec d'anciens paramètres reste vérifiable après relèvement.
- Unitaire : « adresse inconnue » et « mot de passe faux » rendent le même corps et le même code. La
  durée est **mesurée à la main** et le constat écrit sur place — un test de temps est instable en CI.
- Le compteur est bien partagé : deux pools distincts sur la même base additionnent leurs échecs.
- `make bootstrap` sur une base qui porte déjà un opérateur **sème quand même et ne crée personne**, et
  le dit. *(Ligne amendée par DN-1 : elle disait « refuse, et ne modifie rien », ce que l'amendement du
  08/08 contredisait sans l'avoir réécrite.)*

## Definition of Done
- [x] `make check` vert
- [x] les paramètres argon2id sont écrits avec la mesure qui les fonde, pas recopiés d'un billet
- [x] `.env.example` liste exactement les variables lues, et le binaire refuse de démarrer sans elles
- [x] la mutation « retirer le verrouillage » fait rougir le scénario
- [x] la mutation « retirer le hachage factice sur adresse inconnue » : ce qui tombe, ou le constat
      qu'aucune porte ne rougit, écrit au-dessus de la ligne
- [x] la mutation « laisser `bootstrap` créer un second opérateur alors qu'il en existe déjà » fait
      rougir *(amendée par DN-1 : la formulation d'origine, « laisser `bootstrap` s'exécuter deux
      fois », décrivait la mutation d'une commande qui refuse — or elle se rejoue)*

## Hors périmètre
Le cookie de session, `/auth/me` et `/auth/logout` → step-022. La vérification du second facteur →
step-023 et step-024. Les gardes de permission → step-025. L'écran → step-027.

## Décisions

### DN-1 — `bootstrap` se rejoue ; c'est la **création du compte** qui ne se rejoue pas

L'amendement du 08/08 annonçait « la DoD et les tests ci-dessous sont amendés dans le même sens »
sans les avoir réécrits : deux lignes disaient encore « refuse ». Elles sont corrigées ici, et
signalées comme telles.

La commande sème toujours, crée le compte **s'il n'y a aucun opérateur**, et le dit quand elle n'en
crée pas. Le mode d'échec que le « refuse » visait — un second compte propriétaire créé en douce par
quelqu'un qui relance avec d'autres variables — est couvert à l'identique par le `WHERE NOT EXISTS`
sous verrou consultatif.

Les trois variables ne sont exigées **que** sur une base sans opérateur. L'ordre inverse — exiger
puis regarder — ferait échouer la commande à chaque déploiement après le premier.

### DN-2 — Le « sel d'anti-brute-force » masque l'adresse source, il ne poivre pas les mots de passe

Le README nommait ce secret sans qu'aucun document ne dise à quoi il sert. Il devient
`DASHBOARD_BRUTEFORCE_SALT`, clé du HMAC-SHA256 qui masque l'adresse source dans
`login_attempt_counters`.

L'alternative — un poivre global sur les mots de passe — a été écartée : le perdre invaliderait
**tous** les mots de passe sans chemin de sortie, et le README réserve précisément cet avertissement à
la clé TOTP, pas à celui-ci.

La raison de masquer est plus étroite qu'un principe, et le prétendre autrement serait faux :
`audit_log.ip_address` garde des adresses en clair depuis 00002. La différence est que
`login_attempt_counters` est la **seule** table du schéma qu'une requête non authentifiée fait
écrire, par n'importe qui, sans audit. Une surface d'écriture libre ne se transforme pas en journal de
connexion.

HMAC et non SHA-256 nu : l'espace des IPv4 fait 2³² valeurs, qu'un hachage sans clé épuise en
quelques secondes.

### DN-3 — 401 pour les identifiants, 429 pour le verrou, et les compteurs sur l'adresse **soumise**

Le refus est 401 `invalid_credentials`, corps identique pour « adresse inconnue », « mot de passe
faux » et « compte désactivé ». Le verrou est 429 `too_many_attempts`, avec `Retry-After` et la durée
dite dans le message — 423 a été écarté, c'est un code WebDAV qu'aucun intermédiaire ne traite.

**Les compteurs sont clés sur l'adresse soumise, existante ou non.** Les clé sur l'opérateur trouvé
ferait qu'une adresse inconnue ne se verrouille jamais — et « celle-ci ne verrouille pas » redeviendrait
l'oracle d'énumération que le hachage factice ferme par ailleurs.

### DN-4 — argon2id à 64 MiB, t=3, p=4 — et la cible de la fiche était infaisable

La fiche visait « ≈250 ms, mesurés sur la machine cible ». La mesure (`BenchmarkVerification`,
10/08/2026, Apple M4 Pro) a rendu **26,3 ms** pour le profil RFC 9106 §4 « seconde option ». Atteindre
250 ms à 64 MiB demanderait une trentaine de passes — le temps y est linéaire en `t`, 8,5 ms la passe
et 108,3 ms à t=12 —, un profil que la RFC ne décrit nulle part ; les seuls jeux à 250 ms sont
256 MiB · t=6 et 512 MiB · t=3. Les **dix** profils mesurés sont au-dessus de `currentParams` ; une
première rédaction n'en montrait que six, ce qui laissait la linéarité en affirmation.

C'est la **mémoire** qui a été gardée, pas la durée. Une carte graphique aligne des milliers de cœurs
mais pas des milliers de fois 64 MiB de mémoire rapide ; des passes supplémentaires n'achètent qu'un
facteur linéaire que le même matériel rattrape. Et argon2 alloue sa mémoire **par vérification en
vol** : le verrou ne protège pas du premier essai sur chaque adresse, donc dix tentatives simultanées
à 512 MiB réserveraient 5 GiB et l'anti-brute-force deviendrait un déni de service contre le BFF.

Prix assumé et écrit au-dessus de `currentParams` : une base volée s'attaque à 26 ms le candidat.
C'est ce que le relèvement existe pour corriger, et il ne coûte que trois nombres — l'encodage PHC
fait que les hachages déjà produits restent vérifiables.

**Point de réexamen nommé** : la mesure a été faite sur un poste de développement, pas sur la machine
de production. À rejouer au premier déploiement réel (step-186).

### DN-5 — Les proxys de confiance, sans quoi le compteur de source verrouille tout le monde

Le handler strict d'oapi-codegen ne reçoit pas `*http.Request` : c'est ce qui tient la convention du
DTO de sortie, et c'est ce qui met `RemoteAddr` hors de portée. Un middleware dérive l'adresse et la
pose dans le contexte sous une clé privée.

Deux défauts que la fiche ne nommait pas, et qui se referment ensemble. Derrière le load balancer
qu'impose §4.1, `RemoteAddr` est l'adresse **du load balancer** : un compteur posé dessus n'est pas
une protection, c'est un interrupteur de verrouillage global. Et croire `X-Forwarded-For` sans
condition offrirait à quiconque une évasion — une valeur différente à chaque tentative.

D'où `DASHBOARD_TRUSTED_PROXIES`, facultative, **vide par défaut et vide est sûr** : sans liste,
l'en-tête est ignoré. Ne pas la renseigner en production verrouille tout le monde d'un coup, ce qui se
remarque ; l'inverse laisserait passer, ce qui ne se remarque pas.

### DN-6 — Pas de colonne `locked_until` : l'état de verrou se dérive

Il se déduit de `(failures, last_failure_at)`. C'est la seule forme qui permette à tout l'incrément de
tenir dans une seule expression, donc dans un seul `ON CONFLICT DO UPDATE` — et c'est **cela** qui
rend le compteur partagé entre instances sans course, l'alias de la ligne en conflit désignant ce que
PostgreSQL relit après avoir pris son verrou de ligne.

Avec deux colonnes calculées il faudrait redire le `CASE` de la remise à zéro, et la façon évidente de
l'éviter — une CTE `SELECT … FOR UPDATE` puis `SET failures = excluded.failures` — **perd des
échecs**, en restant verte sous test séquentiel. Mesuré : elle fait rougir
`TestDesEchecsSimultanesNeSePerdentPas`.

La fenêtre d'oubli et la durée du verrou sont la **même** valeur, délibérément. Plus courte, un verrou
qui vient d'expirer se refermerait au premier essai suivant et « verrou expiré → un nouvel essai est
possible » serait faux.

### DN-7 — SHA-256 pour le challenge, argon2id pour le mot de passe

Le jeton est 256 bits tirés d'un CSPRNG : il n'a aucun déficit d'entropie à compenser, contrairement à
un mot de passe. Ce qu'argon2 achète — ralentir une recherche exhaustive dans un espace minuscule —
n'a rien à acheter ici, et coûterait ses dizaines de millisecondes sur le chemin du second facteur.

### DN-8 — Le pool ne reçoit pas le contexte de l'arrêt

`NewPool` attache `pool.Close` à l'annulation de son contexte. Lui passer celui qu'annule SIGTERM
fermerait le pool **au début** du délai de grâce, et les requêtes que ce délai existe pour laisser
finir tomberaient sur un pool fermé. `cmd/dashboard` lui passe un contexte détaché.

Aucune porte ne le garde — `arret-propre.feature` n'a aucune requête assez lente pour ouvrir la
fenêtre. Le constat est écrit au-dessus de la ligne.

### DN-9 — La consommation d'un challenge n'est pas livrée

Consommer est le geste de `POST /auth/mfa/verify`, qui appartient à step-023. L'écrire ici produirait
ce que ce dépôt a refusé deux fois : un artefact qu'aucun appelant n'atteint. L'usage unique est porté
dès maintenant par le schéma — `consumed_at` nullable et l'unicité de `token_hash`.

## Tableau des mutations

Tenu au fil de l'eau. Une ligne « aucune porte ne rougit » est un constat de la DoD (critère 4), pas
un aveu — à condition d'avoir été **vérifiée** et d'être écrite au-dessus de la ligne concernée.

### Le hachage

| Mutation appliquée | Ce qui tombe |
|---|---|
| `Verify` lit `currentParams` au lieu des paramètres de l'encodage | `TestUnHachageProduitAvecDAnciensParametresResteVerifiableApresRelevement` |
| `decode` ne valide plus les coûts | `TestDesCoutsNulsSontRefusesPlutotQueDeFairePaniquer` — panique `argon2: number of rounds too small` |
| le sel cesse d'être tiré à chaque hachage | `TestDeuxHachagesDuMemeSecretDifferentParLeSel` |
| `subtle.ConstantTimeCompare` remplacé par `==` | **rien** — mesuré. Un test de durée est écarté par la fiche et le serait de toute façon sur un écart de l'ordre de la nanoseconde. Ce qui garde cette ligne est la revue. |

### Le compteur partagé

| Mutation appliquée | Ce qui tombe |
|---|---|
| la requête réécrite en CTE `WITH previous … FOR UPDATE` + `excluded.failures` | `TestDesEchecsSimultanesNeSePerdentPas` — verte en séquentiel, rouge sous concurrence |
| `RecordFailure` n'incrémente que le compteur d'adresse | `TestLeVerrouSAppliqueAussiALAdresseSource` |
| `ClearFailures` efface aussi le compteur de source | `TestUneConnexionReussieEffaceLeCompteurDeLAdresseEtPasCeluiDeLaSource` |

### L'adresse source

| Mutation appliquée | Ce qui tombe |
|---|---|
| `X-Forwarded-For` cru sans liste de confiance | `TestUnEnTeteForgeEstIgnoreQuandAucunProxyNEstDeConfiance` et `TestUnPairHorsDesReseauxDeConfianceNeFaitPasLireSonEnTete` |
| `Unmap` retiré — un proxy déclaré cesse d'être reconnu sous sa forme mappée | `TestUneAdresseIpv4MappeeEnIpv6EstReconnueDansUnPrefixeIpv4` |

### La route

| Mutation appliquée | Ce qui tombe |
|---|---|
| le verrou n'est plus consulté avant la vérification | le scénario « le verrou tient même quand le mot de passe est le bon » |
| le refus nomme l'adresse (« aucun compte pour cette adresse ») | le pas « le refus ne nomme ni l'adresse ni le facteur en cause » |
| le `400` retiré des statuts attendus côté client | `pnpm typecheck` sur `api.test-d.ts` |
| `Header.Get` au lieu de `Header.Values` sur `X-Forwarded-For` | `TestUneSecondeLigneForwardedForNeMasquePasCelleDuProxy` |
| la clé de source rendue à l'adresse nue (pas de /64) | `TestDeuxAdressesDuMemeReseauIpv6PartagentLeurCompteur` |
| `itoa` inverse ses chiffres | `TestLaDureeAnnonceeArrondItToujoursAuSuperieur` |
| le plancher à 1 de `retryAfterSeconds` retiré | `TestUneDureeNulleOuNegativeNAnnonceJamaisZero` |
| le serveur rend l'**empreinte** au lieu du jeton de challenge | le pas « un challenge est émis avec son échéance » — la panne n'aurait éclaté qu'en step-023 |
| **retirer le hachage factice sur adresse inconnue** *(la DoD la nomme)* | **rien**, et c'est le constat qu'elle demande : le corps et le code sont identiques par construction, seule la durée diffère. *(Une rédaction précédente affirmait ici que la forme de `passwordMatches` rendait cette mutation visible en revue — la relecture l'a démentie : c'est une suppression d'une ligne dans une branche existante, et le test qui nomme `VerifyDummy` l'appelle directement, donc garde la fonction et jamais son site d'appel.)* |

### La commande d'installation

| Mutation appliquée | Ce qui tombe |
|---|---|
| le rôle propriétaire n'est plus attaché au compte créé | `TestLeCompteProprietaireDetientLeRoleQuiAccordeTout` |
| `WHERE NOT EXISTS` retiré **seul** | **rien** — le retour anticipé de `createOwner` arrête la commande avant |
| le retour anticipé de `createOwner` retiré **seul** | **rien** — le `WHERE NOT EXISTS` tient |
| **les deux ensemble** | `TestUnSecondPassageNeCreeAucunSecondOperateur` |

Les deux gardes méritent d'exister, et pas pour la même raison : l'une décide du **message** — il faut
savoir s'il y a un opérateur avant d'exiger les variables — l'autre est la seule qui tienne quand deux
exécutions se croisent. Ce cas-là n'est exercé par rien, exactement comme le verrou du seed
(step-020, DN-9).

### Les corrections d'après-revue

| Mutation appliquée | Ce qui tombe |
|---|---|
| la borne de `ClosePool` retirée | `TestClosingThePoolGivesUpOnAConnectionThatNeverComesBack` — en 10 s et non en pendant, le verdict étant relevé sur un canal |
| `defer store.ClosePool` retiré du binaire | **rien** : le processus s'arrête juste après et l'OS ferme ses sockets. Constat écrit au-dessus de la ligne |
| le cap de `maxForwardedHops` retiré | `TestUneChaineDeSautsPlusLongueQueLaBorneNEstPasRemontee` et `TestLaBornePorteSurLesLignesReuniesEtNonSurChacune` |
| le cap remis à zéro à chaque **ligne** de l'en-tête | `TestLaBornePorteSurLesLignesReuniesEtNonSurChacune` seul — chaque test garde bien une chose distincte |
| `maximumPasswordLength` retirée | `TestUnMotDePasseDemesureNAtteintPasLeHachage`, qui bascule de 400 à 500 |
| `maximumEmailLength` retirée | `TestUneAdresseDemesureeNeDevientPasUneCleDeCompteur` |
| le compte passé en **octets** | `TestUneAdresseDAccentsSousLaBorneNEstPasRefusee` |
| `middleware.RequestSize` retiré du routeur | `TestUnCorpsPlusGrandQueLaBorneNEstPasDecode` — **après correction du test**, qui était vert pour la mauvaise raison : son corps franchissait d'abord la borne du mot de passe. La mutation l'a dit |
| l'erreur de l'authenticator traduite en 401 | `TestUneBaseInjoignableNeSeLitPasCommeUnRefusDIdentifiants` |

### Ce qui n'est gardé par rien, vérifié plutôt que supposé

Ce tableau est tenu **après** la revue : quatre de ses lignes ont été refermées depuis, et elles
restent écrites avec ce qui les referme — une ligne qu'on efface se réouvre en silence.

| Ligne | Constat |
|---|---|
| `subtle.ConstantTimeCompare` | ~~aucune porte~~ **refermé en step-031** : `TestUnHachageNeSeCompareQuEnTempsConstant` exige l'appel dans `Verify` **et** y refuse toute comparaison d'octets — la seconde moitié parce qu'un raccourci naïf posé devant l'appel le laisse en place sans qu'il décide |
| le hachage factice, en tant qu'**appel** | ~~aucune porte~~ — **doublon de la ligne « l'appel à `VerifyDummy` dans `passwordMatches` » ci-dessous**, qui la referme dans cette même livraison. Les deux ont coexisté, l'une barrée et l'autre non, et c'est ce qui a fait écrire au registre de `todo.md` que la dette restait ouverte ; relevé en revue de step-031. Sa paramétrisation, elle, suit `currentParams` par construction |
| la cible de durée d'argon2id | ~~aucune porte~~ **resserré en step-031** : le plancher gardait 19 MiB et deux passes, le minimum d'OWASP, quand le profil retenu est 64 MiB et trois passes — il laissait donc tomber de 26,3 à 16,8 ms sans rougir. Il garde désormais la décision. La durée elle-même reste hors de portée d'un test — celle-ci est écrite avec sa date, sa machine et sa commande, et les dix profils mesurés sont au-dessus de `currentParams` |
| le pool détaché du contexte d'arrêt | aucune porte, faute d'une requête assez lente pour traverser SIGTERM. **Sa fermeture non plus** : la retirer laisse tout vert, parce que le processus s'arrête juste après et que l'OS ferme ses sockets. Ce que la ligne change — une déconnexion annoncée plutôt que découverte — n'est visible d'aucun test de ce dépôt, et c'est écrit au-dessus d'elle. Ce qui **est** gardé est la **borne** de l'attente : `TestClosingThePoolGivesUpOnAConnectionThatNeverComesBack` |
| `pg_advisory_xact_lock` en tête de `CreateFirstOperator` | aucune porte — deux exécutions concurrentes se croisent trop rarement pour qu'un test qui les lance prouve quoi que ce soit |
| l'**appel** à `VerifyDummy` dans `passwordMatches` | ~~aucune porte~~ **refermé** : `oracle_test.go` résout l'identifiant appelé en objet du type-checker et exige qu'il soit dans la branche « opérateur absent ». Trois mutations le font rougir — l'appel retiré, l'appel déplacé hors de la branche, la fonction renommée |
| les trois `CHECK` et le `ON DELETE CASCADE` de la migration `00004` | ~~aucune porte~~ **refermé** : trois refus ajoutés à `constraints_test.go`, chacun vérifié en retirant **sa** contrainte isolément. Les deux inatteignables depuis le produit portent sur place ce qu'elles gardent |
| les bornes d'entrée `maximumPasswordLength`, `maximumEmailLength` et `RequestSize` | ~~aucune porte~~ **refermé** : `bornes_test.go` monte le routeur entier sur un pool fermé, où 400 (refusé à la porte) se distingue de 500 (arrivé jusqu'à la base). Le compte en runes est gardé avec elles |
| le chemin d'erreur base pendant un login | ~~aucune porte~~ **refermé** : `TestUneBaseInjoignableNeSeLitPasCommeUnRefusDIdentifiants`, qui vérifie le corps autant que le statut — faute de journal dans `internal/bff`, ce que le navigateur reçoit est tout ce qui existe |
| `request.Body == nil` dans `API.Login` | aucune porte, et **inatteignable par le routeur** : `strictHandler.Login` assigne le pointeur sans condition. Lui écrire un test demanderait d'appeler la méthode hors de son routeur — il prouverait la garde et rien du produit. Le constat est au-dessus de la ligne |

## Ses dettes ont un porteur depuis le 31/08/2026

Elles sont inscrites au **registre de `tasks/todo.md`**, qui les rassemble toutes et que
`TestChaqueDetteNommeUnPorteurQuiExisteEtResteAFaire` empêche de nommer une step inexistante ou déjà
cochée. Le texte ci-dessus n'est pas réécrit : il dit ce qui a été mesuré à la date où il a été
écrit.

Ce qui a changé n'est pas le constat, c'est qu'il cesse de n'exister que dans une fiche archivée —
« une fiche archivée n'est ouverte par personne », et c'était vrai des quarante-neuf.

`subtle.ConstantTimeCompare` et l'appel à `VerifyDummy` → **step-031**. Le pool détaché du contexte
d'arrêt → **step-047**. La calibration argon2id, mesurée sur un poste de développement → **step-186**.
`request.Body == nil` et `pg_advisory_xact_lock` restent **sans porteur** : la première est une
décision consignée, la seconde n'a d'observateur possible qu'au premier déploiement à plusieurs
instances.
