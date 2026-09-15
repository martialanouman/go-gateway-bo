# step-042 — Primitives lot 2 : dialog, toast, et les cinq états de contenu

> **Jalon :** M2 (§4.2, §1.9) · **Statut :** À FAIRE
> **Dépend de :** step-041 · **Bloque :** step-040, step-027
>
> *Le titre a perdu `menu` et `tooltip` le 08/09/2026 : ni la charte ni aucune step antérieure à
> step-084 ne les réclame. La raison complète est en « Hors périmètre », où elle sera relue.*

## But
Ce qu'un écran affiche quand il n'a rien à afficher, et ce qu'il superpose quand il demande une
confirmation. Les cinq états de contenu sont la moitié la plus citée du dépôt — `plan.md` §1.9,
`web/CLAUDE.md`, la charte §08 — et **aucun n'existe en composant réutilisable**. Deux écrans les
réécrivent à la main, avec les mêmes classes : `HomeScreen` (`_shell.index.tsx`) et `UnknownAddress`
(`components/unknown-address.tsx`) — les deux seules surfaces métier que le client rende à ce jour,
la page de charte `/_design` mise à part.

## Périmètre (ce que fait CETTE PR)
- `Modal` — le « dialog » de `todo.md`, nommé comme la charte le nomme.
- `Toast` et `ToastStack`, portant la sévérité et la **source** — `alertmanager` en bleu, `bff` en
  violet. L'écran dit lequel des deux étages a détecté, parce qu'ils ne se réparent pas pareil.
- **Les cinq états de contenu** en composants réutilisables : chargement, vide, aucun résultat, module
  désactivé, erreur. `HomeScreen` **et** `UnknownAddress` basculent dessus : les deux copies locales
  disparaissent, ou la step n'a rien centralisé.

**Trois des cinq ont leur copie écrite dans `guidelines/brand-states.card.html`** — l'état vide, le
module désactivé et l'erreur. Le chargement n'a pas de copie par nature, c'est un squelette.

> **Corrigé le 15/09/2026, en écrivant le plan.** Cette fiche affirmait qu'« aucun résultat » « n'y
> figure pas du tout » et que « sa seule source est `plan.md` §1.9 ». **Les deux moitiés sont
> fausses.** La copie existe, dans une *autre* carte de la charte —
> `components/feedback/feedback.card.html:25-27` : « Aucun message trouvé » / « Élargissez la plage de
> dates ou retirez un filtre. » / « Réinitialiser ». Ce qui est vrai, et qui avait été lu trop vite,
> c'est que `brand-states.card.html` **l'annonce dans son sous-titre sans la rendre** : la carte des
> cinq états n'en montre que quatre. C'est une lacune de cette carte, pas de la charte — et la step
> reprend la copie existante au lieu d'en inventer une.

## Points d'implémentation clés
- **Un module désactivé n'est jamais une erreur**, et rien en amont ne le signale. `internal/gateway`
  l'a tranché et mesuré, DN-8 : le contrat « ne déclare toujours ni 501, ni en-tête, ni code d'erreur
  pour un module désactivé : les seuls signaux voisins sont des booléens par ressource, qui voyagent
  dans des réponses 200 ». Un 503 reste donc une erreur avec Réessayer, jusque sur *« Export storage
  is not configured in this deployment »*. Conséquence directe pour cette step : `ModuleDisabled` est
  livré **sans producteur**, et la fiche l'écrit plutôt que d'inventer un déclencheur. Le premier
  écran qui lit un de ces booléens le branchera.
- **La `Modal` aussi est livrée sans consommateur**, et la fiche ne le disait que de
  `ModuleDisabled`. Aucune step avant M3 n'ouvre de modale : ni step-027 ni step-028 n'en nomment
  une, et le premier appelant est la rotation d'identifiant. Ce qui la justifie malgré tout est
  écrit dans `modal.tsx` — l'invariant (b) exige qu'un secret soit introuvable après fermeture, et
  c'est une propriété qu'on pose en écrivant le composant, pas six steps plus tard sur un composant
  déjà consommé.
- **L'erreur porte la réalité HTTP**, la phrase « vos données locales restent affichées » et un
  Réessayer — la copie de la charte nomme jusqu'à la requête : *« GET /api/connectors · 504 ·
  req_8f2c… »*. Effacer l'écran pour afficher une erreur est le contraire de ce que demande
  l'invariant (e).
