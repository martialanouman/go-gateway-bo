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

> `make help` liste ce qui existe, et c'est la cible par défaut — préférer la lancer à croire ce
> bloc. Une cible absente rend `No rule to make target`, jamais un vert silencieux.

```bash
make dev          # BFF Go (:3001) + Vite (:3000), /api et /ws proxifiés vers le BFF
make build        # le déployable : build-web → copie dans internal/webassets/dist/ → go build
make build-go     # go build seul — ce que lance le job « Build Go », qui n'a ni pnpm ni node_modules
make check        # toutes les portes de la CI — OBLIGATOIRE avant toute PR
make test         # les deux suites · make lint — les deux linters
make generate     # oapi-codegen → client Go de l'API Admin, serveur Go du BFF
                  # openapi-typescript → types TS du BFF ; le catalogue de permissions en step-006
make mock         # mock Prism sur openapi-admin.yaml, sur :4010
make check-generated  # ce qui dérive des deux contrats OpenAPI est-il à jour ?
make migrate      # migrations goose sur DASHBOARD_DATABASE_URL — celle de l'appelant l'emporte
                  # sur .env, et le DSN passe par stdin plutôt que par argv, que `ps` afficherait
make bootstrap    # sème le catalogue de permissions et les rôles par défaut, rejouable ; même
                  # précédence de DSN que migrate. Le premier opérateur arrive en step-021

# Une porte granulaire par job de CI, à lancer seule pendant une boucle rouge → vert :
#   build-go (Build Go) · lint-go (+ fmt-go pour appliquer) · vuln-go (govulncheck)
#   test-go (godog + -race) — seul job Go à avoir aussi pnpm : ses scénarios lancent Prism
#   lint-workflows (actionlint + l'agrégateur attend-il tous les jobs ?)
#   typecheck-web (tsc) · test-web (Vitest) · lint-web (Biome) · vuln-web (pnpm audit)
#   check-routes + check-generated + build + le contrôle du binaire → « Build client et déployable »
#   e2e (Playwright contre le binaire) → « Parcours de bout en bout » — hors de `make check`, seule
#     porte dans ce cas avec le contrôle du binaire ci-dessus
```

`make check` enchaîne les portes que la CI lance en **jobs parallèles** — il n'y a donc pas d'ordre à
égaler. Un vert local ne garantit pas une PR verte, pour deux raisons distinctes :

- **jamais rejoué en local** : `pr-title.yml`, les deux règles du ruleset de `main` — **CodeQL** et
  **code_quality** — qui bloquent une PR sans passer par le check `CI`, et le contrôle du job « Build
  client et déployable » qui lance le binaire et compare ce qu'il sert à la sortie de Vite (il lie un
  port, que `make dev` occupe déjà sur un poste) ;
- **rejoué, verdict pas garanti** : `govulncheck` et `pnpm audit` interrogent des bases vivantes et
  changent d'avis sans qu'un fichier bouge ; `go test -race` tourne ici sur darwin/arm64 et là-bas sur
  linux/amd64 ; le `pnpm install --frozen-lockfile` de la CI échoue là où un `node_modules`
  désynchronisé du lockfile masque l'écart en local.

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
cmd/dashboard/     le binaire : câblage, arrêt propre
internal/          le BFF — seul endroit qui connaît secrets, jeton Admin et base
  bff/ config/ webassets/ auth/ gateway/ hub/ alerting/ store/ permissions/
                   chaque package naît avec le code qui l'habite, jamais vide
                   webassets/ porte l'embed.FS des assets — `//go:embed` ne remonte pas au-dessus
                   de son répertoire, et le .gitignore n'y rend commitable que ce chemin
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
  merge sur `main` de `go-gateway` : dix-sept versions en douze jours, dont trois majeures (relevé le
  08/08/2026). Consigner l'écart dans la PR, **ne jamais bumper au milieu d'une step**, et **relire le
  diff du YAML** — une contrainte resserrée (`additionalProperties: false`, un `maximum`, un `enum`
  réduit) passe le typage et échoue à l'exécution, et **la compilation n'est pas le filet qu'on
  croit** : au bump de step-009, trois ruptures de type sont passées vertes faute d'appelant.
  `tasks/plan.md` §1.12.
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
meilleur nom ou une fonction extraite. La v1.0 était à **38 % de commentaire** côté serveur, et le
critère 2 ci-dessous existe parce que **certains de ces commentaires mentaient** sur le code qu'ils
surplombaient.

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

**Une step = une session = une PR.** Ce qui suit est ce qu'on exige d'une step, du premier commit au
merge — il n'y a pas de procédure plus détaillée ailleurs.

**Chaque phase s'ouvre par `using-agent-skills`** — contexte, plan, spécification, implémentation,
revue, débogage. Le méta-skill oriente vers le skill de la phase, et chacun porte un cadre que
l'improvisation ne reproduit pas. Le mode d'échec est silencieux : sans le skill on finit par
trouver, plus lentement et sans structure, donc rien ne signale l'oubli.

**Quatre portes**, dans l'ordre, chacune interdisant la suite tant qu'elle n'est pas franchie :
**design arrêté, écrit dans la fiche et commité** avant la première ligne de code · **rouge lu et
compris** avant la première ligne d'implémentation · **mutation vue tomber** avant de déclarer une
unité verte · **revue sans bloquant** avant de cocher la DoD — celle ci-dessous *et* celle de la fiche.

