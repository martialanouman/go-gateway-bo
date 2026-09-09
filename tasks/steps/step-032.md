# step-032 — Le harnais de test : conteneur, délai godog, authentificateur épinglé

> **Jalon :** M1 (§17.4, `plan.md`) · **Statut :** À FAIRE
> **Dépend de :** step-007 · **Bloque :** — (mais elle allège toutes les suivantes)
>
> *Elle se lit **avant** M2, et c'est le seul argument qui compte : un harnais qui casse sous la charge
> coûte davantage à chaque step ajoutée, et il a déjà coûté huit jours.*

## But
Réparer les trois défauts du harnais que personne ne possède. Aucune step ne touche
`internal/bddtest` ni les dépendances de test depuis step-007, livrée — et `plan.md` §2.1 dit
pourtant que **les six blocages de la première tentative venaient tous de l'outillage**, aucun du code
métier.

Cette step-ci n'est pas une prévention : elle paie un coût **déjà encaissé**.

## Périmètre (ce que fait CETTE PR)
- **Le conteneur PostgreSQL des scénarios ne doit plus mourir sous la charge.**
- **Rendre au délai godog un filet de performance**, que le passage de 2 s à 15 s a supprimé.
- **Décider du sort de `descope/virtualwebauthn`**, épinglée sur `go-webauthn v0.16.5`.
- **La borne de démarrage du binaire**, passée de 5 s à 30 s, et l'**amortissement de testcontainers**
  entre paquets.

### Cinq dettes que cette step hérite

*Écrites ici et non seulement dans `steps/done/`, parce qu'une fiche archivée n'est ouverte par
personne. Les trois figurent au registre de `todo.md`.*

- **Le conteneur PostgreSQL meurt sous la charge, et c'est la seule dette du projet dont le coût est
  chiffré.** `done/step-023.md`, mesuré le 27/08/2026 : « c'est lui qui a fait rougir "Tests Go" sur
  la CI […] Cet échec a **bloqué un bump de `kin-openapi` pendant huit jours** en faisant croire à une
  rupture de la bibliothèque. Le coût n'est donc pas l'inconfort d'une suite rouge : c'est une
  dépendance qu'on n'ose plus bumper. »

  C'est le mode d'échec le plus cher qu'un harnais puisse avoir — il ne fait pas perdre du temps, il
  fait **prendre la mauvaise décision** sur une dépendance de sécurité.

- **Le filet de performance n'existe à aucune valeur du délai godog**, passé de 2 s à 15 s pour
  absorber ce même conteneur. `done/step-023.md`, en entier parce que la fin change le sens : « une
  régression qui rendrait une route dix fois plus lente ne rougirait plus ici. Rien ne la garderait
  par ailleurs, **et c'était déjà vrai à deux secondes**. » Le passage à 15 s n'a donc **rien créé** —
  il a rendu visible ce qui manquait déjà, et le délai reste ce que step-023 dit qu'il est : une borne
  anti-suspension, pas une assertion de performance. Le rendre à sa valeur courte prouve que le
  conteneur est réglé ; le filet, lui, est à construire.

- **`descope/virtualwebauthn` est épinglée sur `go-webauthn v0.16.5`.** `done/step-024.md` : « un
  durcissement futur […] le symptôme serait une suite rouge sans cause lisible dans le produit ». Le
  repli est déjà chiffré par DN-12 : **un authentificateur à la main, ~150 lignes**.

- **La borne de démarrage du binaire est passée de 5 s à 30 s**, et c'est la jumelle exacte de la
  précédente : step-007, DN-9, écrit « **aucun test ne rougit si la valeur revient à 5 s**, vérifié
  plutôt que supposé ». Deux bornes élargies pour absorber la même lenteur, ni l'une ni l'autre gardée.

- **L'amortissement de testcontainers entre paquets n'est pas fait.** step-007 l'a laissé ouvert avec
  son déclencheur écrit — « le jour où un second paquet a besoin de PostgreSQL » —, et ce jour est
  passé depuis longtemps : `internal/store`, `cmd/dashboard` et `cmd/bootstrap` en montent chacun un.
  C'est probablement le remède au premier point plutôt qu'une dette à part.
  *(Cette fiche écrivait quatre paquets, `cmd/migrate` compris ; il n'importe pas testcontainers et
  n'a jamais monté de conteneur. Corrigé le 09/09/2026, en le vérifiant plutôt qu'en le recopiant.)*