- **Le voile de la modale est `rgba(6,8,11,.72)`, sans flou.** La charte tranche : *« blurring live
  metrics behind a dialog costs more than it gives »*.
- **La charte n'admet qu'une animation en boucle** — la pulsation de 1,8 s du point vivant — et fixe
  le scintillement des squelettes à 1,4 s, que `--dur-skeleton` porte déjà. **Le livré la contredit** :
  `web/index.html:142` fait battre le squelette de chargement à froid à `1.6s`, en dur, sans toucher
  ce token, que rien ne consomme à ce jour. Cette step tranche l'écart plutôt que d'en hériter — soit
  le livré s'aligne, soit le 1,6 s reçoit sa raison écrite. Les compteurs temps réel changent de
  valeur sans transition, et `prefers-reduced-motion` désactive l'ensemble.
- **Le squelette reproduit la vraie mise en page**, pas un rectangle générique — c'est ce qui
  distingue le chargement de l'attente. Le dépôt en a déjà un, celui du chargement à froid, écrit en
  ligne dans `web/index.html` et tenu par `web/chargement-a-froid.test.ts` ; celui-ci est son
  équivalent à l'intérieur d'un écran, et les deux ne doivent pas diverger de géométrie.
- **Les cinq copies sont distinctes**, et c'est le point : « Empty ≠ error ≠ disabled ». Deux états
  qui se ressemblent à l'écran sont un défaut, pas une économie.

## Dettes portées (ajout du 15/09/2026)
`todo.md` a désigné cette step porteuse de trois dettes **le 12/09**, soit quatre jours après la
rédaction de cette fiche, qui les ignorait donc.

- **Le raccourci `font:` — payée ici.** Elle mord réellement : l'`ErrorState` rend « (504) » en
  `--text-body`, un rôle proportionnel. Le correctif est une garde sur le **mécanisme** et non sur ses
  symptômes.
- **Les deux dettes de forme de step-008 — reportées, sans porteur nominal.** Ni l'analyseur CSS de
  portée ni la sortie de `design-reference.css` de la feuille d'entrée ne sont du ressort d'une step
  de primitives. Trois attributions successives ne les ont pas payées ; une quatrième se relirait
  comme de la prudence. La ligne porte désormais deux déclencheurs chiffrés.

## Tests (écrits dans la même PR)
- **Composants (Vitest)** : les cinq états rendus, chacun avec sa copie et son issue — créer, élargir,
  réessayer, ou rien du tout pour le module désactivé, qui n'invite à aucune action.
- **Mutation, sur la distinction qui compte** : rendre `ModuleDisabled` avec la copie de `ErrorState`
  fait rougir. C'est la confusion que le serveur a déjà refusé de faire, et la moitié cliente doit
  dire la même chose que `internal/gateway/errors_test.go`.
- **Mutation, sur la modale** : retirer le piège du focus, ou la fermeture par `Échap`, fait rougir.
- `prefers-reduced-motion` coupe la pulsation et le scintillement — vérifié, pas déclaré.

## Definition of Done
- [x] `make check` vert
- [x] clavier et libellés accessibles (WCAG 2.1 AA) sur la modale et sur les cinq états
- [x] `HomeScreen` **et** `UnknownAddress` consomment l'état vide livré ici, et aucun des deux ne
      garde de copie locale — vérifié sur les deux, et les trois règles `.empty*` d'`app.css` sont
      supprimées
- [x] la mutation « `ModuleDisabled` rend la copie d'erreur » fait rougir
- [x] la mutation « la modale ne piège plus le focus » fait rougir
- [x] la copie des cinq états a été relue contre `plan.md` §1.9 et la charte — et cette relecture a
      **corrigé la fiche**, qui affirmait à tort que celle d'« aucun résultat » n'existait nulle part

## Ce que la step a mesuré, et ce que la mesure a changé

### Le poids, et une affirmation du plan qui était fausse

