---
name: impl-step
description: Procédure obligatoire pour implémenter une step de tasks/steps/. À invoquer AVANT toute lecture de code et toute écriture, dès qu'une step est engagée — « attaque step-NNN », « implémente step-NNN », « continue sur step-NNN », « enchaîne sur la suivante », « prends la prochaine step ». Passe par using-agent-skills à chaque phase, implémente en sub-agents parallèles, fait relire par des sub-agents en lecture seule. Quatre portes bloquantes : design commité avant le code, rouge lu avant l'implémentation, mutation vue tomber avant « vert », revue sans bloquant avant la DoD.
---

# Implémenter une step

Une step = une session ciblée = **une PR petite et verte** (`CLAUDE.md`, « La boucle de travail »).

Les neuf phases ci-dessous sont **ordonnées et non réordonnables**. Avant de commencer, crée **une todo
par phase** : c'est ce qui rend une phase sautée visible au lieu de la laisser passer inaperçue.

Quatre phases sont des **PORTES** : tant qu'une porte n'est pas franchie, l'étape suivante est
interdite, même si le travail semble évident.

---

## Règle transverse — passer par `using-agent-skills`

À l'entrée de **chaque** phase, invoque `using-agent-skills` puis le skill qu'il désigne. Ce n'est pas
un rituel : `using-agent-skills` est le routeur qui sait quel skill encode le savoir-faire de la phase,
et ces skills portent des vérifications qu'on oublie systématiquement de refaire de tête (les axes de
revue, la forme d'un test qui prouve quelque chose, la discipline de scope). Sauter l'appel, c'est
refaire la phase de mémoire — c'est exactement là que les erreurs passent. Le mode d'échec est
silencieux : sans le skill on finit par trouver, plus lentement et sans structure, donc rien ne signale
l'oubli.

| Phase | Ce que tu demandes à `using-agent-skills` | Skill attendu |
|---|---|---|
| 1 · Contexte | charger le bon contexte avant d'écrire | `context-engineering`, + `find-docs`/`ctx7` si bibliothèque |
| 2 · Arbitrages | trancher des décisions non triviales sous doute | `doubt-driven-development` |
| 3 · Design | consigner des décisions et leur raison | `documentation-and-adrs` |
| 4 · Plan | découper en unités vérifiables | `planning-and-task-breakdown` |
| 5 · TDD | rouge d'abord, tranches fines | `test-driven-development`, `incremental-implementation` |
| 6 · Mutation | prouver que les assertions mordent | `test-driven-development` |
| 7 · Revue | revue multi-axes avant merge | `code-review-and-quality` (+ `security-and-hardening` si surface exposée) |
| 8 · DoD | portes qualité du dépôt | `ci-cd-and-automation` |
| 9 · Livraison | commits atomiques, PR propre | `git-workflow-and-versioning` |

Le dépôt a **deux versants**. Côté serveur, `golang-how-to` s'active en plus dès qu'on touche à
`internal/` ou `cmd/` et charge les skills Go pertinents (erreurs, tests, concurrence, base de
données…) — laisse-le faire, il voit mieux que toi quelles familles sont en jeu. Côté client, toute
step qui livre un écran passe par `frontend-ui-engineering` **et** par la charte
`.claude/skills/sms-gateway-design` : la copie, les cinq états de contenu et le clavier sont dans la
DoD, pas dans le « si on a le temps ».

---

## Phase 1 — Contexte

`using-agent-skills` → `context-engineering`.

Rassembler avant d'écrire une ligne :

- la **fiche** `tasks/steps/step-NNN.md` en entier — but, périmètre, pièges connus, points clés, tests,
  DoD, **hors périmètre**. C'est `tasks/todo.md` qui donne l'ordre, **sauf quand la ligne « Dépend
  de » de la fiche le contredit : les dépendances déclarées priment**. Une divergence constatée se
  corrige *dans le plan*, jamais en la contournant en silence ;
- la section de `tasks/plan.md` que la fiche cite, et le passage correspondant de
  `docs/specification-technique-tableau-de-bord.md` (v2.1) ;
- les **contrats** : `@martialanouman/gateway-api-contracts` (jamais recopié ici) et, dès qu'il
  existe, `api/openapi-bff.yaml`. Le code s'y conforme, jamais l'inverse ;
