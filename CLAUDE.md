# CLAUDE.md — Tableau de bord Admin (BFF Go + SPA React)

Manuel de travail pour Claude Code sur ce dépôt. Lis-le en entier avant d'écrire du code. Il est court
volontairement : les détails vivent dans les documents référencés en bas.

## Ce qu'on construit

Le **cockpit d'exploitation** de la passerelle SMS : un outil interne (100–300 opérateurs, thème
sombre, desktop-first) qui pilote clients, comptes SMPP, connecteurs, routage, conformité et
facturation. Ce n'est **pas** un portail client — les clients n'ont aucun accès à la plateforme.

Le navigateur ne parle qu'au **BFF Go**, qui parle à l'**API Admin de la passerelle** (dépôt
`go-gateway`, séparé) et à son petit schéma PostgreSQL propre. Le tout se livre en **un seul binaire** :
le Go embarque les assets de la SPA.

## Commandes

> Cible livrée par `step-000` et `step-007`. Tant que M0 n'est pas clos, `make` n'existe pas encore.

```bash
make dev          # BFF Go + Vite en parallèle (proxy /api → BFF)
make build        # build client puis go build → un binaire autonome
make check        # tout ce que la CI vérifie — OBLIGATOIRE avant toute PR
make mock         # mock Prism sur openapi-admin.yaml
make generate     # oapi-codegen + catalogue de permissions Go → TS

go test ./...     # unitaires + scénarios godog
golangci-lint run
pnpm -C web test  # Vitest
pnpm -C web e2e   # Playwright, contre le binaire
```

`make check` vert signifie une CI verte. Elle vérifie en plus que le code généré est à jour —
types du contrat **et** catalogue de permissions.

## Architecture (carte mentale)

**Un seul déployable** : un binaire Go sert la SPA *et* porte la logique BFF. Deux moitiés dans un
même dépôt, séparées par une frontière que le langage applique :

- **Client** (`web/`) — React, TanStack Router + Query, une WebSocket multiplexée. Aucun secret.
- **Serveur** (`internal/`) — session et authentification, permissions, journal d'audit, proxy vers
  l'API Admin, hub WebSocket, évaluateur d'alertes métier.

En production : **≥2 instances** derrière un load balancer avec affinité WS, coordonnées par Redis
Pub/Sub. Un process unique serait un SPOF et la cible de 99,9 % inatteignable.

## Layout du dépôt

```
cmd/dashboard/     le binaire : câblage, embed.FS des assets, arrêt propre
internal/          le BFF — seul endroit qui connaît secrets, jeton Admin et base
  bff/ config/ auth/ gateway/ hub/ alerting/ store/ permissions/
                   chaque package naît avec le code qui l'habite, jamais vide
api/               openapi-bff.yaml — engendre les types Go et TS
web/               le client React (src/routes, src/components, src/lib, src/styles)
docs/              la spécification technique
tasks/             plan.md · todo.md · steps/ (à faire) · steps/done/ (livrées)
```

## Règles d'or (toujours / jamais)

- **JAMAIS le corps d'un message hors de l'onglet qui l'affiche.** Ni log, ni toast, ni URL, ni
  message d'erreur, ni export, ni cache persisté, ni attribut de trace. L'affichage exige
  `content:read` et déclenche un appel **audité**.
- **TOUJOURS un DTO de sortie déclaré.** Une réponse HTTP est un struct Go, jamais une
  `map[string]any`, jamais un type de domaine marshalé directement. Un champ absent du struct ne peut
  pas fuir — c'est ainsi que l'invariant (a) tient sans discipline.
- **JAMAIS un secret réaffiché.** Identifiants de bind, clés API, secrets de webhook et de
  fournisseur : masqués en permanence, montrés exactement une fois à la création ou à la rotation.
  Aucune action « révéler » n'existe nulle part.
- **TOUJOURS l'autorisation côté serveur.** `RequirePermission()` en middleware. Le rendu conditionnel
  de l'UI est un confort ; un contrôle masqué dont la route n'est pas gardée est une faille.
- **JAMAIS le navigateur en direct sur l'API Admin.** Le jeton machine, le mTLS et la connexion
  PostgreSQL vivent sous `internal/`, que le langage rend inatteignable. Le risque résiduel n'est plus
  un import mais une **URL codée en dur** dans le client : un test la cherche dans le bundle.
- **JAMAIS sur le chemin critique du plan de données.** Une panne du tableau de bord dégrade la
  visualisation, jamais le débit de SMS ni la détection d'incident (Alertmanager est indépendant).
