# step-007 — Harnais BDD : `godog`, Vitest, Playwright, CI à deux toolchains

> **Jalon :** M0 · **Statut :** À FAIRE
> **Dépend de :** step-000, step-001, step-002, step-005 · **Bloque :** toute step suivante

## But
Rendre la stratégie de test exécutable. Tant que le harnais n'a pas porté un scénario de bout en bout,
on ne sait pas qu'il tourne — et le « scénario rouge d'abord » de la boucle de travail n'est qu'une
intention.

## Périmètre (ce que fait CETTE PR)
- **Extension du lanceur `godog`** posé par step-000 : partage des définitions de step entre packages,
  contexte de scénario, et fabriques alimentées par les types du contrat. *(Le lanceur lui-même et sa
  convention d'emplacement sont livrés par **step-000** — voir l'amendement qui y est noté : la boucle
  impose le scénario rouge d'abord, donc step-000 ne pouvait pas attendre celle-ci.)*
  **Amendement du 03/08/2026 — trois des quatre livrables de cette ligne ne sont pas livrés, et DN-1
  dit ce qui l'est à leur place.** Aucune **définition de step** n'est partagée : vérifié, les trois
  suites n'en ont aucune en commun — `cmd/dashboard` pilote un process, `internal/gateway` un client
  sortant, `internal/store` un schéma. Il n'y a rien à extraire, et extraire par anticipation
  fabriquerait l'abstraction que le troisième cas fait naître, pas le premier. Pas de **contexte de
  scénario** partagé non plus : la convention du dépôt est une struct par scénario, propre au package
  qui la décrit, et c'est elle qui garantit que rien ne fuit d'un scénario à l'autre. Pas de
  **fabriques alimentées par les types du contrat** : le contrat du BFF déclare une opération et un
  schéma à deux champs — il n'y a pas de quoi fabriquer. **Déclencheur de reprise** : la première step
  qui écrit une définition de step déjà présente ailleurs, ou le premier contrat assez large pour
  qu'une fabrique épargne quelque chose.
- **testcontainers** : la *réutilisation entre suites* plutôt qu'un conteneur recréé à chaque test.
  *(L'outil lui-même est introduit par **step-005**, qui ne peut pas tester ses migrations sans base
  réelle — arbitré le 02/08/2026. Elle en livre la forme minimale, un conteneur par suite ; ce qui
  reste ici est l'amortissement, pour lequel `modules/postgres` fournit `Snapshot`/`Restore`.)*
  **Amendement du 03/08/2026 — cette ligne ne sera pas livrée, et DN-3 porte la mesure qui l'annule :
  l'amortissement entre suites n'a aucun bénéficiaire tant qu'un seul package a besoin de PostgreSQL.**
- **Vitest + Testing Library** reciblés sur `web/`, avec la forme Étant donné / Quand / Alors dans la
  structure des tests — sans second moteur Cucumber. **Amendement du 03/08/2026 : le reciblage est
  déjà fait** — `vitest.config.ts`, `src/test-setup.ts` et quatre fichiers de test verts existent
  depuis step-001 et step-002. Ce qui reste de cette ligne est en DN-6 et DN-8.
- **Playwright contre le binaire** : `make build` puis lancement du binaire, pas du serveur de
  développement.
- CI : deux jobs, Go et client, plus le job de bout en bout qui dépend du build.
- **Une porte de couverture du contrat** : chaque opération déclarée par `api/openapi-bff.yaml` est
  exercée par au moins un scénario. Voir le point d'implémentation ci-dessous — elle vient d'un
  constat de step-004. **Elle n'est pas falsifiable à partir de cette step** : le contrat n'y déclare
  toujours qu'une opération, couverte par un scénario. DN-2 porte la mesure et ce qui la justifie
  malgré cela.

## Pièges connus, payés par la première tentative
- **`pnpm/action-setup` lit `packageManager` depuis la racine du dépôt.** Le client vivant sous
  `web/`, il faut `package_json_file: web/package.json` — sans quoi l'action avale l'ENOENT et lève
  « No pnpm version is specified », et **toutes** les portes client échouent avant `pnpm install`.
  *(Déjà fermé : `.github/actions/setup/action.yml` le passe, avec le commentaire qui le justifie.)*
- **Un test qui lit la sortie de build ne doit pas être ramassé par la suite unitaire.** L'`include`
  de Vitest le prend par défaut ; il faut l'exclure, sinon la suite exige un build et échoue sur un
  clone neuf. Le vert local ne tient alors qu'à un `dist/` résiduel.
  **Amendement du 03/08/2026 : ce piège est périmé, et DN-4 porte la mesure.** Le test qui lit la
  sortie de build construit lui-même dans un `mkdtemp` : il ne lit aucun `dist/` résiduel, et il n'y
  a rien à exclure.
- **Les seuils de couverture doivent être `perFile`** et l'`include` explicite : sans lui, le
  fournisseur v8 ne rapporte que les fichiers qu'un test a chargés, et un module que personne
  n'importe est **absent** du rapport au lieu d'y figurer à zéro.
- **Pousser la branche dès la première step.** Trois des six défauts de la première tentative
  n'étaient observables que dans un run de CI ; les découvrir en revue coûte une passe chacun.

## Points d'implémentation clés
- **Playwright tourne contre le binaire, et c'est la seule façon de vérifier ce qui sera servi.**
  L'ordonnancement `/api` / fallback (step-002), les en-têtes de cache et l'embarquement des assets
  n'existent que là. Un harnais qui viserait `vite dev` déclarerait vert ce que la production casse.
- **Le harnais ne fournit rien que le produit ne fournit pas.** La v1.0 a livré une application sans
  `QueryClientProvider` pendant que tous les tests de composant passaient, parce que le harnais le
  fournissait lui-même. C'est le critère 1 de la DoD, et il commence ici.
- Les scénarios tapent le **mock Prism** en amont, jamais la vraie passerelle (§16 du plan).
- Un `.feature` sans définition de step doit **échouer**, pas être ignoré. Le réglage par défaut de
  certains lanceurs est l'inverse, et une feature silencieusement sautée est pire qu'absente.
- **Chaque opération du contrat doit être exercée par un scénario, et c'est la CI qui le réclame.**
  *(Constat mesuré en step-004, où ce trou a été trouvé puis laissé ouvert faute d'être falsifiable
  sur une seule route.)*

  Le mode strict d'`oapi-codegen` retire le `ResponseWriter` de la signature du **handler**, mais pas
  de celle du **type de réponse** : `HealthResponseObject` n'a qu'une méthode,
  `VisitHealthResponse(w http.ResponseWriter) error`. Un type de réponse **sans champ** dont cette
  méthode écrit ce qu'elle veut sur le fil compile, satisfait l'interface, et traverse les quatre
  portes structurelles de step-004 — mesuré : le test de DTO ne regarde que la forme des champs
  **déclarés**, et il n'y en a aucun à examiner.

  Ce qui l'attrape est le scénario qui valide la réponse contre le YAML, et **lui seul** — donc
  uniquement sur les routes qu'un scénario nomme. La convention « DTO de sortie déclaré » n'est donc
  **pas auto-portante** (`plan.md` §1.11 porte l'amendement), et l'oubli d'un scénario est
  aujourd'hui silencieux.

  Le patron existe déjà dans le dépôt : le registre de `cmd/dashboard/main_test.go` refuse qu'un
  `.feature` n'exécute aucun scénario. Le transposer au contrat — « toute opération déclarée est
  visitée » — transforme « il faut penser à écrire le scénario de la nouvelle route » en une porte.
  **Elle ne devient pas falsifiable ici** : `api/openapi-bff.yaml` déclare une seule opération, et un
  scénario la couvre — la porte est donc verte par construction, ce que step-004 a nommé trois fois
  (« un analyseur qui ne trouve rien est cassé, pas vert »). Elle ne mordra qu'à la deuxième route.
  Ce qui la justifie quand même — elle a été **vue mordre**, et son câblage est gardé — est en DN-2.

## Design arrêté (2026-08-03)

Quatre de ces décisions **amendent le périmètre écrit ci-dessus** — DN-1, DN-3, DN-4 et DN-8 — et
chacune porte la mesure qui l'a montré. La fiche a été écrite avant que step-000 à step-006 n'existent : une partie de ce qu'elle
demande a été livrée en chemin, et une autre partie décrit un bénéficiaire qui n'existe pas.

### DN-1 — Le harnais partagé vit dans `internal/bddtest/`, et une garde d'imports l'empêche d'entrer dans le produit

Go n'a pas de package de test partagé : un package `foo_test` n'est importable de nulle part. Partager
impose donc un package Go ordinaire, que rien n'empêche structurellement d'importer depuis un fichier
de production. La garde est un test qui charge le graphe d'imports **résolu** (`go/packages`) de
`cmd/...` et `internal/...` et refuse que `bddtest` y figure hors d'un `_test.go`.

L'analyse porte sur les imports et non sur le texte source : un détecteur qui chercherait le nom du
package dans les fichiers serait rendu toujours vrai par un commentaire ou un homonyme. Le patron
existe déjà — `TestOnlyGeneratedCodeServesTheAPIRoutes` (`internal/bff/router_test.go`) résout des
symboles plutôt que des chaînes.

Ce qui entre dans le package est ce qui est **aujourd'hui dupliqué** — le registre de scénarios,
l'énumération des `.feature`, la lecture du filtre `-run`, le tampon de sortie concurrent, la racine
du dépôt — **plus la seule brique neuve de la step, le registre d'opérations de DN-2**, qui n'était
dupliquée nulle part et n'existait pas. Elle y vit parce qu'elle est du harnais et qu'elle partage le
désarmement sous `-run` avec le registre de scénarios ; elle est le seul ajout, et c'est délibéré.
Mesuré : `syncBuffer`, `runFilter` et `featureFiles` sont copiés littéralement
entre `cmd/dashboard` et `internal/gateway` ; `repositoryRoot` existe en **deux implémentations
divergentes** (`git rev-parse` dans l'une, remontée des `..` jusqu'à un `go.mod` dans l'autre) ; et le
registre existe en **trois variantes**, dont celle d'`internal/store` n'a ni couverture par fichier ni
exemption sous `-run` — un `go test -run 'TestScenarios/…'` y fait tomber le plancher.

### DN-2 — La porte de couverture du contrat compte les opérations **validées contre le YAML**, et vit là où les scénarios tournent

Une opération est tenue pour visitée quand un scénario a confronté sa réponse au contrat, pas quand un
scénario a demandé son chemin. C'est la seule lecture qui ferme le trou que la fiche décrit : un type
de réponse sans champ dont le `Visit…` écrit ce qu'il veut traverse toutes les portes structurelles, et
**seule** la validation contre le YAML l'attrape. Compter les chemins demandés rendrait la porte verte
pour une route appelée sans être vérifiée — c'est-à-dire pour le défaut lui-même.

Le point d'enregistrement est donc `route.Operation.OperationID`, déjà disponible dans le
`FindRoute` de `responseMatchesTheContract` (`cmd/dashboard/main_test.go`). La porte vit dans la suite
de `cmd/dashboard`, seule à démarrer le binaire et seule à charger le contrat ; le registre lui-même
est une brique de `internal/bddtest` (DN-1).

Elle se désarme sous un filtre `-run` qui coupe dans les scénarios, exactement comme le registre de
`.feature` : `TestingT: t` fait de chaque scénario un sous-test, et un filtre partiel ferait accuser
la porte à tort.

> **Correction du 03/08/2026, après revue.** Le **Périmètre** et les **Points d'implémentation clés**
> affirmaient tous deux que la porte « ne devient falsifiable qu'ici » — les deux phrases sont
> corrigées sur place, et voici pourquoi. **C'est faux** : `api/openapi-bff.yaml` déclare
> toujours **une** opération, couverte par **un** scénario — exactement la configuration que ce même
> paragraphe décrit comme rédhibitoire. La porte est donc verte par construction aujourd'hui, et elle
> ne mordra qu'à partir de la deuxième route.
>
> Ce qui reste vrai, et qui la justifie quand même : elle a été **vue mordre**, sur l'oubli réel
> reproduit (une opération ajoutée au contrat, régénérée, sans scénario — voir le tableau des
> mutations) ; et son câblage, lui, est gardé — retirer l'enregistrement de la visite dans
> `responseMatchesTheContract` fait rougir `TestScenarios`. C'est un pari sur la route suivante, pas
> une preuve sur celle-ci, et la formulation d'origine présentait le pari pour une preuve.

### DN-3 — L'amortissement de testcontainers n'a aucun utilisateur : rien n'est construit, et `WithReuse` est écarté nommément

**Mesuré le 03/08/2026** sur `go test -count=1 ./internal/store/` : **22,4 s au total**, dont ~18 s de
démarrage du conteneur dans `TestMain` ; la somme des tests individuels fait **~3,7 s**. Un seul
package consomme testcontainers. « Entre suites » suppose plusieurs binaires de test `go test`, qui ne
peuvent pas se passer un conteneur en mémoire : la ligne du périmètre décrit un bénéficiaire qui
n'existe pas.

`Snapshot`/`Restore` **à l'intérieur** de la suite est écarté aussi : il remplacerait une isolation qui
marche (`CREATE DATABASE` par test) pour un gain plafonné à ~3 s sur 22.

`testcontainers.WithReuse` est écarté **par sa raison**, parce que c'est l'option qu'un relecteur
pressé par la lenteur de la boucle locale reproposera : elle gagne ~18 s à chaque relance sur un poste,
zéro en CI où le runner est neuf, et laisse survivre entre deux exécutions un conteneur dont le schéma
peut venir d'une branche antérieure. C'est structurellement le `dist/` résiduel que cette fiche nomme
elle-même comme piège — un vert qui ne tient qu'à un reste.

**Déclencheur de reprise** : le jour où un second package a besoin de PostgreSQL, l'amortissement a un
utilisateur, et il vivra dans le `internal/bddtest` de DN-1.

### DN-4 — Le test qui lit la sortie de build reste dans la suite unitaire

Le piège tel qu'il est écrit affirme deux choses fausses. **Mesuré le 03/08/2026** :
`web/chargement-a-froid.test.ts` construit lui-même dans un `mkdtemp` via un sous-process — il ne lit
aucun `dist/` résiduel — et la suite Vitest **complète** tourne en **1,70 s**, ce fichier compris
(**1,53 s** isolé, 0,92 s pour `src/` seul). Les 120 s qu'on lui prête sont son *timeout*, pas sa
durée.

Ce qui resterait comme raison de fond — l'herméticité, et le domaine d'imputation d'un échec — ne
s'applique pas : le test est hermétique par construction, la toolchain dont il dépend est déjà celle
que Vitest exige pour démarrer, et un build cassé rougit de toute façon `typecheck-web` et « Build
client et déployable ».

Le déplacer coûterait, lui, quelque chose de réel : ce fichier porte **la seule garde de l'invariant
(d)** — il relit tous les fichiers émis par le build et refuse toute origine absolue hors liste
blanche. Le renvoyer vers le harnais Playwright la suspendrait au téléchargement des navigateurs et la
sortirait de `make check` (DN-5) : la garde la plus importante deviendrait la moins souvent jouée.

Son timeout de 120 s est conservé — un runner de CI est plus lent qu'un poste.

### DN-5 — Playwright : un parcours, contre le binaire, dans sa propre cible, hors de `make check`

`make e2e` est une cible distincte et un job CI dédié, pas une douzième ligne de `make check`. Deux
raisons : la DoD de cette fiche parle des **deux** suites ; et l'inclure imposerait à tout poste
d'avoir téléchargé les navigateurs.

Deux garde-fous, sans lesquels la cible serait un vert silencieux : **`make e2e` doit échouer
bruyamment quand les navigateurs manquent**, et le job doit entrer dans le `needs:` de l'agrégateur —
ce que `scripts/check-ci-aggregator.py` vérifie déjà, et qui est donc le filet.

> **Amendement du 03/08/2026, après mesure.** Le premier garde-fou n'appelle **aucun** contrôle dans
> la cible : Playwright échoue de lui-même et imprime le remède. Mesuré en pointant
> `PLAYWRIGHT_BROWSERS_PATH` sur un répertoire vide — « Executable doesn't exist at … Please run the
> following command to download new browsers ». Un contrôle de plus dirait la même chose, moins bien.
>
> **Défaut trouvé au passage, et corrigé ici** : le motif de `make help` était `^[a-z-]+:`, qui ne
> capte aucun nom de cible contenant un chiffre. `e2e` naissait dans cette step et n'aurait pas été
> listée — or `make help` « fait foi sur ce qui existe ». Le motif devient `^[a-z][a-z0-9-]*:`.
>
> **Ce que la sortie de `check` crée, et qu'il faut nommer** (constat de revue, 03/08/2026) : une
> **quatrième course**, hors de portée du `.NOTPARALLEL:` du Makefile, qui ne couvre qu'un seul
> processus `make`. `make e2e` dans un terminal et `go test ./cmd/dashboard/` dans un autre se
> disputent `internal/webassets/dist/`. Elle est écrite au-dessus de la cible, avec les trois autres.
>
> **Correction du 03/08/2026** : la première version de ce DN donnait **trois** raisons, dont « la
> cible lie un port, celui que `make dev` occuperait ». **C'est faux** — `make dev` lie 3000 et 3001,
> les parcours 3101, précisément pour cohabiter. La raison est retirée du paragraphe ci-dessus, qui
> n'en porte plus que deux ; le motif du port reste valable pour le contrôle « le binaire sert la
> sortie de Vite », qui lie 3001 pour de bon, et c'est de là que la confusion venait.

Le harnais lance le **binaire** (`webServer` de Playwright sur `./bin/dashboard`), jamais `vite dev` :
l'ordonnancement `/api` avant le fallback SPA, les en-têtes de cache et l'embarquement des assets
n'existent que là. Un seul parcours et un seul navigateur ici — les cinq parcours de `plan.md` §17.4
arrivent chacun avec la step qui livre son écran.

### DN-6 — La couverture client se règle par un `include` explicite et des seuils `perFile` planchers

L'`include` est ce qui porte le bénéfice réel : sans lui, le fournisseur v8 ne découvre pas les
fichiers qu'aucun test n'a chargés, et un module orphelin est **absent** du rapport au lieu d'y figurer
à zéro. Vérifié dans la source de Vitest installée
(`web/node_modules/vitest/dist/chunks/coverage.*.js`) : `getUntestedFiles` rend `[]` tant que
`coverage.include` est `undefined`.

> **Correction du 03/08/2026, après revue.** Ce paragraphe ajoutait « et `perFile` **ne s'hérite pas**
> par motif (`docs/config/coverage.md`) ». La phrase existe — sur la branche `main` de Vitest, **pas
> dans la version 4.1.10 que ce dépôt exécute**, dont la documentation ne dit rien de tel. Elle est
> retirée plutôt que corrigée : la configuration livrée ne pose **aucun** seuil par motif, donc la
> question de l'héritage ne se pose pas ici, et l'affirmation ne servait qu'à donner du poids à un
> réglage qui se justifie tout seul (voir le tableau des mutations : `perFile` retiré laisse passer un
> module orphelin d'une ligne).

Sont exclus de l'`include` les fichiers **engendrés** (`*.gen.ts`) et `api.test-d.ts`, qui n'est
exécuté par aucun runner — c'est `tsc --noEmit` qui le juge. Mesuré le 03/08/2026 sur `src/**` :
`main.tsx`, `router.ts` et `routeTree.gen.ts` à 100 %, `__root.tsx` et `index.tsx` à 75 %,
`permissions.gen.ts` et `api.test-d.ts` à 0 %.

> **Correction du 03/08/2026.** Ce relevé donnait aussi `api.gen.ts` à 100 %. **Il est à 0 %** : c'est
> un module de **types purs**, donc zéro instruction, et v8 rapporte `0/0` comme 0 %. Le chiffre écrit
> argumentait contre la conclusion qu'il servait — c'est justement parce qu'un fichier sans instruction
> ne peut pas atteindre un plancher qu'il doit être exclu.

Les seuils sont des **planchers anti-régression**, jamais une cible : les 25 % manquants de
`__root.tsx` et `index.tsx` sont des accolades fermantes et du commentaire dans la cartographie de v8,
pas du code non exercé — lu ligne à ligne. Un seuil manqué reste une question, et se corrige par un
test ou par une exemption commentée, jamais par un abaissement pour tout le monde.

### DN-7 — `QueryClientProvider` reste hors du produit **et** hors du harnais

Le mode d'échec que cette fiche cite exige deux moitiés — un produit sans provider **et** un harnais
qui le fournit. Vérifié : `@tanstack/react-query` n'est importé nulle part dans `web/`, ni par le
produit ni par un test ; aucun `useQuery` n'existe, et aucune route ne fait d'appel réseau. Le monter
maintenant serait du code sans utilisateur, ce que step-004 (DN-6) a déjà refusé pour le client
`openapi-fetch`.

Le test qu'un montage prématuré appellerait — « vérifier que le provider est dans l'application » —
serait un `Alors` qui porte sur une structure et non sur un effet observable : aucune mutation ne
pourrait le faire tomber pour un défaut visible, puisque retirer le provider ne casse aujourd'hui
aucun comportement.

Ce que « il commence ici » désigne dans la fiche est la **discipline** du harnais — ne jamais fournir
ce que le produit n'a pas —, et cette discipline-là est bien tenue. La garde comportementale est déjà
écrite ailleurs : le critère 1 de la DoD fera échouer le parcours de bout en bout de la première step
qui livrera un `useQuery` sans provider monté dans l'application. **Renvoi** : c'est cette step-là qui
monte le provider, dans le produit et non dans le harnais.

### DN-9 — La borne de démarrage du binaire passe de 5 s à 30 s

Ajouté le 03/08/2026, après un flottement observé pendant la step et un constat de revue : le
correctif n'existait que dans un message de commit, alors que c'est un changement de comportement du
harnais — la borne qui décide si le binaire est en panne.

Observé sur un `go test -race ./...` : un scénario est tombé sur « le serveur n'a pas annoncé son
adresse d'écoute » avec un journal **vide**, le binaire n'ayant rien écrit en 5 s pendant que dix
paquets compilaient et tournaient de front. La même suite lancée seule passait, et le passage suivant
sur l'arbre entier aussi. La borne visait un démarrage parti en vrille et attrapait une machine
occupée — même arbitrage que `prismStartup` dans `internal/gateway`, qui porte déjà 30 s pour cette
raison.

Aucun test ne rougit si la valeur revient à 5 s, ce qui a été vérifié plutôt que supposé : le défaut
ne se reproduit que sous une charge qu'aucune porte ne fabrique. C'est écrit au-dessus de la ligne
concernée, comme le critère 4 l'exige.

### DN-8 — Étant donné / Quand / Alors est une convention d'écriture, pas une réécriture des tests existants

Les quatre fichiers de test client existants nomment leurs `describe`/`it` par des phrases françaises
descriptives, et ils décrivent bien un effet observable. Les réécrire serait du churn sans preuve
gagnée, et sortirait du périmètre. La convention s'applique aux tests que cette step écrit ou touche.

## Tests (écrits dans la même PR)
- Le scénario de `/api/health` passe, et **casser le handler le fait rougir** — la vérification qui
  prouve que le harnais est branché. *(Déjà établi par step-004, dont le tableau de mutations porte
  « le handler rend un statut hors de l'enum → le scénario, sur la validation ». Cette step ne le
  rejoue pas ; elle en ajoute une voisine — l'enregistrement de la visite retiré, ci-dessous.)*
- Un `.feature` dont une step n'est pas définie fait échouer la suite. *(Constat du 03/08/2026 :
  **aucune preuve n'existe dans le dépôt**, et cette ligne l'affirmait sans en avoir. `Strict: true`
  est bien posé dans les trois suites, et la lecture de `godog@v0.16.0/suite.go` montre que
  `shouldFail` rend `s.strict` sur `ErrUndefined` — mais c'est une lecture de source, pas une porte :
  aucun test ne rougirait si `Strict` disparaissait des trois `godog.Options`. Écrit ici plutôt que
  couvert par un test de complaisance ; le fermer demande un `.feature` volontairement orphelin, que
  le registre de corpus ferait alors rougir pour une autre raison — c'est ce nœud qu'il faudra
  démêler.)*
- Un test de composant Vitest tourne sur `web/` et échoue quand le composant change.
- Le parcours Playwright ouvre l'application **servie par le binaire** et voit le squelette puis le
  contenu.
- La porte de couverture du contrat rougit quand une opération déclarée n'est visitée par aucun
  scénario — mutation à jouer en **ajoutant une opération au contrat** sans lui écrire de scénario,
  et non en retirant un scénario existant : c'est l'oubli réel qu'il faut reproduire.
- **Ajouté le 03/08/2026, par DN-1 :** un fichier de production qui importe `internal/bddtest` fait
  rougir la garde d'imports. Sans cette preuve, le package de harnais est libre d'entrer dans le
  binaire et la garde n'est qu'une phrase.

## Definition of Done
- [ ] `make check` vert et enchaîne les deux suites
- [ ] la CI a ses deux jobs et le job de bout en bout dépend du build
- [ ] les mutations ci-dessus ont été **jouées**, pas supposées — celle de la porte de couverture
      comprise

## Tableau des mutations

Rempli au fil de l'eau, pas reconstitué à la rédaction de la PR. Une ligne vaut aussi quand rien ne
tombe : « retrait de X → aucune porte ne rougit » est un constat, à condition d'avoir été vérifié.

| Mutation appliquée | Ce qui tombe |
|---|---|
| `bddtest` : désarmement sous filtre `-run` retiré (`filtersScenarios` court-circuité) | `TestARunFilterStandsTheCorpusFloorDown` — « 0 scénario(s) exécuté(s) pour un plancher de 8 » |
| `bddtest` : `FeatureFiles` ne descend plus dans les sous-répertoires | `TestFeatureFilesAreFoundInSubdirectoriesToo` — `sous-repertoire/range.feature` manquant |
| `bddtest` : verrou d'écriture de `SyncBuffer` retiré | `TestTheBufferSurvivesConcurrentWritesAndReads` sous `-race` — quatre `DATA RACE` |
| `bddtest` : plancher neutralisé (`if false && l.executed < minimum`) | `TestTheLedgerReportsACorpusThatShrank` **et** `TestTheFloorIsTheCallersAndNotThePackages` |
| Couverture client : un module orphelin d'une ligne ajouté sous `src/lib/` | `vitest run` — `ERROR: Coverage for lines (0%) … for src/lib/orphelin.ts` |
| Couverture client : `coverage.include` retiré, orphelin conservé | **rien ne rougit** — le module est absent du rapport et `exit=0`. C'est la mesure qui justifie la ligne |
| Couverture client : `perFile` retiré, orphelin d'une ligne sans fonction | **rien ne rougit** — les quatre seuils globaux passent (78,57 % de lignes pour 75 exigés) |
| Après adoption : `cmd/dashboard/contrat.feature` renommé en `.disabled` | `TestScenarios` — « 7 scénario(s) exécuté(s) pour un plancher de 8 » |
| Avant adoption : `go test -run 'TestScenarios/le_schéma' ./internal/store/` | `TestScenarios` tombait — c'était le défaut, et c'est le rouge qui a précédé l'adoption. Vert après |
| Garde d'imports : `internal/bff/api.go` importe `bddtest` | `TestNoProductionPackageReachesTheHarness` — « le harnais entre dans le binaire livré par … », **deux fois** : pour `internal/bff`, et pour `cmd/dashboard` qui l'atteint à travers lui. La chaîne complète est imprimée, et c'est le transitif qui se voit |
| Garde d'imports : chemin du harnais faussé d'une lettre | la garde reste **verte** — et c'est le **témoin** qui tombe : « l'analyse ne retrouve pas les suites qui importent le harnais : elle ne garde rien, et la garde jumelle est verte pour cette raison-là ». C'est ce que le témoin existe pour attraper |
| **Couverture du contrat, la mutation que la fiche exige** : une opération `version` ajoutée à `api/openapi-bff.yaml`, serveur régénéré, handler écrit, **aucun scénario** | `TestScenarios` — « l'opération "version" est déclarée au contrat et aucun scénario ne valide sa réponse contre lui […] lui écrire un scénario » |
| Couverture du contrat : la même, **plus** un scénario qui demande `/api/version` et vérifie un 200 sans confronter la réponse au contrat | la porte rougit **toujours**. C'est ce qui prouve DN-2 : est visitée l'opération *validée*, jamais l'opération seulement appelée |
| Parcours : `data-skeleton="rail"` retiré du document servi | le parcours tombe sur la première assertion — `expect(received).toContain(expected)` |
| Parcours : l'asset embarqué remplacé par un `throw`, binaire recompilé | le document servi reste correct et la **première** assertion passe ; les suivantes tombent, « element(s) not found ». C'est ce que le parcours prouve en propre, et qu'aucune autre porte ne voit |
| `PLAYWRIGHT_BROWSERS_PATH` pointé sur un répertoire vide | Playwright **échoue** et imprime le remède (« Please run the following command to download new browsers ») — il ne saute pas. C'est ce qui dispense la cible `make e2e` d'un contrôle préalable |
| Couverture du contrat : l'enregistrement de la visite retiré de `responseMatchesTheContract` | `TestScenarios` — « l'opération "health" est déclarée au contrat et aucun scénario ne valide sa réponse contre lui ». Le câblage est gardé, même quand la porte est verte par construction |
| Couverture client : `main.test.tsx` retiré de la suite | `main.tsx` **et** `router.ts` rougissent nommément — la preuve que le seuil `perFile` contraint quatre fichiers et non deux, contre un constat de revue qui affirmait le contraire |
| Contrat : tri d'`unnamed` retiré (le refus des opérations sans `operationId`) | `TestTheRefusalNamesThemInTheSameOrderTwice` — **10 échecs sur 10**. La forme du test vient d'une mesure : un parcours de map Go est une **rotation**, pas une permutation — 2000 parcours d'une map à cinq clés ne rendent que **cinq** ordres. Une lecture unique comparée à l'ordre attendu tombait juste une fois sur cinq |
| Contrat : tri de `declared` retiré | `TestTheDeclaredOperationsAreSortedSoTheGateReadsTheSameTwice` — 10 sur 10 **après** l'avoir fait relire vingt fois ; son nom promettait deux lectures et il n'en faisait qu'une, donc six ordres possibles et un faux vert sur six |
| Contrat : retour au `return` sur la **première** opération sans `operationId` | `TestEveryOperationWithoutAnOperationIDIsNamed` — 10 sur 10. Première tentative écartée : un `break` qui sortait d'une boucle de méthodes dont chaque route n'a qu'un membre, donc équivalent au code correct — une mutation qui ne prouvait rien |
| `bddtest` : `features, _ := FeatureFiles(root)` (le `t.Fatal` du corpus retiré) | `TestACorpusRootThatDoesNotExistIsSaidAndNotTakenForAnEmptyOne`. Ce test a d'abord rougi sur le code **correct** : `testingTB.Fatal` n'interrompt pas, et la porte enchaînait sur « 0 scénario(s) pour un plancher de 8 » — un message qui envoie écrire des scénarios déjà écrits |
| `bddtest` : le `return` après `t.Fatal` retiré, côté **corpus** | le même test tombe |
| `bddtest` : le `return` après `t.Fatal` retiré, côté **contrat** | **rien ne rougit** — `unvisited(nil)` ne reproche rien. Constat écrit sur place, vérifié et non supposé |
| Agrégateur de CI : `build-web` retiré du `needs:` de `ci`, **avant** correction du script | **rien ne rougit** — `check-ci-aggregator.py` rendait 0. C'est le faux négatif que le second `needs:` du workflow a rendu réel, et le rouge qui a précédé sa correction |

## Hors périmètre
Les scénarios métier — chacun arrive avec sa step. L'audit d'accessibilité automatisé → step-185.
**Ajoutés le 03/08/2026 :** l'amortissement de testcontainers (DN-3, avec son déclencheur de reprise),
le montage de `QueryClientProvider` (DN-7, renvoyé à la step du premier appel réseau), et la réécriture
des tests client existants à la forme Étant donné / Quand / Alors (DN-8).
