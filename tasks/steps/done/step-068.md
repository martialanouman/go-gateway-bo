# step-068 — Coquille et écrans livrés alignés sur la maquette du kit

> **Jalon :** M3 (plan §7, §8 ; charte `ui_kits/admin-console`) · **Statut :** FAIT
> **Dépend de :** step-064 · **Bloque :** step-065
> *Insérée le 04/10/2026, après le test de la fiche compte par l'utilisateur.*

## But
Les écrans livrés suivent le layout de la maquette (`AppShell.jsx`, `AccountScreen.jsx`, gabarit
`templates/ecran-console`) :
- le titre, le fil d'Ariane, les badges et les actions de page passent dans la barre supérieure ;
- une sous-barre porte les filtres et les actions ;
- les onglets passent pleine largeur sous la barre ;
- le contenu est rangé en cartes, et les tables sont denses.

C'est la reprise de la coquille de step-040, qui annonçait `Page` et `Toolbar` sans les construire,
puis des huit écrans qui s'y branchent.

## Écarts relevés le 04/10/2026
| # | Maquette | Livré | Écrans |
|---|---|---|---|
| 1 | Titre, fil d'Ariane, badges et actions dans `TopBar` | `h1` de 28 px dans la page (`page__head`), aucun fil d'Ariane | les 8 |
| 2 | `Toolbar` de 44 px : filtres à gauche, actions à droite | aucune `Toolbar` ; filtres en `Select` dans le corps | clients, comptes, groupes |
| 3 | Onglets pleine largeur sous la barre supérieure | onglets dans le contenu | fiche compte, groupes |
| 4 | Contenu en `Card` (titre, sous-titre, actions, `flush` pour une table) | `h2` nus ; seules les cartes de réglages de step-064 suivent, en CSS local | fiches client et compte, mon compte, rôles |
| 5 | Tables denses (`pl-table--dense`) | `DataTable dense` existe, aucun écran ne s'en sert | toutes les listes |

Les huit écrans : clients, fiche client, comptes, fiche compte, groupes, opérateurs, rôles, mon compte.
Les écrans en attente (`PendingScreen`) suivent le même en-tête.