## Points d'implémentation clés
- **Mesurer avant de choisir.** Le premier point admet plusieurs remèdes — ressources du conteneur,
  amortissement entre paquets, parallélisme des scénarios — et rien ne dit lequel mord. Le dépôt a
  déjà payé une décision prise sur un proxy plutôt que sur la cause ; ici la cause s'observe.
- **`WithReuse` a été écarté nommément en step-007**, et cette step n'a pas à défaire cet arbitrage
  sans mesure neuve. Ce que step-007 laissait ouvert est l'**amortissement entre paquets**, avec son
  déclencheur écrit : « le jour où un second paquet a besoin de PostgreSQL ». Ce jour est passé —
  `internal/store`, `cmd/dashboard` et `cmd/bootstrap` en montent chacun un.
- **Le délai godog rendu à 2 s est la preuve, pas l'objectif.** Le remettre sans avoir réglé le
  conteneur rend la suite instable, ce qui est pire que l'absence de filet : une suite qui rougit au
  hasard cesse d'être lue.
- **Le remède au troisième point n'est pas forcément de dépingler.** Écrire l'authentificateur à la
  main retire une dépendance de test d'un chemin de sécurité, au prix de ~150 lignes qu'il faut alors
  garder. Les deux se défendent ; ce qui ne se défend pas est de ne pas trancher.
- **Ce genre de défaut ne s'observe pas en local.** `plan.md` §2.1 : « trois des six défauts n'étaient
  observables que dans un run de CI. Pousser la branche tôt et laisser la CI arbitrer coûte une
  commande ; le découvrir en revue coûte une passe. »

## Tests (écrits dans la même PR)
- **La suite complète, lancée plusieurs fois d'affilée, ne rougit pas** — c'est le seul critère qui
  décrit le défaut réel. Un test qui passe une fois ne dit rien d'un conteneur qui meurt sous la
  charge.
- **Le délai godog rendu à sa valeur courte tient**, et sa valeur est écrite là où elle vit.
- Pour le troisième point : ce que la forme retenue permet, et le constat écrit si elle ne permet
  rien.

## Décisions (DN)

### DN-1 — Le défaut ne se reproduit sur aucun poste, et la mesure le dit avant le remède

Trois `go test -race -count=1 ./...` en local, dont un à `GOMAXPROCS=4` pour approcher le runner :
les trois conteneurs rendent `die 0`, aucun `OOMKilled`, **au plus une connexion ouverte sur les cent
disponibles**, et quatre-vingt-onze bases taillées dans un même conteneur sans dommage.

Une sonde temporaire posée sur le job « Tests Go » a écarté l'hypothèse la plus tentante : au pire
moment de `make test-go`, **6,2 Gio restaient disponibles** sur les seize du runner, sans un seul OOM
du noyau ni une ligne anormale dans le journal PostgreSQL. **La pression mémoire n'est pas la cause.**

Ce qui reste établi vient des deux journaux, relus sur leur source plutôt que sur la fiche qui les
cite :

- run `32258974888` (19/08, branche de la PR 52) — `connection refused` sur le port du conteneur de
  `cmd/dashboard`, **dès sa première base**, puis chaque scénario attend ses trente secondes pour rien
  (13:37:43, 13:38:13, 13:38:43, 13:39:13, 13:39:44) ;
- run `31579216427` (12/08) — mode d'échec **différent**, que la dette confondait avec le premier :
  douze scénarios sur quarante-cinq dépassent le délai client de 2 s sur `POST /auth/mfa/totp/enroll`.
  C'est celui qui a motivé le passage à 15 s, et il n'a rien à voir avec la mort d'un conteneur.

Le remède ne repose donc pas sur un réglage — aucun n'était indiqué — mais sur la **suppression du
mécanisme** : là où le serveur est fourni, il n'y a plus de testcontainers du tout, donc plus de
démarrage concurrent, plus de port éphémère par paquet, plus de reaper.

