# Ce que le terrain a coûté

Les cas qui ont produit les règles de `SKILL.md`. À lire quand une règle paraît chère, excessive ou
évidente à contourner — chacune est ici, avec ce qu'elle a coûté d'être absente.

Ce fichier n'est **pas** à charger pour exécuter une step. Il sert à trancher un désaccord sur une
règle, ou à instruire une nouvelle.

---

## Un commentaire qui explique un mécanisme se mesure d'abord

**step-002** — huit des dix bloquants de revue portaient sur une affirmation : commentaire, ligne de
documentation ou message d'erreur, décrivant un mécanisme faux ou promettant une preuve inexistante.
**Trois avaient été écrits par les correctifs de la passe précédente.**

Les quatre qui se ressemblent le plus :

- « Aucune mutation ne fait tomber cette ligne : c'est `ServeFileFS` qui purge l'en-tête » —
  `ServeFileFS` n'était jamais appelé sur ce chemin. L'assertion mordait, et sa mutation était
  triviale : hisser le `Set` au-dessus de la garde.
- « Avant d'ouvrir le port : un binaire dont les assets sont inutilisables ne sert à rien » — la garde
  n'existait pas. `fs.Sub` ne peut échouer que sur un chemin invalide, ici une constante.
- « C'est la garde `IsDir` qui rend les trois cas identiques en production » — le 500 invoqué était
  inatteignable, et l'effet appartenait à la branche `err != nil`.
- « Tout ce qui précède `m.Run` échappe au `-timeout` sans limite » — `cmd/go` arme
  `testTimeout + 1 min` autour du binaire entier.

Le motif ne varie jamais : on **déduit** le comportement de la bibliothèque au lieu de l'**observer**.

## Les faits d'environnement se lisent à leur source

**step-002** — « le job Go n'a pas Node » a été écrit dans **neuf fichiers** — workflow, Makefile,
`CLAUDE.md`, `README.md`, la fiche de step, un `.feature`, un test — et y est resté trois passes de
revue. `ubuntu-latest` embarque Node et npm ; c'est `pnpm` qui manque. Le raisonnement tenait, le mot
mentait, et aucune porte de CI ne pouvait le contredire puisque la conclusion était juste.

## L'état partagé, et non le fichier, est le critère de séquentialité

**step-002** — trois sub-agents travaillaient en parallèle sur des fichiers disjoints. L'agent du
Makefile a lancé `make build` pendant que l'agent des scénarios écrivait son test : **son premier
rouge est sorti vert**, parce que le répertoire embarqué venait d'être rempli sous ses pieds. Il l'a
remarqué et l'a signalé — rien ne le garantissait.

Le même répertoire a produit le défaut suivant : deux `go test` concurrents s'y disputaient une mise à
l'écart à chemin stable, et le perdant supprimait celle du gagnant. Reproduit en process réels, la
sortie de Vite disparaissait définitivement à la 17ᵉ itération sur 25.

## Le design arrêté n'est pas figé

**step-002** — trois DN sur neuf ont dû être corrigés, dont un deux fois :

- **DN-9** annonçait une mutation qui restait verte (l'ordre des lignes ne protège rien dans chi), puis
  une seconde qui ne reproduisait pas le défaut non plus (le segment statique gagne sur le wildcard).
  La troisième formulation était la bonne, et composée de deux éditions.
- **DN-4** annonçait qu'aucun job de CI ne compilerait le binaire complet — la revue a fermé ce trou,
  et la décision décrivait un état qui n'existait plus.
- **DN-5** disait « fichier racine » quand le code servait tout fichier du bundle à n'importe quelle
  profondeur.

## La revue a besoin d'un axe « conformité fiche ↔ livraison »

**step-002** — aucun des quatre relecteurs de code n'a vu : une ligne de la section « Tests » qui
n'avait aucune preuve (« le binaire sert l'application dans un conteneur sans Node » — il n'y avait
pas de conteneur), deux DN que le code avait dépassés, ni trois lignes de Makefile que rien ne tenait.
Ce sont des écarts entre deux documents, invisibles depuis un diff.

## Un correctif repasse par les portes 2 et 3

**step-002** — le premier correctif du plancher de scénarios neutralisait la garde dès qu'un filtre
`-run` était actif. La mutation a montré qu'elle ne mordait alors plus du tout sous
`go test -run TestScenarios`, la commande de tous les jours. Le correctif visait à côté ; seule la
mutation l'a dit.

## Dire au relecteur qu'il peut contester

**step-002** — deux constats de revue ont été réfutés par mesure :

- « Le `//nolint:gosec` est inutile, gosec n'émet rien » — la mesure avait été prise **avec** la
  directive en place. Sans elle, `G703` apparaît. Le correctif aurait retiré une suppression
  nécessaire.
- « Le blocage vient de cette garde » — il venait d'une autre branche, ce que la mutation a montré.

## Le harnais ne doit pas manger le produit

**step-002** — le harnais de test a fini à **640 lignes pour 150 lignes de produit**, dont 255 pour la
seule mise en scène de fixtures contournant un répertoire vide sur un clone neuf. Chaque ligne était
justifiée localement. C'est une porte de CI de quinze lignes qui a fini par trouver le défaut que ce
harnais ne pouvait pas voir : aucun runner n'exerçait la chaîne de build complète, et une copie qui
perdait son `/.` laissait **dix jobs verts avec un binaire rendant 404**.

## Les correctifs d'une passe engendrent les bloquants de la suivante

**v1.0** — une bonne part des constats des passes 2 à 5 portaient sur les correctifs des passes
précédentes.

**step-002** — trois des dix bloquants sont nés de cette façon, tous dans des commentaires écrits pour
réparer un commentaire faux.