- **Un contrôle interdit est désactivé et expliqué**, jamais silencieusement masqué.
- **Les contrats sont la source de vérité** : le dépôt consomme `@martialanouman/gateway-api-contracts`
  et ne copie jamais un YAML. Tout manque se corrige par une PR dans `go-gateway/api/`.
- **TOUJOURS relever la version du contrat au début d'une step qui le touche.** Il est publié à chaque
  merge sur `main` de `go-gateway` : dix versions en une semaine, dont une majeure. Consigner l'écart
  dans la PR, **ne jamais bumper au milieu d'une step**, et **relire le diff du YAML** — une contrainte
  resserrée (`additionalProperties: false`, un `maximum`, un `enum` réduit) passe le typage et échoue à
  l'exécution. `tasks/plan.md` §1.12.
- **Versions & API : jamais devinées.** `ctx7` côté JS, `pkg.go.dev` ou `proxy.golang.org` côté Go,
  avant tout ajout, bump ou usage d'API. Une signature inventée compile parfois.

## Les 5 invariants (tests bloquants, verts à vie)

**(a)** le corps ne fuit dans aucune sérialisation et chaque lecture est auditée ; **(b)** aucun secret
n'est jamais réaffiché ; **(c)** toute route de mutation a une garde de permission et une écriture
d'audit ; **(d)** le client ne joint jamais l'API Admin ; **(e)** une panne du tableau de bord ne
dégrade que la visualisation.

## Code & langue

**Le code est en anglais** — identifiants, packages, types, champs, fonctions. **Le narratif est en
français** — commentaires, scénarios Gherkin, titres de test, copie produit.

**Commentaires avec parcimonie.** Un commentaire ne redit jamais ce que le code dit. Il ne subsiste
que là où le code ne peut pas parler : un *pourquoi* contre-intuitif, un arbitrage dont l'alternative
évidente est fausse, une contrainte externe invérifiable sur place. Partout ailleurs, la réponse est un
meilleur nom ou une fonction extraite.

> La v1.0 était à **38 % de commentaire** côté serveur. Une part portait un vrai « pourquoi » ; le
> reste paraphrasait la ligne suivante — et le critère 2 ci-dessous existe parce que **certains de ces
> commentaires mentaient** sur le code qu'ils surplombaient.

Interface en **français**, troisième personne, **conséquence d'abord**. Les identifiants techniques
restent en anglais et en mono, verbatim du contrat : `link_status`, `breaker_state`, `max_sessions`,
`balance_scope`, `half_open`, `query_sm`. Ne jamais traduire un identifiant — un opérateur le grep dans
les logs. « Sécurisé » n'est jamais une promesse : dire ce que la protection couvre et où s'arrête la
frontière d'accès.

**Cinq états de contenu, cinq copies distinctes** : chargement (squelette de la vraie mise en page) ·
vide (rien encore + comment créer) · aucun résultat (filtres trop étroits + comment élargir) · module
désactivé (dégradation propre, **jamais** une erreur) · erreur (réalité HTTP + « vos données locales
restent affichées » + Réessayer).

## Tests — BDD

**Le comportement s'écrit en Gherkin avant d'exister.** C'est le « rouge d'abord » de la boucle,
exprimé dans la langue du domaine.

- **Scénarios `godog`** (`.feature` en français, `# language: fr`) — le comportement observable du BFF.
  Le fichier vit **à côté du package qu'il décrit**, ses définitions de step dans un `_test.go` du même
  package. Ils tournent contre le **mock Prism**, jamais contre la vraie passerelle.
- **Unitaires Go** — les mécanismes aux limites : hachage, curseurs, mappings, sérialisation des DTO.
  La majorité des tests, en nombre.
- **Composants (Vitest + Testing Library)** — états, permissions, clavier, copie. Forme Étant donné /
  Quand / Alors, sans second moteur Cucumber : `describe`/`it` suffit.
- **Bout en bout (Playwright)** — cinq parcours seulement, **contre le binaire**.

**Le mode d'échec à éviter est nommé** : un scénario par critère d'acceptation fabrique la suite qu'on
n'ose plus croire. Gherkin l'aggrave, parce que ça se lit bien. Trois symptômes de dérive : un `Alors`
qui porte sur une structure de données plutôt qu'un effet observable ; un `Plan du scénario` à quinze
exemples qui teste un mapping ; deux scénarios qui ne diffèrent que par une valeur.

**Un scénario vert ne prouve pas plus qu'un test vert.** La mutation reste obligatoire — voir critère 3.