### DN-2 — Un serveur fourni par l'environnement, le conteneur en repli

`DASHBOARD_TEST_DATABASE_URL` désigne le PostgreSQL des suites ; sans elle, chaque suite monte le
sien comme avant. La CI pose la variable et le `services: postgres` que deux autres jobs avaient
déjà. Ce n'est **pas** `WithReuse`, écarté nommément par DN-3 de step-007 : rien ne survit entre deux
exécutions, puisque personne ne réutilise un conteneur.

**Le repli reste dans le `_test.go` de chaque suite**, et cette ligne-là a été payée deux fois : monter
le conteneur dans un fichier ordinaire de `internal/bddtest` a fait rougir `make vuln-go` sur deux avis
de `golang.org/x/crypto/ssh`, atteints par `postgres.Run`. `govulncheck` analyse le produit et ignore
les fichiers de test — y faire entrer le harnais Docker, c'est faire dépendre les portes du produit des
dépendances de testcontainers. La garde d'imports de `bddtest` disait déjà cette frontière ; elle vaut
aussi pour cette porte-là.

### DN-3 — Ce que le serveur partagé crée, et que le conteneur jetable masquait

Trois défauts, aucun prévu, tous mesurés :

1. **Un `t.Cleanup` reçoit un `t.Context()` que Go annule avant de l'exécuter.** Le nettoyage échouait
   à tous les coups, et son silence l'a caché : six bases survivaient à une suite verte.
2. **Un compteur reparti de 1 retrouve les bases de l'exécution d'avant**, et la suite rougit sur le
   harnais. Le nom porte désormais le PID du processus.
3. **Le nettoyage doit avoir lieu au démarrage, pas à la fin** — le contraire de l'intuition. À la fin,
   les pools que les cas n'ont pas fermés reconnectent aussitôt après le `WITH (FORCE)` et retiennent
   leur base : quatre-vingt-dix-neuf suppressions échouaient en ajoutant vingt-quatre secondes à un
   paquet qui en dure seize.

Le compte de bases est mesuré **stable à 174** sur trois `go test ./...` d'affilée — borné à une
exécution au lieu de croître.

*Trois échecs de nettoyage sont passés inaperçus parce que la fonction se taisait, et c'est la leçon
de cette step au petit pied : un harnais muet fait croire à ce qu'il n'a pas fait. D'où
l'avertissement sur stderr, qui ne fait pas rougir.*

### DN-4 — Le filet de performance est un budget relatif, et son premier étalon ne gardait rien

La lecture de session est comparée à `/api/health`, sonde de vivacité qui ne touche ni la base ni la
passerelle, mesurée **en alternance** dans le même run. Les deux enflent ensemble quand la machine
charge, et le rapport l'annule : cinq passages tiennent dans 15,5–19,4 là où un seuil en
millisecondes aurait rougi au hasard — et une suite qui rougit au hasard cesse d'être lue.

**Le premier étalon écrit était `/api/auth/me` sans cookie, et il ne gardait rien** : le refus traverse
le *même* handler, donc la mutation gonflait les deux branches ensemble et restait verte à 1,2. Un
étalon pris à l'intérieur de ce qu'il mesure annule exactement ce qu'il devait voir. Il n'a été
découvert que par la mutation.

Ce que le budget de soixante attrape, mesuré et non déduit : **39,7 à +5 ms (vert), 66,3 à +10 ms
(rouge), 86,9 à +30 ms (rouge)**. Sur une route à trois millisecondes, il mord à partir d'un facteur
trois — bien avant le facteur dix que step-023 nomme.

### DN-5 — Les deux bornes reviennent, chacune à ce que la mesure permet

Relevé le 09/09/2026 sur le runner, une fois le PostgreSQL fourni par le job : requête la plus lente
**3,16 s** (`POST /auth/mfa/totp/enroll`, dix argon2id), démarrage le plus lent **295 ms** (504 ms sur
un M4 Pro).

- **Le délai du client passe de 15 s à 8 s**, deux fois et demie le pire relevé. **Les deux secondes
  d'origine ne peuvent pas revenir**, et c'est désormais mesuré plutôt que supposé : elles tomberaient
  sous les 3,16 s de l'enrôlement, sur une suite verte.
