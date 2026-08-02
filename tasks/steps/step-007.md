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
- **testcontainers** : la *réutilisation entre suites* plutôt qu'un conteneur recréé à chaque test.
  *(L'outil lui-même est introduit par **step-005**, qui ne peut pas tester ses migrations sans base
  réelle — arbitré le 02/08/2026. Elle en livre la forme minimale, un conteneur par suite ; ce qui
  reste ici est l'amortissement, pour lequel `modules/postgres` fournit `Snapshot`/`Restore`.)*
- **Vitest + Testing Library** reciblés sur `web/`, avec la forme Étant donné / Quand / Alors dans la
  structure des tests — sans second moteur Cucumber.
- **Playwright contre le binaire** : `make build` puis lancement du binaire, pas du serveur de
  développement.
- CI : deux jobs, Go et client, plus le job de bout en bout qui dépend du build.
- **Une porte de couverture du contrat** : chaque opération déclarée par `api/openapi-bff.yaml` est
  exercée par au moins un scénario. Voir le point d'implémentation ci-dessous — elle vient d'un
  constat de step-004, et elle n'est falsifiable qu'à partir de cette step.

## Pièges connus, payés par la première tentative
- **`pnpm/action-setup` lit `packageManager` depuis la racine du dépôt.** Le client vivant sous
  `web/`, il faut `package_json_file: web/package.json` — sans quoi l'action avale l'ENOENT et lève
  « No pnpm version is specified », et **toutes** les portes client échouent avant `pnpm install`.
- **Un test qui lit la sortie de build ne doit pas être ramassé par la suite unitaire.** L'`include`
  de Vitest le prend par défaut ; il faut l'exclure, sinon la suite exige un build et échoue sur un
  clone neuf. Le vert local ne tient alors qu'à un `dist/` résiduel.
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
  **Elle ne devient falsifiable qu'ici** : avec une seule opération et un scénario qui la couvre, elle
  serait verte par construction et ne prouverait rien — le mode d'échec que step-004 a nommé trois
  fois (« un analyseur qui ne trouve rien est cassé, pas vert »).

## Tests (écrits dans la même PR)
- Le scénario de `/api/health` passe, et **casser le handler le fait rougir** — la vérification qui
  prouve que le harnais est branché.
- Un `.feature` dont une step n'est pas définie fait échouer la suite.
- Un test de composant Vitest tourne sur `web/` et échoue quand le composant change.
- Le parcours Playwright ouvre l'application **servie par le binaire** et voit le squelette puis le
  contenu.
- La porte de couverture du contrat rougit quand une opération déclarée n'est visitée par aucun
  scénario — mutation à jouer en **ajoutant une opération au contrat** sans lui écrire de scénario,
  et non en retirant un scénario existant : c'est l'oubli réel qu'il faut reproduire.

## Definition of Done
- [ ] `make check` vert et enchaîne les deux suites
- [ ] la CI a ses deux jobs et le job de bout en bout dépend du build
- [ ] les mutations ci-dessus ont été **jouées**, pas supposées — celle de la porte de couverture
      comprise

## Hors périmètre
Les scénarios métier — chacun arrive avec sa step. L'audit d'accessibilité automatisé → step-185.
