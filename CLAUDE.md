# CLAUDE.md — Tableau de bord Admin (TanStack Start)

Manuel de travail pour Claude Code sur ce dépôt. Lis-le en entier avant d'écrire du code. Il est
court volontairement : les détails vivent dans les documents référencés en bas.

## Ce qu'on construit

Le **cockpit d'exploitation** de la passerelle SMS : un outil interne (100–300 opérateurs, thème
sombre, desktop-first) qui pilote clients, comptes SMPP, connecteurs, routage, conformité et
facturation. Ce n'est **pas** un portail client — les clients n'ont aucun accès à la plateforme.

Le navigateur ne parle qu'au serveur TanStack Start (le **BFF**), qui parle à l'**API Admin de la
passerelle** (dépôt `go-gateway`, séparé) et à son petit schéma PostgreSQL propre.

## Commandes

```bash
pnpm dev          # serveur de développement (:3000)
pnpm build        # build Vite + Nitro → .output/
pnpm start        # sert le build en Node (.output/server/index.mjs)
pnpm typecheck    # tsc --noEmit
pnpm lint         # biome check
pnpm format       # biome check --write
pnpm test         # vitest run       (OBLIGATOIRE avant toute PR)
pnpm vuln         # pnpm audit — échoue sur tout avis non trié
pnpm check        # typecheck + lint + test + vuln + build
```

`pnpm check` vert signifie une CI verte, à une garde près : la CI vérifie en plus que
`src/routeTree.gen.ts` est bien à jour après build.

## Architecture (carte mentale)

**Un seul déployable** : un process Node sert l'application rendue *et* la logique BFF. Deux moitiés
dans un même dépôt, séparées par une frontière stricte :

- **Client** (`src/routes/`, `src/components/`) — React, TanStack Query, une WebSocket multiplexée.
- **Serveur / BFF** (`src/server/`) — session et authentification, application des permissions,
  journal d'audit, proxy vers l'API Admin, hub WebSocket, évaluateur d'alertes métier.

En production : **≥2 instances** derrière un load balancer avec affinité WS, coordonnées par Redis
Pub/Sub. Un process unique serait un SPOF et la cible de 99,9 % serait inatteignable.

## Layout du dépôt

```
src/routes/      routage par fichiers (les écrans)
src/server/      le BFF — seul endroit qui connaît secrets, jeton Admin et base
src/components/  composants partagés (primitives Base UI + tokens de la charte)
src/lib/         utilitaires partagés client/serveur, sans secret
src/styles/      tokens de la charte v1.0
docs/            spécification et plan d'exécution
tasks-todo/      steps à faire · tasks-done/ steps livrées
```

## Règles d'or (toujours / jamais)

- **JAMAIS le corps d'un message hors de l'onglet qui l'affiche.** Ni log, ni toast, ni URL, ni
  message d'erreur, ni export, ni cache persisté, ni attribut de trace. L'affichage exige
  `content:read` et déclenche un appel **audité**. Invariant testable, pas un réglage.
- **JAMAIS un secret réaffiché.** Identifiants de bind, clés API, secrets de webhook et de
  fournisseur : masqués en permanence, montrés exactement une fois à la création ou à la rotation.
  Aucune action « révéler » n'existe nulle part.
- **TOUJOURS l'autorisation côté serveur.** `requirePermission()` dans la fonction serveur. Le rendu
  conditionnel de l'UI est un confort ; un contrôle masqué dont la route n'est pas gardée est une
  faille.
- **JAMAIS le navigateur en direct sur l'API Admin.** Le jeton machine, le mTLS et la connexion
  PostgreSQL vivent sous `src/server/` — une règle de lint l'applique, ne la désactive pas.
- **JAMAIS sur le chemin critique du plan de données.** Une panne du tableau de bord dégrade la
  visualisation, jamais le débit de SMS ni la détection d'incident (Alertmanager est indépendant).
- **Un contrôle interdit est désactivé et expliqué**, jamais silencieusement masqué.
- **Les contrats sont la source de vérité** : le dépôt consomme `@martialanouman/gateway-api-contracts`
  et ne copie jamais un YAML. Tout manque se corrige par une PR dans `go-gateway/api/`.
- **Versions & API de bibliothèques : TOUJOURS via `ctx7`.** Avant d'ajouter, de mettre à jour ou
  d'utiliser l'API d'une bibliothèque, récupère la doc à jour. Ne devine JAMAIS un numéro de version
  ni une signature — elles changent entre majeures.

## Les 5 invariants (tests bloquants, verts à vie)

**(a)** le corps ne fuit dans aucune sérialisation et chaque lecture est auditée ; **(b)** aucun
secret n'est jamais réaffiché ; **(c)** toute route de mutation a une garde de permission et une
écriture d'audit ; **(d)** aucun composant client n'importe le client Admin ni la base ; **(e)** une
panne du tableau de bord ne dégrade que la visualisation.

## Copie & langue

Interface en **français**, troisième personne, **conséquence d'abord**. Les identifiants techniques
restent en anglais et en mono, verbatim du contrat : `link_status`, `breaker_state`, `max_sessions`,
`balance_scope`, `half_open`, `query_sm`. Ne jamais traduire un identifiant — un opérateur le grep
dans les logs. « Sécurisé » n'est jamais une promesse : dire ce que la protection couvre et où
s'arrête la frontière d'accès.

**Cinq états de contenu, cinq copies distinctes** : chargement (squelette de la vraie mise en page) ·
vide (rien encore + comment créer) · aucun résultat (filtres trop étroits + comment élargir) · module
désactivé (dégradation propre, **jamais** une erreur) · erreur (réalité HTTP + « vos données locales
restent affichées » + Réessayer).