- le **précédent le plus proche** dans le code — la step qui a résolu un problème de même forme.
  Le suivre coûte moins cher que d'inventer un second patron. Le dépôt est jeune : quand il n'y a pas
  de précédent, dis-le en phase 2, c'est un arbitrage, pas une évidence.

**Si la step touche le contrat, relève sa version ici et seulement ici.** Il est publié à chaque merge
sur `main` de `go-gateway` — dix versions en une semaine, dont une majeure. Consigne l'écart, et **lis
le diff du YAML** plutôt que le numéro : une contrainte resserrée (`additionalProperties: false`, un
`maximum`, un `enum` réduit) passe le typage et échoue à l'exécution. Ne bumpe **jamais** au milieu
d'une step.

Si une bibliothèque est en jeu — ajout, bump, ou simple usage d'une API — c'est ici qu'on appelle
`ctx7` (JS) ou `pkg.go.dev` / `proxy.golang.org` (Go), et qu'on vérifie **dans la source du module**
ce qui engage la correction. Une signature devinée de mémoire est la panne la plus chère du lot : elle
compile parfois.

Cette phase se parallélise bien : lancer plusieurs `Explore` (lecture seule) sur des axes disjoints
— la fiche et son plan, le précédent dans le code, les contrats concernés — coûte moins cher qu'une
lecture séquentielle et ne risque rien puisque personne n'écrit.

## Phase 2 — Arbitrages · **PORTE 1**

`using-agent-skills` → `doubt-driven-development`.

Lister **tous** les points que la fiche laisse ouverts. Aucun ne se tranche en silence : un choix fait
sans trace est un choix que personne ne pourra contester en revue.

Échelle d'arbitrage, dans cet ordre :

1. **La spec.** `docs/specification-technique-tableau-de-bord.md`, `tasks/plan.md`, la fiche, la charte
   graphique, les contrats. La réponse y est plus souvent qu'on ne croit — cherche avant de délibérer.
2. **Le modèle Fable**, si la spec ne tranche pas. Lui soumettre la décision, les options, les extraits
   de spec pertinents et les contraintes :

   ```
   Agent(subagent_type: "general-purpose", model: "fable",
         prompt: "<décision> · <options et leurs conséquences> · <ce que dit la spec> · <contraintes>
                  Tranche et justifie. Si tu ne peux pas trancher, dis-le explicitement et dis pourquoi.")
   ```

   **Si Fable tranche clairement et sans contredire la spec, on applique** et on consigne la décision
   avec sa raison. On remonte à l'humain seulement si Fable refuse de trancher, se contredit, ou
   propose quelque chose que la spec interdit.
3. **L'arbitrage de l'utilisateur**, en dernier recours. Toujours options + recommandation motivée,
   jamais une question nue : une question nue transfère le travail de réflexion au lieu de la décision.

## Phase 3 — Design écrit et commité · **PORTE 1 (suite)**

`using-agent-skills` → `documentation-and-adrs`.

Écrire les décisions dans la fiche, sous `## Design arrêté (AAAA-MM-JJ)`, une par titre `### DN — …`,
chacune avec **la raison**, pas seulement le choix. Puis :

```bash
git checkout -b <type>/step-NNN-<slug>     # feat/ fix/ docs/ chore/ test/
git commit -m "docs(tasks): arrêter le design de step-NNN (…)"
```

**Aucune ligne de code avant que ce commit existe.** C'est la porte : elle force à savoir ce qu'on
construit et pourquoi, elle laisse une trace lisible en revue, et elle empêche l'inversion la plus
fréquente — écrire le code puis fabriquer la justification qui lui va.

## Phase 4 — Plan et todos

`using-agent-skills` → `planning-and-task-breakdown`.

**Toujours un plan avant la moindre implémentation.** Découper en unités livrables, chacune avec son
cycle rouge → vert → commit. Une unité = ce qu'un relecteur peut accepter ou refuser seul, et **une
unité verte = un commit** — jamais la step entière d'un bloc.

Le plan sert aussi à décider ce qui se parallélise. Marque pour chaque unité **les fichiers qu'elle
touche** : deux unités qui partagent un fichier ne partent jamais en parallèle (voir phase 5).

Crée la todo list ici, une entrée par unité, en plus des todos de phase. C'est le seul point de
visibilité pendant une boucle autonome.

## Phase 5 — TDD · **PORTE 2**

`using-agent-skills` → `test-driven-development` + `incremental-implementation`.