Ce que la boucle exige en propre sur ce dépôt :

- **L'ordre de `tasks/todo.md` fait foi**, pas le numéro — **sauf quand la ligne « Dépend de » de la
  fiche le contredit : les dépendances déclarées priment**. Une divergence constatée se corrige *dans
  le plan* avant d'écrire du code, jamais en la contournant en silence.
- Branche `feat/step-NNN-slug` (ou `fix/`, `docs/`, `chore/`, `test/`). **Commits atomiques au fil de
  l'eau** : une unité verte = un commit.
- **BDD strict, le scénario rouge d'abord**, jamais le code en premier — pour **chaque** reprise de
  code, correctifs de revue compris.
- La revue se fait en **sous-agents lecture seule** : ils remontent des constats, ils ne corrigent
  rien ; la correction revient à la session, et si le contexte manque, on **replanifie avant de
  toucher au code**. **Un correctif de revue est du code comme un autre** : même DoD, même mutation,
  même méfiance. En v1.0, une bonne part des constats des passes 2 à 5 portaient sur les correctifs
  des passes précédentes — ne jamais annoncer un correctif sans l'avoir vu tenir.
- Dernier commit : `git mv tasks/steps/step-NNN.md tasks/steps/done/`, ligne cochée dans
  `tasks/todo.md`. Puis PR — titre en conventional commit portant la step : `feat(routing): éditeur de
  route (step-121)` — et **merge dès que la CI est verte**. Si elle échoue : **deux relances au
  maximum**, ensuite on rend la main.
- Un jalon est terminé quand **toutes** ses steps sont dans `tasks/steps/done/`.

**Arbitrage.** Une décision se tranche d'abord sur le contexte disponible : spec, plan, contrat,
fichier de step. Si elle reste indécidable, consulter le modèle **Fable** plutôt que de trancher au
hasard.

Ne jamais déborder du périmètre d'une step. Ce qu'elle exclut est dans sa section « Hors périmètre ».

## Definition of Done (chaque PR)

`make check` vert • aucun invariant (a…e) violé • copie conforme aux fondamentaux de la charte •
clavier et libellés accessibles (WCAG 2.1 AA) sur tout écran touché • PR petite et focalisée (une
step) — plus les quatre critères ci-dessous.

> **Pourquoi quatre critères et non quatre portes de plus.** Les deux bloquants de la v1.0 ont franchi
> les douze portes de la CI : un bandeau de refus sans bordure faute de tokens existants, un QR code
> réduit à un carré noir de 176 pixels. Deux lignes de l'ancienne DoD — « copie conforme », « critères
> couverts par des tests » — se déclaraient vraies sans aucune preuve. Ce qui manquait n'était pas une
> vérification de plus : c'était de rendre falsifiable ce qu'on affirmait déjà.

**1. Le chemin qu'un humain traverse est traversé pour de bon.** Toute step qui livre un chemin d'écran
l'exerce de bout en bout au moins une fois — **en étendant un parcours existant** plutôt qu'en ajoutant
un fichier. « De bout en bout » veut dire **rien de simulé dans le produit** : pas de provider fourni
par le test, pas de client Query injecté, pas de module interne remplacé. Le mock Prism, lui, est la
frontière du système sous test. Trois défauts de la v1.0 ont été trouvés là et nulle part ailleurs : un
`QueryClientProvider` absent de l'application et que le harnais fournissait lui-même, une garde de
session qui ne s'exécutait jamais sur une URL collée pendant que trois tests la déclaraient verte, et
une boucle entre le login et le second facteur.

**2. Toute affirmation sur le monde extérieur est confrontée à sa source.** Trois formes, et les trois
ont menti : la **copie** qui décrit le produit se lit contre le code serveur qui l'implémente ; un
**commentaire** qui décrit un mécanisme se relit contre le code qu'il surplombe ; et ce qu'on écrit
dans un commit ou un rapport se vérifie sur la **sortie livrée**, pas sur l'intention du diff — un
remplacement scripté qui ne trouve pas son motif ne le dit pas. C'est ce critère qu'illustre le QR code
noir : la règle CSS avait été écrite sans lire ce que la bibliothèque émet, et le parcours qui
l'assertait visible restait vert.

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
- **Ajouter une permission** : trois endroits dans la même PR — le catalogue
  `internal/permissions/catalog.go`, la garde serveur qui l'exige, et les rôles par défaut de
  `internal/permissions/roles.go` (§6.10 de la spec). Le troisième n'est plus une consigne : depuis
  step-020, une clé qu'aucun rôle ne détient fait **rougir** `TestAucuneCleOrphelineHorsDesTroisDeliberees`
  — sauf à l'inscrire parmi les trois orphelines délibérées, ce qui se relit. Le TypeScript
  n'en dérive **pas encore** : `make generate` ne lit que les deux contrats OpenAPI — d'où il tire
  le client Go de l'API Admin, le serveur Go et les types TS du BFF, les trois que
  `check-generated` compare — et `internal/permissions/` n'existe pas. La dérivation arrive avec
  step-006 ; d'ici là, ce qui est tenu à la main ne l'est que par la relecture.
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
