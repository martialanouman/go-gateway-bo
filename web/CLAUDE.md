# `web/` — règles du client

Complète `CLAUDE.md` à la racine, qui garde les invariants, la boucle et la Definition of Done. Ce
fichier n'est chargé qu'une fois qu'un fichier de `web/` a été lu : ce qui doit être connu **avant**
d'ouvrir le client n'a rien à faire ici.

## Frontière d'accès

- **Aucun secret, aucune URL de l'API Admin codée en dur.** L'invariant (d) est garanti par le
  compilateur côté serveur ; côté client il ne l'est pas, et **rien ne le cherche encore** — aucune
  porte ne lit le bundle. Le navigateur ne parle qu'au BFF.
- Le rendu conditionnel d'un contrôle reste un confort : la garde est côté serveur, invariant (c),
  et la règle « désactivé et expliqué » est en racine parce qu'elle vaut aussi pour un refus HTTP.

## Copie & états

Copie en **français**, troisième personne, **conséquence d'abord** (règle complète en racine).

**Cinq états de contenu, cinq copies distinctes** — chargement (squelette de la vraie mise en page) ·
vide (rien encore + comment créer) · aucun résultat (filtres trop étroits + comment élargir) · module
désactivé (dégradation propre, **jamais** une erreur) · erreur (réalité HTTP + « vos données locales
restent affichées » + Réessayer). **Source : `tasks/plan.md` §1.9** — cette liste en dérive et n'arbitre
rien ; le chargement à froid y est un sixième *moment*, pas un sixième état. La taxonomie tranche
aussi côté serveur : `internal/gateway/errors_test.go` sépare un 503 d'un module désactivé.

**Un écran non encore livré** : route déclarée + état vide explicite nommant le jalon. Jamais une page
blanche ni un lien mort.

## Tests

- **Composants (Vitest + Testing Library)** — états, permissions, clavier, copie. Forme Étant donné /
  Quand / Alors, sans second moteur Cucumber : `describe`/`it` suffit.
- **Bout en bout (Playwright)** — **cinq parcours au plus** (`tasks/plan.md` §17.4) ; un seul existe
  aujourd'hui. **Contre le binaire**, jamais `vite dev` :
  l'ordonnancement `/api` avant le repli SPA et l'embarquement des assets n'existent que dans le
  déployable. Le critère 1 demande d'**étendre un parcours existant** plutôt que d'ajouter un fichier.

Les trois symptômes de dérive d'un test (racine, « Tests — BDD ») valent ici aussi.

## Ajouter une route, côté client

Dernier tiers de la recette de racine, dont les six escales commencent à `api/openapi-bff.yaml` :
créer le fichier sous `web/src/routes/`, régénérer l'arbre, **commiter `routeTree.gen.ts`** — c'est
**`check-routes`** qui le garde (`Makefile:261`), pas `check-generated`, dont la liste `$(GENERATED)`
ne contient pas l'arbre.