Le plan de cette session annonçait que brancher `HomeScreen` sur `EmptyState` ne ferait pas basculer
Base UI dans le chunk d'entrée, « parce qu'`EmptyState` n'importe que `Icon` ». **Faux** :
`ErrorState` et `NoResults` importent `Button`, donc Base UI. Et l'import **par la façade** en tire
la totalité, pas seulement `Button`. Mesuré sur le livré, trois variantes du même code :

| | entrée | `/_design` |
|---|---|---|
| step-041 | 276,12 Ko (87,98 gzip) | 153,92 Ko |
| `HomeScreen` important en profondeur | 290,60 Ko (93,03) | 175,72 Ko |
| via la façade, `sideEffects` absent | 453,78 Ko (147,44) | 12,62 Ko |

Le total ne bouge pas (~466 Ko) : c'est la **répartition** qui change.

**Et la conclusion que j'en avais tirée était fausse à son tour.** J'ai lu ces trois lignes comme le
prix de la façade, arbitré de la garder — sa règle est normative — et inscrit les +163 Ko au registre
avec porteur step-040. Le vrai coupable est ailleurs : `web/package.json` ne déclarait **pas**
`sideEffects`. Rollup tient alors chaque module de `src/` pour susceptible d'en avoir, et un import
depuis un baril tire **tous** ses modules, quoi qu'en dise la façade. Déclaration posée, rien d'autre
changé :

| | entrée | `/_design` |
|---|---|---|
| **via la façade, `sideEffects` déclaré — le livré** | **290,60 Ko (93,03)** | 175,73 Ko |

C'est l'import profond **à l'octet près**. La façade ne coûtait rien ; il manquait l'autorisation de
secouer. La dette est barrée au registre le jour de son inscription, et step-040 n'hérite de rien —
sinon de la bascule réelle, quand la pile de toasts montera dans la coquille.

Ce qui a permis à 163 Ko de s'y loger sans un rouge : le script d'entrée n'avait **aucune borne**,
là où la feuille en a deux depuis step-041. Il en a deux maintenant, 340 Ko bruts / 110 Ko gzip,
dans `chargement-a-froid.test.ts`. Marge ~15 %, dimensionnée pour que la bascule de step-040 se
présente comme une question et non comme un rouge à faire taire.

Feuille d'entrée : **27,37 Ko bruts / 5,89 Ko gzip**, contre 21,37 / 5,00 avant la step. Bornes
32 768 / 14 336 — 84 % et 41 %. La borne **brute** est celle qui se resserre.

### Les mutations

| Mutation | Résultat |
|---|---|
| `ModuleDisabled` rend `ErrorState` | Rouge, 1 test. Le test « nomme le module éteint » **reste vert** : le titre survit à la confusion, et c'est pourquoi les quatre assertions du même `it` étaient nécessaires. |
| `onOpenChange` filtré sur `reason === 'close-press'` | Rouge, « ferme sur Échap ». |
| `<Dialog.Portal keepMounted>` | Rouge, « ne laisse rien de son contenu dans le document ». La seule preuve que la modale **démonte** — invariant (b), six steps avant l'écran qui en dépendra. |
| `sideEffects` retiré de `package.json` | Rouge, « garde le script d'entrée exempt de ce qu'une seule route consomme » : 145 796 gzip pour une borne à 110 000. |
| `"sideEffects": false` au lieu de `["**/*.css"]` | **Verte, et instructive** : la feuille émise est identique à l'empreinte près — Vite ne laisse pas secouer ses propres modules CSS. Le motif ne protège donc rien aujourd'hui ; il dit ce qui est vrai du graphe. Le premier message de commit lui prêtait la protection : corrigé sur la mesure. |
| `modal={false}` | Rouge **deux fois** : en jsdom, l'extérieur reste dans l'arbre d'accessibilité ; en Chromium, le focus sort de la modale. |
| `@media (prefers-reduced-motion: reduce)` retiré de `base.css` | Rouge sur le parcours seulement. |
| `.ui-toast[data-limited]` en opacité plutôt qu'en `display: none` | **Verte en Vitest**, rouge sur le parcours (5 toasts visibles sur 3). Voir ci-dessous. |
| `backdrop-filter: var(--scrim-blur)` sur le voile | Rouge sur le parcours. |
| Les deux sources peintes de la même couleur | Rouge sur le parcours. |
| `--skeleton-duration` à 1600ms | Rouge, la cinquième paire de `chargement-a-froid`. |
| Le correctif local `tabular-nums` de `.ui-table` retiré | Rouge : la nouvelle garde le rattrape, il n'est plus le seul porteur. |
| Une règle `.ui-orpheline` dans `app.css` | Rouge — et **verte avant** le premier commit, ce qui mesure le trou que `STYLED_FILES` partagé referme. |

