# CLAUDE.md — Tableau de bord Admin (BFF Go + SPA React)

Manuel de travail pour Claude Code. Lis-le en entier avant d'écrire du code. **Il ne porte que ce qu'aucune commande ne rend** : le layout, les
cibles `make`, les jobs de CI et l'avancement se lisent dans `ls`, `make help`,
`.github/workflows/ci.yml` et `tasks/todo.md`. Les recopier ici n'épargnerait qu'une commande, et le
paierait le jour où la copie périme sans que rien ne le voie.

**Les règles propres au client vivent dans `web/CLAUDE.md`**, chargé quand la session y touche.

## Ce qu'on construit

Le **cockpit d'exploitation** de la passerelle SMS : un outil interne (100–300 opérateurs, thème
sombre, desktop-first) qui pilote clients, comptes SMPP, connecteurs, routage, conformité et
facturation. Ce n'est **pas** un portail client — les clients n'ont aucun accès à la plateforme.

**Un seul déployable** : un binaire Go sert la SPA *et* porte la logique BFF — carte de la cible, le
livré du jour se lit dans `ls internal/`. **Client** (`web/`) : React, TanStack Router + Query, une
WebSocket multiplexée, aucun secret. **Serveur** (`internal/`) : session et
authentification, permissions, audit, proxy vers l'API Admin, hub WebSocket, alertes métier. Le
navigateur ne parle qu'au BFF, qui parle à l'API Admin **et à son petit schéma PostgreSQL propre**,
distinct de celui de la passerelle. En production **≥2 instances** derrière un load balancer à
affinité WS, coordonnées par Redis Pub/Sub — un process unique serait un SPOF, et la cible de 99,9 %
inatteignable.

## Commandes

`make help` **fait foi** — la lancer plutôt que croire une liste. **`make check` avant toute PR.**
Poste neuf : séquence complète dans `README.md`, à commencer par l'authentification à GitHub Packages,
sans quoi l'installation des contrats échoue sur un 401 qui ne se nomme pas.

**Les bases sont vivantes.** Sans base joignable et migrée le binaire refuse de démarrer — il compare
la version du schéma avant de lier son port —, et **toute porte** qui le lance échoue avec lui : le
refus nomme la version trouvée et la version attendue (`web/playwright.config.ts:70-73`). Un avis de
sécurité publié ailleurs rend `main` rouge sans qu'aucun fichier ait bougé.

## Les cinq invariants — tests bloquants, verts à vie

Le code les cite par leur lettre.

- **(a) JAMAIS le corps d'un message hors de l'onglet qui l'affiche.** Ni log, ni toast, ni URL, ni
  message d'erreur, ni export, ni cache persisté, ni attribut de trace. L'affichage exige
  `content:read` et déclenche un appel **audité**.
- **TOUJOURS un DTO de sortie déclaré.** Une réponse HTTP est un struct Go, jamais une
  `map[string]any`, jamais un type de domaine marshalé directement. Un champ absent du struct ne peut
  pas fuir — c'est ainsi que (a) tient sans discipline.
- **(b) JAMAIS un secret réaffiché.** Identifiants de bind, clés API, secrets de webhook et de
  fournisseur : masqués en permanence, montrés exactement une fois à la création ou à la rotation.
  Aucune action « révéler » n'existe nulle part.
- **(c) TOUJOURS l'autorisation côté serveur, et l'audit avec elle.** Toute route de mutation porte une
  garde de permission **et** une écriture d'audit. Le rendu conditionnel de l'UI est un confort ; un
  contrôle masqué dont la route n'est pas gardée est une faille. Le middleware `requirePermission`
  (`internal/bff/guard.go`, monté en `router.go`) est **fermé par défaut** : une opération absente de
  sa table est refusée. Aucune entrée n'exige encore de clé — le premier `requires` arrive avec
  `POST /operators`, en step-029.
- **(d) JAMAIS le navigateur en direct sur l'API Admin.** Le jeton machine, le mTLS et la connexion
  PostgreSQL vivent sous `internal/`, que le langage rend inatteignable : (d) est une propriété du
  compilateur, pas une consigne. Le risque résiduel est côté client — voir `web/CLAUDE.md`.
- **Un contrôle interdit est désactivé et expliqué**, jamais silencieusement masqué : le refus nomme
  ce qui manque et par où passer. Vaut aussi pour un 403/409 rédigé dans `api/openapi-bff.yaml` ou
  dans un handler Go, pas seulement pour un bouton.
- **(e) JAMAIS sur le chemin critique du plan de données.** Une panne du tableau de bord dégrade la
  visualisation, jamais le débit de SMS ni la détection d'incident (Alertmanager est indépendant).

## Sources de vérité extérieures

- **Les contrats font foi** : le dépôt consomme `@martialanouman/gateway-api-contracts`, ne copie
  jamais un YAML ; tout manque se corrige par une PR dans `go-gateway/api/`, puis un bump ici.