> **62 des 133 opérations du contrat ne sont pas implémentées côté passerelle.** Métriques, CDR/trace,
> sessions, facturation, contenu/RGPD, groupes, webhooks et sender-rewrite n'existent qu'au contrat. Le
> mock-first n'est pas un confort, c'est la condition de faisabilité — `tasks/plan.md` §16.

## La boucle de travail

**Une step = une session = une PR.** À suivre strictement, dans cet ordre.

**Chaque phase s'ouvre par `using-agent-skills`** — plan, spécification, implémentation, revue,
débogage. Le méta-skill oriente vers le skill de la phase, et chacun porte un cadre que l'improvisation
ne reproduit pas. Le mode d'échec est silencieux : sans le skill on finit par trouver, plus lentement et
sans structure, donc rien ne signale l'oubli. **L'invocation est la première action de la phase**,
avant d'écrire le prompt, le plan ou la première ligne.

1. Prendre le prochain `tasks/steps/step-NNN.md` — **l'ordre de `tasks/todo.md` fait foi**, pas le
   numéro, **sauf quand la ligne « Dépend de » du fichier le contredit : les dépendances déclarées
   priment**. Une divergence constatée se corrige *dans le plan* avant d'écrire du code — jamais en la
   contournant en silence.
2. Créer la branche : `feat/step-NNN-slug` (ou `fix/`, `docs/`, `chore/`, `test/`).
3. **Établir un plan avant la moindre ligne**, et en dériver la **todo list** — une entrée par unité
   livrable, tenue à jour.
4. Implémenter en **BDD strict : le scénario rouge d'abord**, jamais le code en premier. Périmètre
   limité à ce que le fichier de step décrit. La règle d'entrée vaut pour **chaque** reprise de code,
   correctifs de revue compris. **Commits atomiques au fil de l'eau** : une unité verte = un commit.
5. Après l'implémentation, **revue en sous-agents lecture seule** : ils remontent des constats, ils ne
   corrigent rien. La correction revient à la session. Si le contexte manque, **replanifier avant de
   toucher au code**. Relancer tant qu'il reste un constat bloquant.
   **Un correctif de revue est du code comme un autre** : même DoD, même mutation, même méfiance. En
   v1.0, une bonne part des constats des passes 2 à 5 portaient sur les correctifs des passes
   précédentes. Ne jamais annoncer un correctif sans l'avoir vu tenir.
6. Vérifier la **Definition of Done** ci-dessous et celle du fichier de step.
7. Dernier commit : `git mv tasks/steps/step-NNN.md tasks/steps/done/` et cocher la ligne dans
   `tasks/todo.md`.
8. Ouvrir la PR — titre en conventional commit avec la step : `feat(routing): éditeur de route
   (step-121)` — puis **merger dès que la CI est verte**. Si la CI échoue : **deux relances au
   maximum**, ensuite on rend la main.
9. Un jalon est terminé quand **toutes** ses steps sont dans `tasks/steps/done/`.

**Arbitrage.** Une décision se tranche d'abord sur le contexte disponible : spec, plan, contrat,
fichier de step. Si elle reste indécidable, consulter le modèle **Fable** plutôt que de trancher au
hasard.

Ne jamais déborder du périmètre d'une step. Ce qu'elle exclut est dans sa section « Hors périmètre ».

## Definition of Done (chaque PR)

`make check` vert • aucun invariant (a…e) violé • copie conforme aux fondamentaux de la charte •
clavier et libellés accessibles (WCAG 2.1 AA) sur tout écran touché • PR petite et focalisée (une
step) — plus les quatre critères ci-dessous.

> **Pourquoi quatre critères et non quatre portes de plus.** Les deux bloquants de la v1.0 ont franchi
> les douze portes de la CI : le bandeau de refus s'affichait sans bordure faute de tokens existants,
> et le QR code était un carré noir de 176 pixels. Deux lignes de l'ancienne DoD — « copie conforme »,
> « critères couverts par des tests » — se déclaraient vraies sans aucune preuve. Ce qui manquait
> n'était pas une vérification de plus : c'était de rendre falsifiable ce qu'on affirmait déjà.

**1. Le chemin qu'un humain traverse est traversé pour de bon.** Toute step qui livre un chemin d'écran
l'exerce de bout en bout au moins une fois — **en étendant un parcours existant** plutôt qu'en ajoutant
un fichier. « De bout en bout » veut dire **rien de simulé dans le produit** : pas de provider fourni
par le test, pas de client Query injecté, pas de module interne remplacé. Le mock Prism, lui, est la
frontière du système sous test.