### Un test qui s'intitulait mieux qu'il ne prouvait

Le test du plafond s'appelait « n'en montre jamais plus de trois » et ne regardait pas l'écran : il
comptait l'attribut `data-limited` que Base UI pose, jamais la règle CSS — que jsdom n'applique pas.
Remplacer `display: none` par une opacité laissait les 254 tests verts. Il dit désormais ce qu'il
prouve — le marquage — et la preuve du retrait à l'écran vit dans le parcours.

*C'est le seul endroit de cette step où une mutation bien construite a trouvé un test complaisant, et
elle ne l'aurait pas trouvé si le plan n'avait pas exigé de la jouer.*

### Deux gardes ont mordu pendant l'écriture

Le plugin de tokens sur un `--text-body-medium` que j'avais inventé pour le titre d'un toast, et la
bijection de `classes-peintes` sur une classe composée dans un template dont le préfixe échappait au
détecteur. Aucune des deux n'aurait été vue en revue.

### Ce qui n'est pas testé, et pourquoi

- **`prefers-reduced-motion` ne touche pas les délais d'auto-disparition des toasts**, et c'est
  délibéré : le mouvement réduit gouverne le mouvement, pas le temps, et un toast qui ne part jamais
  est un autre défaut. L'échappatoire WCAG 2.2.1 est déjà là — Base UI met le compte à rebours en
  pause au survol et au focus.
- **Le rôle du toast s'écarte du kit**, et l'écart est écrit dans `toast.tsx` : le kit pose
  `role="status"`, Base UI suit le motif APG. Reposer `role="status"` casserait le parcours clavier,
  et « toujours fermable » cesserait d'être vrai pour qui n'a pas de souris. Mesuré dans
  `ToastClose.mjs` : le bouton Fermer porte `aria-hidden` tant que le focus n'est pas entré.
- **`ModuleDisabled` et `Modal` n'ont aucun producteur**, et rien ne le fera rougir. Le premier écran
  qui lira un booléen de module branchera l'un ; la rotation d'identifiant de M3 ouvrira l'autre.

## Hors périmètre
**Le `Tooltip` → step-084**, et c'est la charte elle-même qui le désigne : *« The first screen showing
a French label for a technical state — `step-084`, connector health — has to add the component before
it can comply. »* La règle des identifiants ne mord que lorsqu'un libellé français **remplace** un
identifiant technique. Or step-041 affiche l'identifiant en mono, sans substitution, et le rail de
step-040 est libellé seul, sans icône : aucun consommateur avant step-084.

**Le `Menu` → la step qui le consomme.** Le `TopBar` de la charte n'en porte aucun — nom d'opérateur
et rôle en texte brut, vérifié dans `components/navigation/TopBar.jsx` —, et la déconnexion tient dans
son slot `actions` avec un `Button` de step-041. Le kit n'a ni `Menu`, ni `Dropdown`, ni `Popover` :
c'est, avec le `Tooltip`, la seule primitive nommée sans référence visuelle, et le README de la charte
n'en fait même pas un *open item*.

Ni l'un ni l'autre n'est difficile : `@base-ui/react` 1.6.0 exporte `menu/` et `tooltip/`, le
comportement est installé et gratuit. Ce qui manque n'est pas le code mais **la référence visuelle**,
et on ne la dessine pas à l'aveugle pour un consommateur qui n'existe pas. *(Arbitré le 08/09/2026 ;
`todo.md` corrigé dans la même PR plutôt que contourné en silence.)*

Le `Banner` → la step qui l'affiche. Le `SkeletonRows` du kit → la première step qui livre une table
peuplée. La pile de toasts **branchée sur le temps réel** → step-045, le client WebSocket React ; ce
qui est livré ici est le composant, pas sa source, et step-043 n'en est que la moitié serveur.
L'`AppShell` qui monte cette pile dans la coquille → step-040.