- **TOUJOURS relever la version du contrat au début d'une step qui le touche** — il est publié à
  chaque merge sur `main` de `go-gateway`, à un rythme qui périme toute version notée ici. Consigner
  l'écart dans la PR, **jamais bumper au milieu**, et **relire le diff du YAML** : une contrainte
  resserrée (`additionalProperties: false`, un `maximum`, un `enum` réduit) passe le typage et échoue
  à l'exécution. **La compilation n'est pas le filet qu'on croit** — un type rompu qu'aucun appelant
  n'exerce passe vert. `tasks/plan.md` §1.12.
- **Versions & API : jamais devinées.** `ctx7` côté JS, `pkg.go.dev` ou `proxy.golang.org` côté Go,
  avant tout ajout, bump ou usage — et les CVE connues avant d'adopter. Une signature inventée
  compile parfois.

## Code & langue

**Le code est en anglais** — identifiants, packages, types, champs, fonctions. **Le narratif est en
français** — commentaires, Gherkin, titres de test, copie produit. Détail : `tasks/plan.md` §1.7.

**Commentaires avec parcimonie.** Un commentaire ne redit jamais ce que le code dit ; il ne subsiste
que là où le code ne peut pas parler : un *pourquoi*
contre-intuitif, un arbitrage dont l'alternative évidente est fausse, une contrainte externe
invérifiable sur place. Partout ailleurs, un meilleur nom ou une fonction extraite — le critère 2
existe parce que **certains commentaires de la v1.0 mentaient** sur le code qu'ils surplombaient.

**La copie produit** — y compris un message de refus écrit dans un handler Go — est en **français**,
troisième personne, **conséquence d'abord**. « Sécurisé » n'est jamais une promesse : dire ce que la
protection couvre et où s'arrête la frontière d'accès. Les états de contenu : `web/CLAUDE.md`.

## Tests — BDD

**Le comportement s'écrit en Gherkin avant d'exister** — c'est le « rouge d'abord » de la boucle.

- **Scénarios `godog`** (`.feature` en français, `# language: fr`) — le **comportement observable** du
  BFF, exprimé dans la langue du domaine. Le fichier vit **à côté du package qu'il décrit**, ses
  définitions de step dans un `_test.go` du même package. Contre le **mock Prism**, jamais contre la
  vraie passerelle.
- **Unitaires Go** — les mécanismes aux limites : hachage, curseurs, mappings, sérialisation des DTO.
  La majorité des tests, en nombre. Côté client : `web/CLAUDE.md`.

**Le mock-first n'est pas un confort mais la condition de faisabilité** : une large part des opérations
du contrat n'existe qu'au contrat, **côté passerelle**. Décompte à jour dans `tasks/plan.md` §16.

**Le mode d'échec est nommé** : un scénario par critère d'acceptation fabrique la suite qu'on n'ose
plus croire, et Gherkin l'aggrave parce que ça se lit bien. Trois symptômes de dérive, valables autant
pour un `describe`/`it` que pour un `.feature` : un `Alors` qui porte sur une structure plutôt qu'un
effet observable ; un `Plan du scénario` à quinze exemples qui teste un mapping ; deux scénarios qui ne
diffèrent que par une valeur. **Un scénario vert ne prouve pas plus qu'un test vert** — la mutation
reste obligatoire, critère 3.

## Recettes fréquentes

- **Ajouter une route BFF** — six escales, dans l'ordre : la déclarer dans `api/openapi-bff.yaml` →
  régénérer → écrire le scénario rouge, à côté du package décrit → le handler avec sa garde, son
  audit et son **DTO de sortie** → le fichier de route sous `web/src/routes/` → **régénérer l'arbre et
  commiter `routeTree.gen.ts`**, que `check-routes` garde. Détail client : `web/CLAUDE.md`.
- **Ajouter une permission** — quatre endroits dans la même PR : le catalogue
  `internal/permissions/catalog.go`, la garde serveur qui l'exige, les rôles par défaut de
  `internal/permissions/roles.go` (§6.10 de la spec), puis `make generate`, qui en dérive le
  TypeScript. Deux gardes tiennent les deux derniers : une clé qu'aucun rôle ne détient fait rougir
  `TestAucuneCleOrphelineHorsDesTroisDeliberees`, et `check-generated` rougit sur un TS non régénéré.

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
- Ne jamais déborder du périmètre d'une step. Ce qu'elle exclut est dans sa section « Hors périmètre ».

**Arbitrage.** Une décision se tranche d'abord sur le contexte disponible : spec, plan, contrat,
fichier de step. Si elle reste indécidable, consulter le modèle **Fable** plutôt que de trancher au
hasard.

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

## Index documentaire (source de vérité)

- Quoi/pourquoi : `docs/specification-technique-tableau-de-bord.md`
- Comment/dans quel ordre : `tasks/plan.md`
- Découpage en PRs : `tasks/todo.md` + `tasks/steps/step-NNN.md`
- Règles du client : `web/CLAUDE.md`
- Charte graphique & kit UI : `.claude/skills/sms-gateway-design/README.md`
- Contrat API : `@martialanouman/gateway-api-contracts` (jamais copié ici)
- Passerelle (dépôt séparé) : `../go-gateway`