- **La borne de démarrage revient à 5 s**, sa valeur d'avant step-007 — dix fois le pire relevé. La
  mesure de DN-9 qui l'avait portée à 30 s décrivait un monde où trois conteneurs démarraient de front
  au même moment ; ce monde n'existe plus.

Ce que trente secondes coûtaient n'était pas l'attente mais le diagnostic : sur le job en échec de la
PR 52, **chaque scénario a attendu ses trente secondes pour rien** avant de rendre le même message.

### DN-6 — `descope/virtualwebauthn` est gardée

L'épinglage est réel et sans remède possible ici : `go-webauthn v0.16.5` est déclaré dans le `go.mod`
de la dépendance, le produit exige 0.18.0, MVS retient la plus haute. Aucun `replace` n'existe et il
n'en faut pas.

Elle reste, parce que ce qui se payait n'était pas la dépendance mais son **mode d'échec illisible** :
DN-12 de step-024 chiffre le repli à cent cinquante lignes de crypto EC2 et CBOR à maintenir sur un
chemin de sécurité, pour remplacer huit appels et deux cérémonies.

Ce qui change est le symptôme. `internal/mfa/webauthn_test.go` exerce les deux cérémonies sans base,
sans HTTP et sans binaire : s'il rougit avec les scénarios WebAuthn, la cause est la bibliothèque de
test ; s'il reste vert pendant qu'ils rougissent, c'est le produit.

## Mutations

| Mutation | Attendu | Observé |
|---|---|---|
| `time.Sleep(5ms)` dans le handler `Me` | vert (sous le budget) | vert, rapport 39,7 |
| `time.Sleep(10ms)` dans le handler `Me` | **rouge** | rouge, rapport 66,3 |
| `time.Sleep(30ms)` dans le handler `Me` | **rouge** | rouge, rapport 86,9 |
| Le harnais WebAuthn signe pour une autre origine | **rouge**, cause nommée | rouge, « Error validating origin » |
| La réponse d'attestation abîmée d'un octet | **rouge**, cause nommée | rouge, « Parse error for Registration » |
| L'étalon du filet pris sur la route mesurée *(état initial du code)* | rouge attendu | **vert à 1,2** — le défaut du filet, corrigé |

## Ce qui n'est pas testé, et pourquoi

- **Le défaut d'origine n'a pas été reproduit**, ni en local ni en CI : il est intermittent, et aucune
  des cinq exécutions de cette step ne l'a rencontré. Ce qui est prouvé n'est donc pas « le remède
  corrige le défaut observé » mais « le mécanisme qui pouvait le produire n'est plus là où il vivait ».
  Une DoD qui n'accepterait pas cette phrase fabriquerait un test de complaisance.
- **Le nettoyage des bases n'a aucun test.** Il n'affirme rien du produit, et son échec ne doit pas
  faire rougir une suite ; ce qui le garde est l'avertissement sur stderr et le compte mesuré à 174.
- **Aucune porte ne rougit si les deux bornes remontent**, ce qui reste vrai et vérifié : une borne
  haute ne se distingue d'une borne juste que sous une charge qu'aucune porte ne fabrique. Ce qui les
  garde est la mesure écrite au-dessus de chacune, à refaire quand le harnais change.

## Definition of Done
- [x] `make check` vert, **et la suite Go lancée trois fois de suite sans rougir**
- [x] la CI est verte sur trois exécutions consécutives, pas une seule — le défaut ne s'observe que là
- [x] le délai godog est revenu à sa valeur courte, ou la raison de ne pas le faire est écrite
- [x] le sort de `virtualwebauthn` est tranché, et la raison écrite dans la fiche
- [x] `pnpm audit` et les alertes de dépendances sont relues : la dette de départ est qu'on n'osait
      plus bumper — `x/crypto` passe en 0.56.0, qui corrige les deux avis que le déplacement du
      conteneur avait rendus atteignables ; la PR #75 de dependabot en devient caduque

## Hors périmètre
Les cinq parcours Playwright → step-185. L'image de production et les sondes → step-186. Le
durcissement du code de M1 → step-031.
