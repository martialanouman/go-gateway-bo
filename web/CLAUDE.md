# `web/` — règles du client

Complète `CLAUDE.md` à la racine, qui garde les invariants, la boucle et la Definition of Done. Ce
fichier n'est chargé qu'une fois qu'un fichier de `web/` a été lu : ce qui doit être connu **avant**
d'ouvrir le client n'a rien à faire ici.

## Frontière d'accès

- **Aucun secret, aucune URL de l'API Admin codée en dur.** Le navigateur ne parle qu'au BFF, en
  relatif, à l'origine qui l'a servi. Côté serveur, l'invariant (d) est une propriété du compilateur ;
  ici, c'est une porte de `make check` — `web/cold-load.test.ts` construit le bundle par la
  commande de production, lit tout ce qu'il en émet de textuel et refuse **toute** origine absolue
  hors liste blanche. Le résiduel est cette liste : l'élargir n'est gardé que par la revue.
- Le rendu conditionnel d'un contrôle reste un confort : la garde est côté serveur, invariant (c),
  et la règle « désactivé et expliqué » est en racine parce qu'elle vaut aussi pour un refus HTTP.

## Copie & états

Copie en **français**, troisième personne, **conséquence d'abord** (règle complète en racine).

**Cinq états de contenu, cinq copies distinctes** — chargement (squelette de la vraie mise en page) ·
vide (rien encore + comment créer) · aucun résultat (filtres trop étroits + comment élargir) · module
désactivé (dégradation propre, **jamais** une erreur) · erreur (réalité HTTP + « vos données locales
restent affichées » + Réessayer). **Source : `tasks/plan.md` §1.9** — cette liste en dérive et
n'arbitre rien ; le chargement à froid y est un sixième *moment*, pas un sixième état.

**Modale de confirmation** (Material Design, *Dialogs*) — décidé le 03/10/2026, vaut pour toute
modale qui engage une action :
- **titre** : une question qui nomme l'action et son objet — « Suspendre BICICI ? » ;
- **corps** : ce qui va se passer, au futur et en langage courant, y compris ce qui ne se défait pas
  et comment revenir en arrière ; une phrase par idée, sans jargon (« journalisée » devient
  « L'action est enregistrée dans le journal d'audit. ») ;
- **boutons** : le verbe du titre seul pour confirmer (« Suspendre »), « Annuler » pour renoncer —
  jamais « OK » ni « Oui ».

**Statuts** : technique (lien, disjoncteur, remise) en `snake_case` du contrat, que l'opérateur grep ;
administratif (client, compte, groupe, nom d'expéditeur) en français — « Actif », « Suspendu ».

**Un écran non encore livré** : route déclarée + état vide explicite nommant le jalon. Jamais une page
blanche ni un lien mort.

## Tests

- **Composants (Vitest + Testing Library)** — états, permissions, clavier, copie. Forme Étant donné /
  Quand / Alors, sans second moteur Cucumber : `describe`/`it` suffit.
- **Bout en bout (Playwright)** — **cinq parcours seulement** (`tasks/plan.md` §17.4), **contre le
  binaire**, jamais `vite dev` : l'ordonnancement `/api` avant le repli SPA et l'embarquement des
  assets n'existent que dans le déployable. Le critère 1 demande d'**étendre un parcours existant**
  plutôt que d'ajouter un fichier.

Les trois symptômes de dérive d'un test (racine, « Tests — BDD ») valent ici aussi.

## Ajouter une route, côté client

Dernier tiers de la recette de racine, dont les six escales commencent à `api/openapi-bff.yaml` :
créer le fichier sous `web/src/routes/`, régénérer l'arbre, **commiter `routeTree.gen.ts`** — c'est
**`check-routes`** qui le garde, pas `check-generated`, dont la liste `$(GENERATED)` ne contient pas
l'arbre.