## Décisions (à confirmer en ouvrant)
- **Le titre reste le `h1`, déplacé dans la barre supérieure.** Un écran le déclare par un
  composant d'en-tête, que la coquille projette dans `TopBar` (contexte ou portail, à trancher sur
  le code de `shell.tsx`). Le titre est souvent dynamique (le nom d'un compte), donc `staticData`
  sur la route ne suffit pas. Garder le `h1` préserve les 15 lectures du parcours e2e et celles de
  19 fichiers de test, ainsi que le focus posé sur le titre après une action.
- **Le fil d'Ariane suit l'arborescence réelle.** Exemple : Clients › BICICI › trafic-otp ; le
  client se lit par la requête de sa fiche, partagée en cache. Il apparaît sur les fiches, pas sur
  les listes de premier niveau.
- **La géométrie reste celle des tokens** (`tokens/layout.css`) : barre de 56 px, sous-barre de
  44 px. Le gabarit indique 48 px en `hint-size`, mais ce n'est qu'un indice de dimension, et step-040
  a déjà aligné la barre sur le token. Le squelette d'`index.html` duplique cette géométrie : s'il
  bouge, `web/cold-load.test.ts` le tient.
- **`Card` et `Toolbar` entrent dans le kit** (`web/src/components/ui/`), portés de
  `components/core/Card` et de `Toolbar` (`AppShell.jsx`). Les classes locales `settings-card` de
  step-064 disparaissent au profit de `Card`.
- **On lit la maquette, puis le `.prompt.md` de chaque contrôle, avant de toucher un écran.**

## Écarts assumés (le contrat ne permet pas mieux)
- **Webhooks** : la maquette montre un secret masqué (`•••• 91C4`) et les échecs sur 24 h. Le
  contrat Admin 6.10.x ne rend ni l'un ni l'autre : le secret est en écriture seule, et aucun
  compteur d'échecs n'est exposé. Les colonnes restent absentes. Il faut poser la question à l'équipe
  passerelle avant de rouvrir le sujet.
- **Rôle de l'opérateur** absent de la barre supérieure : c'est l'écart de step-040, refusé par le
  contrat du BFF.

## Écarts assumés à la livraison (04/10/2026)
- **Les listes ne sont pas en `Card`.** Les tables de liste vont jusqu'aux marges de la page, comme
  dans `CdrExplorerScreen.jsx`. La ligne « rôles » de l'écart 4 est donc retirée : l'écran est une
  liste, sans section.
- **Groupes sans `Toolbar`.** Les onglets Actifs / Archivés jouent le rôle de la sous-barre, et
  « Nouveau groupe » monte dans la barre supérieure. Une sous-barre en plus empilerait deux bandes
  de 44 px pour une seule action.
- **Marge de page à 24 px (`--pad-panel`).** La maquette `Page` pose 16 px (`--sp-7`). Le squelette
  d'`index.html` peint déjà 24 px, et un écart entre les deux ferait sauter le contenu à
  l'hydratation.
- **Sous 1280 px, la date de création quitte la barre.** Le bloc d’identité garde 20ch, seul le titre rétrécit, et le fil d’Ariane se
  tronque. Mesuré à 1440, 1280 et 1024 px : aucun défilement horizontal.

## Tests
- **Parcours e2e** étendu, sans nouveau fichier : le fil d'Ariane d'une fiche compte mène au client,
  et l'action d'en-tête d'une liste (« Nouveau compte ») est atteinte dans la sous-barre.
- **Vitest** : la coquille projette le titre et les actions d'un écran dans la barre supérieure,
  avec un seul `h1` ; le fil d'Ariane nomme ses niveaux et les lie ; `Card` et `Toolbar` rendent
  leurs emplacements ; une carte `flush` porte sa table.
- **Tests existants** : ils restent verts sans réécriture de fond, puisque le titre reste le `h1`.
  Ce qui casse se corrige écran par écran, sans affaiblir l'assertion.
- **Revue visuelle avec agent-browser**, écran par écran, face au code de la maquette ; les
  captures sont jointes à la PR. La maquette cliquable ne se rend pas (`_ds_bundle.js` absent du
  dépôt). La comparaison se fait donc sur le code des maquettes, et les blocs du gabarit en donnent
  la géométrie.

## Critère 4
- Un écart visuel (marge, alignement) ne se teste pas en Vitest. Il se constate sur les captures,
  écrites dans la PR.
- **Aucun test ne rougit si `dense` disparaît d'une table**, ni si `.page` perd son `padding` :
  vérifié en lisant les suites, qui n'assertent aucune classe de mise en page. La marge de l'accueil
  a été mesurée dans le navigateur (24 px) ; la densité se lit sur les captures.

## Mutations (04/10/2026)
| Mutation | Test qui tombe |
|---|---|
| Fil d'Ariane retiré de la fiche compte | `leads back to its customer through the breadcrumb of the top bar` et un autre |
| En-tête rendu dans le contenu, pas par le portail | `shows the title of the screen in the top bar, as its only h1` |
| Titre de carte sans `tabIndex` | `lets its title take the focus when given a ref`, plus un test de Mon compte |
| Actions de `Toolbar` hors de la zone de fin | `puts the filters first and the actions at the end` |
| `flush` ignoré | `carries a table without inner padding when flush` |
| `titleRef` non transmis au `h1` | 9 tests de focus (groupes, rôles, clients, fiche client, fiche compte, Mon compte) |
| En-tête retiré d'une fiche en erreur (compte, puis client) | `says the account could not be read…`, `names an unknown customer…` |

## Definition of Done
- [x] `make check` vert ; `make e2e` vert.
- [x] Les 5 écarts traités sur les 8 écrans, captures avant/après dans la PR.
- [x] `settings-card` retiré, `Card` et `Toolbar` dans le kit, avec leurs tests.

## Hors périmètre
- Les écrans non livrés : chacun suivra la coquille à sa step.
- Les colonnes de webhook que le contrat n'expose pas.
- Le rail : déjà conforme depuis step-040, il ne change pas.
