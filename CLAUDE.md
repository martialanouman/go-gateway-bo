# CLAUDE.md — Tableau de bord Admin (BFF Go + SPA React)

Manuel de travail pour Claude Code sur ce dépôt. Lis-le en entier avant d'écrire du code.

**Il ne porte que ce qu'aucune commande ne rend.** Le layout, les cibles `make`, les jobs de CI et
l'avancement se lisent dans `ls`, `make help`, `.github/workflows/ci.yml` et `tasks/todo.md` — les
recopier ici n'épargnerait qu'une commande, et le paierait le jour où la copie périme sans que rien
ne le voie.

## Ce qu'on construit

Le **cockpit d'exploitation** de la passerelle SMS : un outil interne (100–300 opérateurs, thème
sombre, desktop-first) qui pilote clients, comptes SMPP, connecteurs, routage, conformité et
facturation. Ce n'est **pas** un portail client — les clients n'ont aucun accès à la plateforme.

Le navigateur ne parle qu'au **BFF Go**, qui parle à l'**API Admin de la passerelle** (dépôt
`go-gateway`, séparé) et à son petit schéma PostgreSQL propre.

## Commandes

`make help` est la cible par défaut et **fait foi** — la lancer plutôt que croire une liste. Une cible
absente rend `No rule to make target`, jamais un vert silencieux. **`make check` avant toute PR.**

Poste neuf : la séquence complète est dans `README.md` — elle commence par une authentification à
GitHub Packages, sans quoi l'installation des contrats échoue sur un 401 qui ne se nomme pas. Sans
base joignable et migrée, le binaire refuse de démarrer — il compare la version du schéma avant même
de lier son port — et toute porte qui le lance échoue sans nommer la cause.

## Architecture (carte mentale)

**Un seul déployable** : un binaire Go sert la SPA *et* porte la logique BFF. Carte de la cible — le
livré du jour se lit dans `ls internal/`. Deux moitiés dans un même dépôt, séparées par une frontière
que le langage applique :

- **Client** (`web/`) — React, TanStack Router + Query, une WebSocket multiplexée. Aucun secret.
- **Serveur** (`internal/`) — session et authentification, permissions, journal d'audit, proxy vers
  l'API Admin, hub WebSocket, évaluateur d'alertes métier.

En production : **≥2 instances** derrière un load balancer avec affinité WS, coordonnées par Redis
Pub/Sub. Un process unique serait un SPOF et la cible de 99,9 % inatteignable.

## Règles d'or, et les cinq invariants qu'elles portent

Les cinq lettres sont des **tests bloquants, verts à vie** — le code les cite par leur étiquette.

- **(a) JAMAIS le corps d'un message hors de l'onglet qui l'affiche.** Ni log, ni toast, ni URL, ni
  message d'erreur, ni export, ni cache persisté, ni attribut de trace. L'affichage exige
  `content:read` et déclenche un appel **audité**.
- **TOUJOURS un DTO de sortie déclaré.** Une réponse HTTP est un struct Go, jamais une
  `map[string]any`, jamais un type de domaine marshalé directement. Un champ absent du struct ne peut
  pas fuir — c'est ainsi que l'invariant (a) tient sans discipline.
- **(b) JAMAIS un secret réaffiché.** Identifiants de bind, clés API, secrets de webhook et de
  fournisseur : masqués en permanence, montrés exactement une fois à la création ou à la rotation.
  Aucune action « révéler » n'existe nulle part.
- **(c) TOUJOURS l'autorisation côté serveur, et l'audit avec elle.** Toute route de mutation porte une
  garde de permission **et** une écriture d'audit — `RequirePermission()` en middleware. Le rendu
  conditionnel de l'UI est un confort ; un contrôle masqué dont la route n'est pas gardée est une
  faille.
- **(d) JAMAIS le navigateur en direct sur l'API Admin.** Le jeton machine, le mTLS et la connexion
  PostgreSQL vivent sous `internal/`, que le langage rend inatteignable : l'invariant (d) est une
  propriété du compilateur, pas une consigne. Le risque résiduel n'est plus un import mais une **URL
  codée en dur** dans le client — et **rien ne la cherche encore**, aucune porte ne lit le bundle.