> Trois défauts de la v1.0 y ont été trouvés et par rien d'autre : un `QueryClientProvider` absent de
> l'application, que le harnais de test fournissait lui-même ; une garde de session qui ne s'exécutait
> jamais sur une URL collée, pendant que trois tests la déclaraient verte ; et une boucle entre le
> login et le second facteur.

**2. Toute affirmation sur le monde extérieur est confrontée à sa source.** Trois formes, et les trois
ont menti : la **copie** qui décrit le produit se lit contre le code serveur qui l'implémente ; un
**commentaire** qui décrit un mécanisme se relit contre le code qu'il surplombe ; et ce qu'on écrit
dans un commit ou un rapport se vérifie sur la **sortie livrée**, pas sur l'intention du diff — un
remplacement scripté qui ne trouve pas son motif ne le dit pas.

> C'est ce critère qu'illustre le QR code noir : la règle CSS avait été écrite sans lire ce que la
> bibliothèque émet. Le parcours qui l'avait introduit assertait la visibilité du QR et restait vert.

**3. Mutation obligatoire partout où le retrait laisserait la suite verte.** Le critère est cette
propriété, pas une liste : gardes, refus, redirections et verrous en font partie, mais aussi un focus
posé, un état conservé d'un onglet à l'autre, un succès annoncé. Sur les neuf correctifs de la v1.0
livrés sans filet, trois ne rentraient dans aucune énumération écrite d'avance. Un test de rendu n'a
pas besoin de mutation : il tombe de lui-même. Et la mutation doit **reproduire le défaut réel** — une
qui laisse un verrou plus fermé que la version correcte reste verte et ne prouve rien.

**4. Ce qui n'est pas testable s'écrit là où il vit.** « Aucun test ne rougit si cette ligne disparaît,
ce qui a été vérifié plutôt que supposé » vaut mieux qu'un test qui fait semblant. Une DoD qui n'accepte
pas « je n'ai pas pu le tester, voici pourquoi » fabrique ce test-là.

**Les tests que réclame la step** sont ceux de sa section « Tests », qui énumère ses risques. Chacun a
une preuve, **de la forme qui lui convient** — scénario, test unitaire, mutation, parcours, ou constat
écrit sur place. Un test par critère d'acceptation n'est pas demandé : c'est ainsi qu'on écrit des
tests de complaisance sur du code défensif que la passerelle ne produit jamais.

**Un seuil de couverture manqué est une question, jamais un ordre.** Ou bien le code est atteignable et
mérite un test, ou bien il ne l'est pas et mérite d'être supprimé, ou couvert par une exemption
**commentée** — jamais en abaissant le seuil pour tout le monde.

## Recettes fréquentes

- **Ajouter une dépendance Go** : `pkg.go.dev` ou `proxy.golang.org` pour la version et l'API, puis
  `go get`. Vérifier les CVE connues avant d'adopter.
- **Ajouter une dépendance JS** : `ctx7` d'abord, puis `pnpm -C web add`. Jamais de version devinée.
- **Ajouter une route BFF** : la déclarer dans `api/openapi-bff.yaml`, régénérer, écrire le scénario
  rouge, puis le handler avec sa garde, son audit et son **DTO de sortie**.
- **Ajouter une route client** : créer le fichier sous `web/src/routes/`, régénérer l'arbre de routes,
  **commiter le fichier généré**.
- **Ajouter une permission** : trois endroits dans la même PR — le catalogue `internal/permissions/`,
  la garde serveur qui l'exige, et le tableau des rôles par défaut (§6.10 de la spec). Puis
  `make generate` : le TypeScript en dérive, et la CI échoue s'il diverge.
- **Un endpoint manque au contrat** : PR dans `go-gateway/api/` (YAML + bump), puis mise à jour ici.
- **Un écran non encore livré** : route déclarée + état vide explicite nommant le jalon. Jamais une
  page blanche ni un lien mort.

## Index documentaire (source de vérité)

- Quoi/pourquoi : `docs/specification-technique-tableau-de-bord.md` (v2.1)
- Comment/dans quel ordre : `tasks/plan.md`
- Découpage en PRs : `tasks/todo.md` + `tasks/steps/step-NNN.md`
- Charte graphique & kit UI : `.claude/skills/sms-gateway-design/README.md`
- Contrat API : `@martialanouman/gateway-api-contracts` (jamais copié ici)
- Passerelle (dépôt séparé) : `../go-gateway`
