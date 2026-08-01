# step-007 — Harnais BDD : `godog`, Vitest, Playwright, CI à deux toolchains

> **Jalon :** M0 · **Statut :** À FAIRE
> **Dépend de :** step-000, step-001, step-002 · **Bloque :** toute step suivante

## But
Rendre la stratégie de test exécutable. Tant que le harnais n'a pas porté un scénario de bout en bout,
on ne sait pas qu'il tourne — et le « scénario rouge d'abord » de la boucle de travail n'est qu'une
intention.

## Périmètre (ce que fait CETTE PR)
- **Extension du lanceur `godog`** posé par step-000 : partage des définitions de step entre packages,
  contexte de scénario, et fabriques alimentées par les types du contrat. *(Le lanceur lui-même et sa
  convention d'emplacement sont livrés par **step-000** — voir l'amendement qui y est noté : la boucle
  impose le scénario rouge d'abord, donc step-000 ne pouvait pas attendre celle-ci.)*
- **testcontainers** pour la base jetable, réutilisée entre suites plutôt que recréée à chaque test.
- **Vitest + Testing Library** reciblés sur `web/`, avec la forme Étant donné / Quand / Alors dans la
  structure des tests — sans second moteur Cucumber.
- **Playwright contre le binaire** : `make build` puis lancement du binaire, pas du serveur de
  développement.
- CI : deux jobs, Go et client, plus le job de bout en bout qui dépend du build.

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

## Tests (écrits dans la même PR)
- Le scénario de `/api/health` passe, et **casser le handler le fait rougir** — la vérification qui
  prouve que le harnais est branché.
- Un `.feature` dont une step n'est pas définie fait échouer la suite.
- Un test de composant Vitest tourne sur `web/` et échoue quand le composant change.
- Le parcours Playwright ouvre l'application **servie par le binaire** et voit le squelette puis le
  contenu.

## Definition of Done
- [ ] `make check` vert et enchaîne les deux suites
- [ ] la CI a ses deux jobs et le job de bout en bout dépend du build
- [ ] les quatre mutations ci-dessus ont été **jouées**, pas supposées

## Hors périmètre
Les scénarios métier — chacun arrive avec sa step. L'audit d'accessibilité automatisé → step-185.