- **(e) JAMAIS sur le chemin critique du plan de données.** Une panne du tableau de bord dégrade la
  visualisation, jamais le débit de SMS ni la détection d'incident (Alertmanager est indépendant).
- **Un contrôle interdit est désactivé et expliqué**, jamais silencieusement masqué.
- **Les contrats sont la source de vérité** : le dépôt consomme `@martialanouman/gateway-api-contracts`
  et ne copie jamais un YAML. Tout manque se corrige par une PR dans `go-gateway/api/`, puis un bump
  du package dans ce dépôt.
- **TOUJOURS relever la version du contrat au début d'une step qui le touche.** Il est publié à chaque
  merge sur `main` de `go-gateway`, à un rythme qui périme toute version notée ici. Consigner l'écart
  dans la PR, **ne jamais bumper au milieu d'une step**, et **relire le diff du YAML** : une contrainte
  resserrée (`additionalProperties: false`, un `maximum`, un `enum` réduit) passe le typage et échoue
  à l'exécution. **La compilation n'est pas le filet qu'on croit** — un type rompu qu'aucun appelant
  n'exerce passe vert. `tasks/plan.md` §1.12.
- **Versions & API : jamais devinées.** `ctx7` côté JS, `pkg.go.dev` ou `proxy.golang.org` côté Go,
  avant tout ajout, bump ou usage d'API — et les CVE connues avant d'adopter. Une signature inventée
  compile parfois.

## Code & langue

**Le code est en anglais** — identifiants, packages, types, champs, fonctions. **Le narratif est en
français** — commentaires, scénarios Gherkin, titres de test, copie produit.

**Commentaires avec parcimonie.** Un commentaire ne redit jamais ce que le code dit. Il ne subsiste
que là où le code ne peut pas parler : un *pourquoi* contre-intuitif, un arbitrage dont l'alternative
évidente est fausse, une contrainte externe invérifiable sur place. Partout ailleurs, la réponse est un
meilleur nom ou une fonction extraite — et le critère 2 existe parce que **certains commentaires de la
v1.0 mentaient** sur le code qu'ils surplombaient.

Interface en **français**, troisième personne, **conséquence d'abord**. « Sécurisé » n'est jamais une
promesse : dire ce que la protection couvre et où s'arrête la frontière d'accès.

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

**Un scénario vert ne prouve pas plus qu'un test vert.** La mutation reste obligatoire — critère 3.

**Le mock-first n'est pas un confort mais la condition de faisabilité** : une large part des
opérations du contrat n'existe qu'au contrat, côté passerelle. Décompte à jour dans `plan.md` §16.

## La boucle de travail

**Une step = une session = une PR.** Ce qui suit est tout ce qu'on exige d'une step, du premier commit
au merge — il n'y a pas de procédure plus détaillée ailleurs.

- **L'ordre de `tasks/todo.md` fait foi**, pas le numéro — **sauf quand la ligne « Dépend de » de la
  fiche le contredit : les dépendances déclarées priment**. Une divergence constatée se corrige *dans
  le plan* avant d'écrire du code, jamais en la contournant en silence.
- Branche `feat/step-NNN-slug` (ou `fix/`, `docs/`, `chore/`, `test/`). **Commits atomiques au fil de
  l'eau** : une unité verte = un commit.
- Dernier commit : `git mv tasks/steps/step-NNN.md tasks/steps/done/`, ligne cochée dans
  `tasks/todo.md`.
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
> les douze portes de la CI. Deux lignes de l'ancienne DoD — « copie conforme », « critères couverts
> par des tests » — se déclaraient vraies sans aucune preuve. Ce qui manquait n'était pas une
> vérification de plus : c'était de rendre falsifiable ce qu'on affirmait déjà.

