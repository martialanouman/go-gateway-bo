# step-040 — AppShell : rail, barre supérieure, arborescence de routes en états vides

> **Jalon :** M2 (§4.2, `plan.md` §7) · **Statut :** À FAIRE
> **Dépend de :** step-022, step-041, step-042 · **Bloque :** step-027, step-028, step-029
>
> *Elle se lit **après** les deux lots de primitives, et son numéro ne le dit pas : l'AppShell
> consomme le bouton, les onglets et les cinq états, il ne les précède pas. L'ordre de `todo.md` fait
> foi.*

## But
La coquille dans laquelle tous les écrans se branchent, et la première step qui parle **vraiment** au
BFF. `web/src/components/shell.tsx` existe déjà et le dit de lui-même : « Elle est délibérément
inerte : la navigation, les permissions et le fil d'Ariane appartiennent à l'AppShell de step-040, qui
remplacera ce corps sans déplacer ce composant. » Son rail contient une phrase — « La navigation
arrive avec le jalon M2. » Cette step la remplace.

## Périmètre (ce que fait CETTE PR)
- Le rail groupé, la barre supérieure et la pile de toasts, plus `Page` et `Toolbar` —
  les quatre pièces que `plan.md` §7 nomme.
- **L'arborescence de routes**, déclarée en entier, chaque route rendant un état vide explicite qui
  **nomme son jalon** (§1.9). La liste fait foi dans la charte : cinq groupes, quinze entrées —
  Exploitation, Clients, Routage, Conformité, Facturation.
- `usePermission` et `PermissionGate`, par-dessus `web/src/lib/permissions.gen.ts` — les 44 clés
  engendrées depuis `internal/permissions`, croisées avec le tableau `permissions` de `/auth/me`.
- **Le premier client HTTP du dépôt** : `QueryClient` et `openapi-fetch` instanciés **dans le
  produit**. Aucun n'est fourni par un test, aucun n'est injecté — la v1.0 avait un provider absent de
  l'application que seul le test possédait, et c'est le critère 1.

## Points d'implémentation clés
- **Cette step précède step-027 : il n'existe aucun écran de connexion.** Quand `/auth/me` rend 401,
  la coquille ne peut pas rediriger vers `/login`, qui n'existe pas encore. Elle rend donc un état
  explicite **nommant step-027** — exactement ce que §1.9 exige de toute surface non livrée, « jamais
  une page blanche, jamais un lien mort, jamais un écran inventé ». step-027 remplacera cet état par
  la redirection et la reprise de la destination demandée.
- **Le rôle ne s'affiche pas dans la barre supérieure**, et c'est un écart assumé avec la charte, dont
  le `TopBar` rend `opérateur · rôle`. Le contrat le refuse en toutes lettres : « Aucun rôle dans le
  corps, et c'est la raison même : une liste de rôles rendue au navigateur invite à réintroduire le
  contrôle de rôle côté client, que la spec interdit » (`api/openapi-bff.yaml`, schéma `Me`). Le nom
  d'affichage seul, donc, et la raison écrite là où le composant la porte.
- **Le rail filtre ses entrées par permission, et ce filtre est un confort.** La garde est serveur,
  invariant (c) ; un contrôle masqué dont la route n'est pas gardée reste une faille. Une entrée dont
  la permission manque disparaît du rail — un groupe entier peut donc être vide, et le rail doit le
  supporter sans rendre un cadre creux.
- **Le rail n'a aucune icône** — *« labels carry the meaning »*. Géométrie de la charte : rail 236 px,
  barre supérieure 56 px, sous-barre 44 px, contenu plafonné à 1600 px, et les tokens de
  `tokens/layout.css` les portent déjà.
- **`Shell` ne se déplace pas.** `unknown-address.tsx` le rend lui-même, parce qu'une URL inconnue ne
  correspond à aucun enfant de `_shell`, et `__root.test.tsx` l'asserte. Remplacer le corps du
  composant est le périmètre ; déplacer le composant casserait l'adresse inconnue en silence.
- **Le squelette de chargement à froid doit tenir après l'ajout de l'AppShell** — c'est un point du
  Checkpoint M2. `web/chargement-a-froid.test.ts` tient l'égalité littérale entre le `<style>` en ligne
  d'`index.html` et `app.css` : toute géométrie de coquille qui bouge doit bouger aux deux endroits, ou
  la première peinture cesse de ressembler à ce qui la remplace.
- **Aucune origine absolue dans le bundle.** La garde d'invariant (d) du même test refuse toute URL
  hors liste blanche sur l'ensemble des fichiers textuels émis. Le client `openapi-fetch` se configure
  donc en **relatif**, sur l'origine qui a servi le document — ce que `web/CLAUDE.md` demande déjà.
- **Pas de préchargement de route.** `web/src/router.ts` s'en explique : un préchargement dépenserait
  `content:read` et écrirait une ligne d'audit pour une lecture qui n'a pas eu lieu. L'AppShell ne
  réintroduit pas `defaultPreload` par confort de navigation.

## Tests (écrits dans la même PR)
- **Composants (Vitest)** : le rail filtré par un jeu de permissions partiel, `PermissionGate` sur une
  clé absente, l'état 401 qui nomme step-027, et une route de l'arborescence dont l'état vide nomme
  son jalon.
- **Parcours (Playwright), contre le binaire** : l'**extension** de `e2e/coquille.spec.ts`, jamais un
  fichier de plus — le plafond de `plan.md` §17.4 est de cinq parcours, et c'est un budget. Le
  squelette peint, puis l'AppShell qui le remplace, puis une entrée de rail qui mène à un état vide
  nommant son jalon.
- **Mutation, sur le filtre du rail** : le retirer fait rougir. Un rail qui montre tout se lit comme
  un rail qui marche.
- **Mutation, sur `PermissionGate`** : le faire passer une clé absente fait rougir. Les deux mutations
  sont exigées séparément parce qu'une seule des deux portes suffit à masquer la panne de l'autre.
- **Aucune origine absolue** après l'ajout du client HTTP : la garde existante s'exerce pour la
  première fois sur du code qui appelle le réseau.

## Definition of Done
- [ ] `make check` vert et `make e2e` vert
- [ ] clavier et libellés accessibles (WCAG 2.1 AA) sur le rail et la barre supérieure
- [ ] chaque route déclarée rend un état explicite qui nomme son jalon — aucune page blanche, vérifié
      route par route et non sur un échantillon
- [ ] la mutation « retirer le filtre de permission du rail » fait rougir
- [ ] la mutation « `PermissionGate` laisse passer une clé absente » fait rougir
- [ ] le squelette de chargement à froid tient toujours, et `chargement-a-froid.test.ts` le prouve sur
      le bundle de production, pas sur l'intention
- [ ] l'absence de rôle dans la barre supérieure est écrite là où elle se constate, avec le renvoi au
      contrat qui la décide

## Hors périmètre
Les écrans de connexion et de second facteur → step-027, qui porte aussi la garde de session en
`beforeLoad` sur `_shell`, à l'endroit que le fichier annonce déjà. Le `Menu` et le `Tooltip` →
step-042, qui écrit pourquoi ils sortent du jalon ; la déconnexion tient dans le slot `actions` de la
barre, avec un `Button`. Le hub WebSocket, `useTopic` et le centre de notifications persisté →
step-043 et suivantes : la pile de toasts est livrée ici, sa source ne l'est pas. Les widgets de
trafic → M4. Tout écran métier — l'arborescence déclare les routes, elle ne les remplit pas.