Le dépôt est en **BDD strict** : le comportement observable s'écrit en Gherkin *avant* d'exister —
`.feature` en français (`# language: fr`) à côté du package qu'il décrit, définitions de step dans un
`_test.go` du même package, exécuté contre le **mock Prism**, jamais contre la vraie passerelle. Les
mécanismes aux limites (hachage, curseurs, mappings, sérialisation des DTO) sont des unitaires Go, et
c'est là qu'est la majorité des tests en nombre. Côté client, Vitest + Testing Library en forme Étant
donné / Quand / Alors, sans second moteur Cucumber.

Pour chaque unité, dans cet ordre :

1. écrire le test ;
2. **le lancer et lire son message d'échec.** Il doit échouer *pour la bonne raison* — un test qui
   échoue parce que le symbole n'existe pas encore est correct ; un test qui échoue parce que le mock
   Prism n'est pas lancé ne prouve rien de ce qu'il affirme ;
3. implémenter le minimum ;
4. relancer.

**Aucune ligne d'implémentation avant un rouge lu.**

Garde en tête le mode d'échec que `CLAUDE.md` nomme : un scénario par critère d'acceptation fabrique
une suite qu'on n'ose plus croire, et Gherkin l'aggrave parce que ça se lit bien. Trois symptômes de
dérive : un `Alors` qui porte sur une structure de données plutôt qu'un effet observable ; un `Plan du
scénario` à quinze exemples qui teste un mapping ; deux scénarios qui ne diffèrent que par une valeur.

### Paralléliser les unités indépendantes

Les unités qui ne partagent **aucun fichier** partent en sub-agents simultanés (un seul message, un
`Agent` par unité). Celles qui partagent un fichier restent séquentielles : deux agents qui éditent le
même fichier produisent un demi-fichier, pas un conflit propre.

Chaque sub-agent reçoit un mandat complet et autonome — il ne voit pas ta conversation :

```
Agent(subagent_type: "general-purpose",
      prompt: "Unité <N> de step-NNN : <objectif>.
               Design arrêté applicable : <DN concernées, recopiées>.
               Fichiers dont tu es le SEUL propriétaire : <liste>. N'édite rien d'autre.
               Procédure imposée : écris le test, LANCE-LE, cite son message d'échec dans ton
               rapport, puis implémente le minimum, relance.
               NE COMMITE RIEN, ne crée ni branche ni PR : les commits sont faits par la session.
               Rends : le message du rouge, les fichiers touchés, le résultat final du test.")
```

Deux exigences, deux raisons distinctes. **Le message du rouge dans le rapport** est la seule preuve
que le sub-agent a fait du TDD et non écrit le code puis un test complaisant par-dessus — un rapport
sans rouge cité = unité à refaire. **L'interdiction de commiter** garde l'historique lisible : des
agents qui commitent en parallèle entrelacent des commits que personne n'a relus, et le découpage
« une unité verte = un commit » disparaît. Tu commites, une unité à la fois, après avoir lu le diff.

Si une unité est en doute — code inconnu, invariant sensible, opération irréversible — c'est
`doubt-driven-development` qu'il faut, pas plus de parallélisme.

## Phase 6 — Mutation · **PORTE 3**

Avant de déclarer une unité verte : casser volontairement le comportement testé et **voir le test
tomber**. Une assertion jamais vue échouer n'est pas une assertion.

```bash
cp fichier.go /tmp/f.bak    # muter, lancer, constater l'échec, restaurer
cp /tmp/f.bak fichier.go
```

La règle du dépôt est une **propriété, pas une liste** : muter partout où le retrait laisserait la
suite verte. Gardes, refus, redirections et verrous en font partie, mais aussi un focus posé, un état
conservé d'un onglet à l'autre, un succès annoncé. Un test de rendu n'a pas besoin de mutation : il
tombe de lui-même.

Deux pièges qui ont coûté cher :

- **La mutation doit reproduire le défaut réel.** Une mutation qui laisse un verrou *plus fermé* que la
  version correcte reste verte et ne prouve rien.
- **Se méfier d'un test qui passe du premier coup** : il passe peut-être pour une raison qui n'est pas
  celle qu'il annonce — fixture creuse, provider fourni par le harnais et absent du produit, détecteur
  qui cherche un nom dans du texte source et que le moindre commentaire rend toujours vrai.

Tenir le **tableau des mutations** au fil de l'eau (mutation appliquée → test qui tombe) : c'est ce qui
part dans le corps de PR en phase 9.

Ce qui n'est pas testable s'écrit là où il vit : « aucun test ne rougit si cette ligne disparaît, ce
qui a été vérifié plutôt que supposé » vaut mieux qu'un test qui fait semblant.

## Phase 7 — Revue par sub-agents en lecture seule · **PORTE 4**

`using-agent-skills` → `code-review-and-quality`.

Lancer plusieurs relecteurs **en lecture seule** en parallèle, chacun sur un axe distinct. La lecture
seule est structurelle : `subagent_type: "Plan"` n'a ni `Edit` ni `Write`. Les relecteurs constatent,
**c'est toi qui corriges** — un relecteur qui répare son propre constat ne le rapporte plus, et le
constat disparaît sans que personne l'ait jugé.

Des axes distincts trouvent plus que des relecteurs redondants. Pour ce dépôt :

- **Les cinq invariants** — (a) le corps de message ne fuit dans aucune sérialisation et chaque lecture
  est auditée ; (b) aucun secret n'est jamais réaffiché ; (c) toute route de mutation a une garde de
  permission *et* une écriture d'audit ; (d) le client ne joint jamais l'API Admin (URL codée en dur
  dans le bundle, pas seulement un import) ; (e) une panne du tableau de bord ne dégrade que la
  visualisation ;
- **DTO et frontière serveur** — toute réponse HTTP est un struct déclaré, jamais une `map[string]any`
  ni un type de domaine marshalé ; `context.Context` en premier paramètre ; chemins d'erreur ; races ;
- **Contrats** — conformité au contrat consommé et à `api/openapi-bff.yaml` ; le code se conforme au
  contrat et jamais l'inverse ;
- **Tests** — est-ce que chaque test peut réellement échouer ? fixtures creuses, scénarios qui skippent
  en silence, `Alors` qui n'observe qu'une structure de données, assertions qui n'assertent rien ;
- **Interface** (si la step livre un écran) — copie en français, troisième personne, conséquence
  d'abord ; identifiants techniques verbatim et non traduits ; les cinq états de contenu ; contrôle
  interdit désactivé **et expliqué**, jamais masqué ; clavier et libellés (WCAG 2.1 AA).

Demande à chaque relecteur de classer ses constats : **bloquant** (défaut de correction, invariant
violé, contrat trahi) · **à corriger** (dette lisible qu'on ne laisse pas passer) · **note** (avis).

```
Agent(subagent_type: "Plan",
      prompt: "Relis le diff de step-NNN (`git diff main...HEAD`) sur l'axe <axe>.
               Design arrêté : <DN>. Ne modifie aucun fichier.
               Pour chaque constat : fichier:ligne, le défaut, le scénario concret qui casse,
               et une classification bloquant | à corriger | note.")
```

**Boucler tant qu'il reste un bloquant** : tu corriges, tu relances une revue sur le nouveau diff. Un
correctif de revue est du code comme un autre — même entrée par `test-driven-development`, même
mutation, même méfiance. En v1.0, une bonne part des constats des passes 2 à 5 portaient sur les
correctifs des passes précédentes ; ne jamais annoncer un correctif sans l'avoir vu tenir.

Si le même bloquant survit à trois tours, arrête la boucle et remonte-le à l'utilisateur avec les
positions en présence : à ce stade ce n'est plus un défaut, c'est un désaccord de conception, et il se
tranche par la phase 2, pas par un tour de revue de plus.

## Phase 8 — Definition of Done

`using-agent-skills` → `ci-cd-and-automation`.

```bash
gofmt -l cmd internal    # vide
make check               # toutes les portes de la CI, en une commande
```

Dès qu'un test parle à Postgres ou Redis, préfixer :
`DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock` — sinon les tests conteneurisés **skippent en
silence**, et un skip est vert. Vérifier qu'ils ont réellement tourné (`-v`) avant de s'appuyer dessus.

**Un `make check` vert ne garantit pas une PR verte**, pour deux raisons distinctes que `CLAUDE.md`
détaille. Ce qu'il ne rejoue pas du tout : `pr-title.yml`, et les deux règles du ruleset de `main` —
**CodeQL** et **code_quality** — qui bloquent sans passer par le check `CI`. Ce qu'il rejoue sans que
le verdict soit le même : `govulncheck` et `pnpm audit`, qui interrogent des bases vivantes, et `go
test -race`, qui tourne ici sur darwin/arm64 et là-bas sur linux/amd64. S'y ajoute le `pnpm install
--frozen-lockfile` de la CI, qu'un `node_modules` désynchronisé masque en local.

Si le **contrat** a bougé : mettre à jour `@martialanouman/gateway-api-contracts` dans
`web/package.json` avec son lockfile, relire le diff du YAML (phase 1), et régénérer ce qui en dérive.
Un endpoint qui manque au contrat se corrige par une PR dans `go-gateway/api/`, jamais par un YAML
recopié ici. Si une **route BFF** est ajoutée : déclarée dans `api/openapi-bff.yaml`, régénérée,
scénario rouge, puis handler avec sa garde, son audit et son **DTO de sortie**. Si une **permission**
est ajoutée : trois endroits dans la même PR — catalogue `internal/permissions/`, garde serveur,
tableau des rôles par défaut — puis `make generate`. Si une **route client** est ajoutée : l'arbre de
routes régénéré **et commité** (`make check-routes` le vérifie).

Puis cocher la DoD de la fiche en **nommant les tests** qui couvrent chaque critère, et vérifier les
quatre critères transverses de `CLAUDE.md` : le chemin humain traversé pour de bon (rien de simulé dans
le produit) · toute affirmation sur le monde extérieur confrontée à sa source · mutation partout où le
retrait laisserait la suite verte · ce qui n'est pas testable écrit là où il vit. Un critère coché sans
nom de test est une case cochée, pas un critère couvert.

Un seuil de couverture manqué est une **question**, jamais un ordre : ou bien le code est atteignable
et mérite un test, ou bien il mérite d'être supprimé, ou une exemption **commentée** — jamais un seuil
abaissé pour tout le monde.

## Phase 9 — Livraison

`using-agent-skills` → `git-workflow-and-versioning`.

```bash
git mv tasks/steps/step-NNN.md tasks/steps/done/    # dernier commit de la PR
```

Cocher la ligne dans `tasks/todo.md`, ouvrir la PR — titre en conventional commit portant la step,
`feat(routing): éditeur de route (step-121)` —, attendre la CI, **merger dès qu'elle est verte**. Si
elle échoue : **deux relances au maximum**, ensuite on rend la main.

Corps de PR : les décisions **DN** avec leur raison, les ruptures assumées, le **tableau des mutations**
(phase 6), et les bloquants remontés en revue avec leur résolution.

Un jalon est terminé quand **toutes** ses steps sont dans `tasks/steps/done/`.

---

## Pièges constatés sur le terrain

- **`cmd1 | tail` masque le code de sortie.** `make check | tail -3 && git commit` commite même sur
  échec. Rediriger vers un fichier et tester `$?`.
- **Un correctif se vérifie sur le livré, pas sur l'intention du diff.** Un remplacement scripté qui ne
  trouve pas son motif ne le dit pas. Relire la sortie, pas la commande.
- **Édition par script sur du code déjà transformé** : le remplacement se mord la queue et laisse le
  fichier à moitié édité. Au-delà d'une substitution triviale, éditer à la main.
- **Un harnais de test peut masquer une absence en production** — un provider fourni par le test a
  caché pendant trois tests verts qu'il n'existait nulle part dans l'application. C'est ce que le
  premier critère de la DoD attrape, et rien d'autre ne l'attrape.
- **Un détecteur statique par recherche de nom ne garde rien** : commentaires et homonymes le rendent
  toujours vrai. Chercher l'import, ou l'URL dans le bundle produit.
- **Une garde trop large finit retirée.** La confronter à l'inventaire réel du contrat avant de la
  poser : 62 des 133 opérations n'existent qu'au contrat, une garde qui refuse du légitime se fera
  désactiver plutôt que corriger.
- **Une cible `make` absente rend `No rule to make target`, jamais un vert silencieux** — mais une
  cible *vide* passe pour verte. `make help` fait foi sur ce qui existe.
- **Un sub-agent ne voit pas ta conversation.** Le design arrêté, les fichiers autorisés, la procédure
  attendue et l'interdiction de commiter se recopient dans son prompt, sinon il réinvente — et il
  réinvente autrement que ses voisins lancés en même temps.
- **Deux sub-agents sur un même fichier le cassent.** Le partage de fichier, pas la proximité
  thématique, est le critère de séquentialité.