**1. Le chemin qu'un humain traverse est traversé pour de bon.** Toute step qui livre un chemin d'écran
l'exerce de bout en bout, **en étendant un parcours existant** plutôt qu'en ajoutant un fichier. « De
bout en bout » veut dire **rien de simulé dans le produit** : pas de provider fourni par le test, pas
de client Query injecté, pas de module interne remplacé — le mock Prism, lui, est la frontière du
système sous test. *Trois défauts de la v1.0 n'ont été trouvés que là.*

**2. Toute affirmation sur le monde extérieur est confrontée à sa source.** Trois formes, et les trois
ont menti : la **copie** qui décrit le produit se lit contre le code serveur qui l'implémente ; un
**commentaire** qui décrit un mécanisme se relit contre le code qu'il surplombe ; et ce qu'on écrit
dans un commit ou un rapport se vérifie sur la **sortie livrée**, pas sur l'intention du diff — un
remplacement scripté qui ne trouve pas son motif ne le dit pas.

**3. Mutation obligatoire partout où le retrait laisserait la suite verte.** Le critère est cette
propriété, pas une liste : gardes, refus, redirections et verrous en font partie, mais aussi un focus
posé, un état conservé d'un onglet à l'autre, un succès annoncé — *sur les neuf correctifs de la v1.0
livrés sans filet, trois ne rentraient dans aucune énumération écrite d'avance*. Un test de rendu n'a
pas besoin de mutation : il tombe de lui-même. Et la mutation doit **reproduire le défaut réel** — une
qui laisse un verrou plus fermé que la version correcte reste verte et ne prouve rien.

**4. Ce qui n'est pas testable s'écrit là où il vit.** « Aucun test ne rougit si cette ligne disparaît,
ce qui a été vérifié plutôt que supposé » vaut mieux qu'un test qui fait semblant. Une DoD qui n'accepte
pas « je n'ai pas pu le tester, voici pourquoi » fabrique ce test-là.

**Les tests que réclame la step** sont ceux de sa section « Tests », qui énumère ses risques — chacun
avec une preuve **de la forme qui lui convient**. Un test par critère d'acceptation n'est pas demandé :
c'est ainsi qu'on écrit des tests de complaisance sur du code défensif jamais produit.

**Un seuil de couverture manqué est une question, jamais un ordre.** Ou bien le code est atteignable et
mérite un test, ou bien il ne l'est pas et mérite d'être supprimé, ou une exemption **commentée** —
jamais un seuil abaissé pour tout le monde.

## Recettes fréquentes

- **Ajouter une route BFF** : la déclarer dans `api/openapi-bff.yaml`, régénérer, écrire le scénario
  rouge, puis le handler avec sa garde, son audit et son **DTO de sortie**. Côté client : créer le
  fichier sous `web/src/routes/`, régénérer l'arbre, **commiter le fichier généré**.
- **Ajouter une permission** : quatre endroits dans la même PR — le catalogue
  `internal/permissions/catalog.go`, la garde serveur qui l'exige, les rôles par défaut de
  `internal/permissions/roles.go` (§6.10 de la spec), puis `make generate`, qui en dérive le
  TypeScript. Deux gardes tiennent les deux derniers : une clé qu'aucun rôle ne détient fait rougir
  `TestAucuneCleOrphelineHorsDesTroisDeliberees`, et `check-generated` rougit sur un TS non régénéré.
- **Un écran non encore livré** : route déclarée + état vide explicite nommant le jalon. Jamais une
  page blanche ni un lien mort.

## Index documentaire (source de vérité)

- Quoi/pourquoi : `docs/specification-technique-tableau-de-bord.md`
- Comment/dans quel ordre : `tasks/plan.md`
- Découpage en PRs : `tasks/todo.md` + `tasks/steps/step-NNN.md`
- Charte graphique & kit UI : `.claude/skills/sms-gateway-design/README.md`
- Contrat API : `@martialanouman/gateway-api-contracts` (jamais copié ici)
- Passerelle (dépôt séparé) : `../go-gateway`
