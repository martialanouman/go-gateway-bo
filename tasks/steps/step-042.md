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

**Trois des cinq ont leur copie écrite dans la charte** — l'état vide, le module désactivé et
l'erreur, dans `guidelines/brand-states.card.html`. Le chargement n'a pas de copie par nature, c'est
un squelette. **« Aucun résultat » n'y figure pas du tout** : sa seule source est `plan.md` §1.9 —
« filtres trop étroits + comment élargir » — et sa copie s'écrit ici, pas ailleurs.

## Points d'implémentation clés
- **Un module désactivé n'est jamais une erreur**, et rien en amont ne le signale. `internal/gateway`
  l'a tranché et mesuré, DN-8 : le contrat « ne déclare toujours ni 501, ni en-tête, ni code d'erreur
  pour un module désactivé : les seuls signaux voisins sont des booléens par ressource, qui voyagent
  dans des réponses 200 ». Un 503 reste donc une erreur avec Réessayer, jusque sur *« Export storage
  is not configured in this deployment »*. Conséquence directe pour cette step : `ModuleDisabled` est
  livré **sans producteur**, et la fiche l'écrit plutôt que d'inventer un déclencheur. Le premier
  écran qui lit un de ces booléens le branchera.
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

## Tests (écrits dans la même PR)
- **Composants (Vitest)** : les cinq états rendus, chacun avec sa copie et son issue — créer, élargir,
  réessayer, ou rien du tout pour le module désactivé, qui n'invite à aucune action.
- **Mutation, sur la distinction qui compte** : rendre `ModuleDisabled` avec la copie de `ErrorState`
  fait rougir. C'est la confusion que le serveur a déjà refusé de faire, et la moitié cliente doit
  dire la même chose que `internal/gateway/errors_test.go`.
- **Mutation, sur la modale** : retirer le piège du focus, ou la fermeture par `Échap`, fait rougir.
- `prefers-reduced-motion` coupe la pulsation et le scintillement — vérifié, pas déclaré.

## Definition of Done
- [ ] `make check` vert
- [ ] clavier et libellés accessibles (WCAG 2.1 AA) sur la modale et sur les cinq états
- [ ] `HomeScreen` **et** `UnknownAddress` consomment l'état vide livré ici, et aucun des deux ne
      garde de copie locale — vérifié sur les deux, pas sur le premier
- [ ] la mutation « `ModuleDisabled` rend la copie d'erreur » fait rougir
- [ ] la mutation « la modale ne piège plus le focus » fait rougir
- [ ] la copie des cinq états a été relue contre `plan.md` §1.9 et la charte, et celle d'« aucun
      résultat » est écrite ici parce qu'elle n'existait nulle part

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