## Tests

Pyramide : beaucoup d'unitaires (logique BFF, permissions, mappings), des tests de composant
(Testing Library), très peu de bout en bout (Playwright, cinq parcours). Les écrans se testent
**contre le mock Prism**, jamais contre la vraie passerelle.

> **71 des 134 opérations du contrat ne sont pas encore implémentées côté passerelle.** Métriques,
> CDR/trace, sessions, facturation, contenu/RGPD, groupes de clients, webhooks et sender-rewrite
> n'existent qu'au contrat. Le développement mock-first n'est pas un confort, c'est la condition de
> faisabilité — voir §15 du plan d'exécution.

## La boucle de travail

**Une step = une session = une PR.** À suivre strictement, dans cet ordre.

1. Prendre le prochain `tasks-todo/step-NNN.md` — **l'ordre du fichier `INDEX.md` fait foi**, pas le
   numéro. **Sauf quand la ligne « Dépend de » du fichier de step le contredit : les dépendances
   déclarées priment toujours.** Les sections de l'INDEX groupent par jalon, donc par thème, et un
   jalon peut se clore après le début du suivant. Une divergence constatée se corrige *dans le plan*
   avant d'écrire du code — jamais en la contournant en silence. C'est arrivé une fois (M1 et M2, note
   † de `INDEX.md`) et l'ordre annoncé était alors littéralement inexécutable.
2. Créer la branche : `feat/step-NNN-slug` (ou `fix/`, `docs/`, `chore/`, `test/`).
3. **Toujours établir un plan avant d'écrire la moindre ligne**, et en dériver la **todo list**
   d'implémentation — une entrée par unité livrable, tenue à jour au fil de la step.
4. Implémenter en **TDD strict : le test rouge d'abord**, jamais le code en premier. Périmètre limité
   à ce que le fichier de step décrit — rien de plus. Passer par `using-agent-skills` **avant toute
   modification du code source**, correctifs de revue compris — pas seulement au démarrage.
   **Commits atomiques au fil de l'eau** : une unité cohérente verte = un commit, jamais la step
   entière d'un bloc.
5. Après l'implémentation, lancer la **revue dans des sous-agents en lecture seule** : ils remontent
   des constats, ils ne corrigent rien. La correction revient à la session, via `using-agent-skills`.
   Si le contexte manque pour corriger un constat, **replanifier avant de toucher au code**. Relancer
   la revue **tant qu'il reste des constats bloquants**.
6. Vérifier la **Definition of Done du fichier de step** : `pnpm check` vert (typecheck · lint · test
   · vuln · build), invariants (a…e) intacts.
7. Dernier commit de la PR : `git mv tasks-todo/step-NNN.md tasks-done/` et cocher la ligne dans
   `tasks-todo/INDEX.md`.
8. Ouvrir la PR — titre en conventional commit avec la step : `feat(routing): éditeur de route
   (step-121)` — puis **merger dès que la CI est verte**. Si la CI échoue : **deux relances au
   maximum**, ensuite on s'arrête et on rend la main plutôt que d'insister.
9. Un jalon est terminé quand **toutes** ses steps sont dans `tasks-done/`.

**Arbitrage.** Une décision se tranche d'abord sur le contexte disponible : spec, plan d'exécution,
contrat, fichier de step. Si elle reste indécidable après ça, consulter le modèle **Fable** plutôt
que de trancher au hasard.

Ne jamais déborder du périmètre d'une step. Ce qu'elle exclut est listé dans sa section « Hors
périmètre » et appartient à une autre PR.

## Definition of Done (chaque PR)

`pnpm check` vert (typecheck · lint · test · vuln · build) • critères d'acceptation couverts
par des tests • aucun invariant (a…e) violé • copie française conforme • clavier et libellés
accessibles (WCAG 2.1 AA) sur tout écran touché • PR petite et focalisée (une step).

## Recettes fréquentes

- **Ajouter une dépendance** : d'abord `ctx7` pour la version et l'API à jour, puis `pnpm add`. Jamais
  de version devinée. Un paquet qui exige un script d'installation doit être autorisé explicitement
  dans `pnpm-workspace.yaml` (`allowBuilds`) — avec une justification.
- **Ajouter une route** : créer le fichier sous `src/routes/`, lancer `pnpm build` pour régénérer
  `src/routeTree.gen.ts`, et **commiter le fichier généré** (la CI le vérifie).
- **Ajouter une permission** : trois endroits en même temps — le seed du catalogue, la garde serveur
  qui l'utilise, et le tableau des rôles par défaut (§6.10 de la spec).
- **Un endpoint manque au contrat** : ouvrir une PR dans `go-gateway/api/` (YAML + bump de
  `api/package.json`), puis mettre à jour la dépendance ici. Ne jamais contourner.
- **Un écran non encore livré** : route déclarée + état vide explicite nommant le jalon. Jamais une
  page blanche ni un lien mort.

## Index documentaire (source de vérité)

- Quoi/pourquoi : `docs/specification-technique-tableau-de-bord.md`
- Comment/dans quel ordre : `docs/plan-execution-tableau-de-bord.md`
- Découpage en PRs : `tasks-todo/INDEX.md` + `tasks-todo/step-NNN.md`
- Charte graphique & kit UI : `.claude/skills/sms-gateway-design/README.md`
- Contrat API : `@martialanouman/gateway-api-contracts` (jamais copié ici)
- Passerelle (dépôt séparé) : `../go-gateway`
