# step-008 — Charte portée : tokens, `/_design`, contraste vérifié

> **Jalon :** M0 (§1.7 de la charte) · **Statut :** LIVRÉE (08/08/2026)
> **Dépend de :** step-001, step-007 · **Bloque :** step-041, step-042, step-040

## But
Rendre la charte utilisable : les tokens portés sous `web/src/styles/`, la page de référence
`/_design` qui les montre tous, et un contrôle de contraste qui échoue au lieu de se croire vert.

## Périmètre (ce que fait CETTE PR)
- Portage des ~2 200 lignes de tokens de la v1.0 : couleurs, typographie, espacement, rayons,
  élévations, états de focus.
- Polices **auto-hébergées**, chargées depuis le binaire — aucune requête vers un tiers, y compris en
  développement.
- Page `/_design` : la charte complète sur une route, avec les tokens rendus tels qu'ils s'appliquent.
- Contrôle de contraste **automatisé** sur les paires effectivement utilisées.

## Points d'implémentation clés
- **Le contraste se vérifie sur ce qui est rendu, pas sur la liste des tokens.** Un token conforme
  appliqué sur le mauvais fond produit une paire non conforme ; c'est la paire qui se teste.
- **`/_design` s'adresse à qui écrit un écran**, pas à un opérateur : elle vit hors de la coquille et
  n'a pas de garde de session. Elle n'affiche aucune donnée réelle.
- La v1.0 a livré un bandeau de refus **sans bordure faute d'un token qui n'existait pas** — et
  `pnpm check` était vert. Un token absent doit donc casser la compilation ou le build CSS, jamais
  retomber silencieusement sur une valeur par défaut du navigateur.
- Les tokens sont portés **tels quels**. Cette step ne redessine rien : la charte n'a pas changé, seule
  la pile qui la sert a changé.

## Tests (écrits dans la même PR)
- **Contraste** : chaque paire texte/fond utilisée par `/_design` atteint AA. Le test échoue si une
  paire descend sous le seuil — vérifié en abaissant délibérément une couleur.
- **Token manquant** : référencer un token inexistant fait échouer le build, il ne rend pas une valeur
  vide. C'est la mutation qui reproduit le défaut réel de la v1.0.
- `/_design` rend sans erreur de console et sans requête réseau sortante vers un tiers.

## Definition of Done
- [x] **`make check` vert** (08/08, onze portes) · **`make e2e` vert**, qui en est hors et que la
      première case ne couvre donc pas
- [x] **`/_design` montre la charte complète** — six familles de tokens, et le test refuse qu'une
      section disparaisse *ou* qu'une septième apparaisse sans être annoncée. Elle sert de référence
      parce que ses tables **sont** celles que le contrôle de contraste juge, ce qui n'était pas le
      cas avant la revue
- [x] **aucune police ni feuille chargée depuis un domaine tiers, vérifié sur le binaire** — l'étape
      CI suit la feuille puis une police dans les octets servis (signature `wOF2`, `content_type`), et
      le parcours Playwright écoute les requêtes d'un vrai navigateur, avec un plancher « au moins un
      `.woff2` ». Muté des deux côtés : `fonts.css` rebranché sur Google Fonts, puis privé de tout
      `@import`
- [x] **les deux mutations nommées ont été jouées**, et onze autres avec elles — voir les tableaux
      ci-dessus. Trois d'entre elles étaient d'abord mal construites et se lisaient comme des succès

### Les quatre critères transverses de `CLAUDE.md`

1. **Le chemin qu'un humain traverse.** `/_design` est traversée **sur le binaire**, dans le parcours
   existant étendu — pas dans un routeur monté en mémoire. On y lit la police réellement peinte, ce
   que jsdom ne sait pas faire : `getComputedStyle` de Chromium résout les `var()` et les
   `color-mix()`. Muté en retirant IBM Plex Sans de `--font-sans` : rouge.
2. **Toute affirmation confrontée à sa source.** Deux chiffres écrits dans cette PR étaient périmés au
   moment où la revue les a relus — la taille de la feuille et le nombre de fichiers de police — et
   une phrase affichée **à l'écran** promettait une vérification qui n'existait pas. Les trois sont
   corrigés sur la sortie livrée, pas sur l'intention.
3. **Mutation partout où le retrait laisserait la suite verte.** Treize jouées. Quatre gardes ne
   gardaient rien avant la revue ; trois mutations ont dû être refaites parce que leur première forme
   ne reproduisait aucun défaut.
4. **Ce qui n'est pas testable est écrit là où il vit.** Ce que le plugin ne voit pas est dans le
   plugin ; ce que l'étape CI ne couvre pas est dans l'étape ; la règle qui découle du 4,21 est dans
   le test, à l'intention de step-041.

## Hérité de step-001, à traiter ici
- **La feuille de style de l'application bloque la première peinture.** Vite émet un
  `<link rel="stylesheet">` dans le `<head>` : le squelette de chargement à froid attend cet
  aller-retour, malgré son style inline. Mesuré au moment de step-001 : 680 octets, 379 compressés,
  0,6 à 0,8 ms sur une boucle locale — négligeable tant que la feuille est petite, ce que cette step
  change en y versant les tokens. **Remesurer avant de décider.**
- **Les polices auto-hébergées s'y ajouteront**, et leurs `@font-face` ne seront découverts qu'après
  l'analyse du CSS : deux allers-retours sérialisés avant que le moindre texte peigne, plus le FOIT.
  La parade (`<link rel="preload" as="font" crossorigin>` et `font-display: swap`) vit dans
  `web/index.html`.
- **Quatre valeurs de géométrie vivent dans le `<style>` inline d'`index.html`** —
  `--shell-rail-width`, `--shell-topbar-height`, `--skeleton-surface`, `--skeleton-shape` — parce que
  le squelette doit être peint sans requête. Elles sont la source unique que consomme `app.css` ; les
  absorber dans le pipeline de tokens sans rouvrir le blanc fait partie de cette step.

## Hors périmètre
Les primitives habillées → step-041 et step-042. La coquille → step-040. L'audit d'accessibilité
complet → step-185.

## Design arrêté (2026-08-08)

Les chiffres ci-dessous ont été **mesurés** le 08/08/2026, pas déduits.

### DN-0 — Le portage part de la v1.0, pas du skill, et la mesure le décide

La charte vit dans `.claude/skills/sms-gateway-design/tokens/` (320 lignes). La v1.0 du tableau de
bord en a fait un portage, effacé par `7c63eaf` et lisible au commit **`909eb8d`** (430 lignes de
tokens). Confronter les deux, token par token : **236 contre 233**, et sur les 44 valeurs qui
diffèrent, **43 ne sont que du formatage** — la v1.0 était déjà passée par Biome, qui espace les
virgules. Il ne reste donc que **quatre écarts réels**, et chacun corrige un échec AA que j'ai
remesuré :

| Écart | Ce que donne la charte | Ce que donne la v1.0 |
|---|---|---|
| `--n-300` : `#6b7684` → `#848f9e` — il porte `--text-faint`, donc `--text-data-sm` en **11 px**, du texte normal au sens WCAG | canvas **4,16** · carte **3,93** · ligne sélectionnée **3,24** | **5,85** · **5,53** · **4,56** |
| `--red-400: #e85e62` ajouté, et l'alias `--text-danger-on-tint` — `--red-500` ne tient pas sur sa propre teinte, ce sont les pilules `failed`, `suspended`, `sev-critical` | canvas **4,33** · carte **4,05** | **5,02** · **4,69** |
| `--qr-paper: #ffffff` ajouté — la seule surface claire du produit, le fond de la vignette QR d'enrôlement MFA | — | nommé « paper » et non « light », parce que la garde « ne promet pas de thème clair » cherche `light` dans les noms |

« Les tokens sont portés **tels quels** » (périmètre) veut donc dire *ne rien redessiner*, pas
*repartir du skill* : repartir du skill livrerait trois paires connues comme non conformes, et le
contrôle de contraste de cette même step les refuserait. La v1.0 **est** le portage conforme de cette
charte. Les quatre écarts sont conservés avec leur commentaire d'origine, remesurés ici.

*(Corollaire : « portés tels quels » reste littéralement vrai. Porter depuis le skill aurait fait
reformater 43 déclarations par `make lint-web`, ce qui aurait démenti la phrase.)*

### DN-1 — La garde « consommé ⊆ déclaré » déménage dans le build

`web/chargement-a-froid.test.ts:136-152` exige que **tout** `var()` de la feuille émise soit déclaré
dans le `<style>` d'`index.html`. Un seul `var(--text-primary)` la fait tomber — elle a été écrite
pour quatre variables de géométrie, pas pour 236 tokens.

Le contrôle passe sur l'**union** (document ∪ CSS émis) et devient une **erreur de build** (DN-4).
C'est strictement plus fort qu'aujourd'hui : il couvre les 236 tokens, là où la garde actuelle n'en
voyait que quatre.

Écarté : **inliner les tokens dans `index.html`** — 9 Ko dupliqués dans un document `no-cache`,
renvoyés à chaque navigation, et deux sources de vérité pour 236 tokens au lieu de quatre. Écarté
aussi : **restreindre la garde à une liste nommée** — c'est le mode d'échec que `charte.test.ts`
documente en toutes lettres (« une liste ne voit jamais le token qu'on vient d'inventer »).

### DN-2 — Le squelette s'aligne sur la charte, valeurs et unités

| `index.html` aujourd'hui | devient | miroir de |
|---|---|---|
| `--shell-rail-width: 15rem` (240 px) | `236px` | `--nav-width` |
| `--shell-topbar-height: 3.5rem` | inchangé | `--topbar-height` (56 px, déjà égal) |
| `--skeleton-surface: #12151c` | `#0c0f14` | `--surface-page` |
| `--skeleton-shape: #1c212b` | `#1c242f` | `--border-subtle` |

Non alignés, le rail se déplace de 4 px et le canvas change de luminance entre la première peinture
et le montage de React. Les **noms restent distincts** : ils désignent « ce que le squelette peint »,
et `chargement-a-froid.test.ts:98-113` relit ces valeurs **dans le texte d'`index.html`** — elles
doivent y rester déclarées. Ce qui devient testable, c'est que la copie soit fidèle : quatre paires.

### DN-3 — `/_design` sort de la coquille par une mise en page sans chemin

```
__root.tsx              createRootRoute({ notFoundComponent })  ← plus de component
_shell.tsx              la coquille  →  <Coquille><Outlet/></Coquille>
_shell.index.tsx        git mv depuis index.tsx
[_]design.tsx           frère de _shell, donc hors de la coquille
components/coquille.tsx le chrome inerte, partagé par _shell et par NotFound
```

**Le nom `[_]design.tsx` n'est pas un style** : dans TanStack Router, `_design.tsx` est un *pathless
layout* et ne produit **aucune URL** — la page serait injoignable. C'est le piège que la v1.0 avait
déjà rencontré et documenté.

`Coquille` est extraite parce que `__root.test.tsx` asserte qu'une URL inconnue la garde autour du
message : le `notFoundComponent` de la racine rend **hors** de `_shell`. Sans l'extraction, ce test se
met à mentir ou disparaît. Piège relevé à l'exploration : le helper `visit()` de `__root.test.tsx`
attend `findByRole('main')` — `/_design` doit donc porter son propre `main`.

**Garde de session : rien à tester**, elle n'existe pas encore. Ce qui est livrable, c'est la
**structure** : le `beforeLoad` de M1 ira sur `_shell`, et `/_design` en est un frère. Un test « la
route ne déclare pas de `beforeLoad` » serait un test de complaisance sur du code absent — critère 4,
le constat s'écrit dans l'en-tête de `[_]design.tsx`.

### DN-4 — Un token absent fait échouer le build

Rien ne le fait aujourd'hui : CSS pur, pas de PostCSS, pas de typage, et Vite ne valide aucun `var()`.
`web/vite-plugin-tokens.ts` exporte deux choses : `undeclaredTokens(sources)`, pure, commentaires
retirés d'abord — sinon un commentaire qui cite `--danger-border` compte comme consommé — et le plugin
`writeBundle` qui appelle `this.error()`. `vite build` sort non nul, donc `make build`,
`make check-routes` et deux jobs de CI rougissent.

**Ce qu'il ne couvre pas, à écrire dans le fichier** : `apply: 'build'`, donc `vite dev` ne le joue
pas ; et il ne voit pas un `var()` composé à l'exécution — le motif même de `/_design`, couvert par le
test de DN-5 et non par le build.

Écarté : **`stylelint` + `@csstools/stylelint-value-no-unknown-custom-properties`** — deux dépendances
soumises à la quarantaine de 24 h, une configuration, une cible `make` et un job de CI, là où ~50
lignes maison auto-testées suffisent. Il faudrait de toute façon lui déclarer le `<style>`
d'`index.html` comme source.

### DN-5 — Les paires de contraste sont une table unique

La fiche exige « chaque paire **utilisée par `/_design`** ». Une énumération à la main dans le test
dérive dès la première section ajoutée. Donc `web/src/lib/design-tokens.ts` porte les tables — rôles
typographiques, surfaces, couleurs sémantiques, espacements, rayons, **et les paires texte/fond** —,
`[_]design.tsx` les `map`, le test les importe. « Les paires que la page rend » devient littéralement
vrai, et la page gagne une section utile.

Module de données séparé plutôt qu'export depuis la route : le test tourne en
`@vitest-environment node` et n'a alors ni React ni le routeur à charger.

### DN-6 — Polices : `@fontsource` importé depuis le CSS, sans preload

Sous-ensemble **latin** seul, sept fichiers — Sans 400/500/600/700, Mono 400/500/600, soit **139 Ko**
de woff2 (mesuré). `font-display: swap` est **déjà posé par `@fontsource`** (vérifié dans
`latin-400.css`, pas supposé) : la moitié « FOIT » de l'inquiétude héritée de step-001 est réglée par
le vendor.

Vite hache les `.woff2` et les place sous `/assets/`, donc `serveAsset` les sert en
`Cache-Control: immutable`. **Pas de `preload`** : la première peinture ne contient aucun texte
visible — le squelette n'a qu'un `sr-only` —, donc l'aller-retour police n'est pas sur le chemin
critique. Le waterfall est mesuré et la mesure inscrite ; s'il contredit ce raisonnement, la parade
est un `transformIndexHtml` `{order:'post'}` lisant `ctx.bundle` pour retrouver les noms hachés.

Écarté : **`web/public/fonts/` avec des `@font-face` à la main.** Les noms y seraient stables, donc le
`preload` s'écrirait directement — mais hors `/assets/`, `serveShell` les rend en **`no-cache`** :
139 Ko revalidés à chaque navigation. Et sept `@font-face` à maintenir à la main là où le lockfile
les tient.

### DN-7 — « Vérifié sur le binaire » = la CI *et* le parcours

`make e2e` est **hors de `make check`** : cocher « `make check` vert » ne prouve donc rien sur le
binaire. Les deux moitiés sont nécessaires, et aucune ne remplace l'autre.

- **CI, dans l'étape existante « Le binaire sert la sortie de Vite »** (pas un job de plus) : elle
  n'inspecte aujourd'hui que le premier `/assets/*.js`. Étendue à la feuille CSS, puis à un
  `url(/assets/…woff2)` extrait **des octets servis**, avec vérification de la signature `wOF2` et du
  `content_type`, et refus de toute origine absolue dans la feuille servie. Ce qu'elle prouve et que
  rien d'autre ne prouve : le **déployable** sert la feuille et la police, avec le bon type.
- **Playwright, en étendant `e2e/coquille.spec.ts`** (critère 1 : étendre, ne pas ajouter) :
  `page.on('request'|'requestfailed'|'console'|'pageerror')` posés **avant** le premier `goto`. Plus un
  **plancher** « au moins une requête `.woff2` » — sans lui, « aucune police tierce » serait vrai en
  n'ayant chargé aucune police.

### DN-8 — Quatre corrections que la vérification a apportées au design

1. **Le test « n'emporte aucune adresse » lira les `.woff2` en `utf8`.** Il concatène *tous* les
   fichiers émis ; 139 Ko de binaire décodés en UTF-8 passeront dans une regex d'URL. Non
   déterministe. Filtré par extension dans cette step.
2. **Un `web/test/*.ts` serait exécuté sans être typechecké.** `tsconfig.include` vaut
   `["src", "e2e", "*.config.ts", "*.test.ts"]` : pas de `test/`, et le glob racine ne prend pas
   `.tsx`. Le lecteur de tokens va donc à la **racine de `web/`**, comme `chargement-a-froid.test.ts`.
3. **La page `/_design` de la v1.0 n'est pas portable.** Elle importe neuf primitives et cinq états de
   contenu qui n'existent pas ici (step-041/042), et déclare son CSS par `head: () => ({ links })` —
   une API **TanStack Start**, que ce dépôt n'utilise pas. Ce qui est porté d'elle, c'est le **nom du
   fichier** et six de ses huit sections, en esprit.
4. **`internal/gateway/version_test.go`** (step-009) lit les tableaux de versions de `plan.md` et
   `todo.md` et échoue s'il n'en trouve plus : ne pas casser leur forme en les modifiant.

## Ce que la revue a trouvé, et les mutations des correctifs

Deux relecteurs en lecture seule, sur deux axes : solidité des gardes, et conformité charte /
accessibilité / langue. **Chaque constat a été remesuré avant d'être corrigé** — l'un d'eux s'est
révélé faux à la première mesure, puis vrai à la seconde, et c'est instructif.

### Deux bloquants, tous deux réels

**Le juge n'était pas branché.** `[_]design.tsx` écrit à l'écran, en français : « Chaque ligne est
vérifiée à 4,5:1 par `test/charte.test.ts`, qui lit cette même table. » **C'était faux.** Le test
importait bien `CONTRAST_PAIRS`, mais seulement pour vérifier que les *tokens existent* ; les
assertions de ratio portaient sur trois listes écrites à la main. Mesuré : une paire à 2,53:1 ajoutée
à la table laissait les 108 tests verts, et la page l'affichait comme vérifiée. DN-5 tout entière
reposait sur ce couplage inexistant. Corrigé par un `it.each(CONTRAST_PAIRS)` ; muté, il mord.

**`--text-faint` ne tient pas AA sur une ligne sélectionnée en carte : 4,21.** `colors.css` affirmait
« 4,5 sur toutes les surfaces du système — y compris les surfaces composées ». Le test ne composait
`--surface-selected` que sur `--surface-page`, la porteuse la plus clémente (4,56). Sur `--surface-card`,
où vivent les tables du produit, la même paire rend **4,21**.

*Ma première mesure n'a rien trouvé* — `console.log` avalé par Vitest — et j'ai failli classer le
constat comme faux. La seconde, en faisant échouer une assertion pour lire la valeur, l'a confirmé.

L'issue « éclaircir encore » est **fermée** : la première valeur conforme partout est `#8b95a3`, qui
est exactement `--n-200`. Confondre deux échelons supprimerait un cran de l'échelle. La règle retenue
est donc de design : **sur une surface interactive, le texte discret remonte d'un cran** —
`--text-muted` (4,55 en carte), jamais `--text-faint`. Le test compose désormais sur les deux
porteuses et exclut `--text-faint` avec sa mesure écrite ; step-041, qui livrera les tables, hérite de
la règle plutôt que du chiffre.

### Les constats requis, et ce que chaque correctif a rendu falsifiable

| Constat | Remesuré | Correctif, et la mutation qui le tient |
|---|---|---|
| **L'anneau de focus pouvait disparaître.** Retirer `@import "./tokens/base.css"` d'`app.css` laissait 137 tests verts et `vite build` à rc=0 — or `base.css` porte seul `:focus-visible { box-shadow: var(--focus-ring) }` | **Juste**, et c'est WCAG 2.4.7 | l'assemblage d'`app.css` est comparé à `TOKEN_FILES` ; muté : rouge |
| **Deux tiers de `/_design` pouvaient s'évaporer.** Le test n'énumérait que 4 des 6 sections ; supprimer « Rayons » restait vert | **Juste** | les six, plus un décompte qui refuse une septième non annoncée ; muté : rouge |
| **La page pouvait rendre nue.** Retirer `import '~/styles/design-reference.css'` laissait tout vert — le test lisait la feuille *sur disque*, pas dans le bundle | **Juste** | chaque fichier de `STYLED_FILES` doit être importé par un module ; muté : rouge |
| **Le seuil AA lui-même n'était gardé par rien** : `AA_NORMAL_TEXT = 1` laissait tout vert | **Juste** | un cas négatif — une paire dont on *sait* qu'elle échoue ; muté : rouge |
| **« 10 723 octets »** dans `index.html` et le test | **Faux** : **12 635** bruts, 3 420 gzip. Le chiffre datait d'avant `/_design`, pris au commit précédent | remesuré, et la marge réelle sous le plafond écrite : 3,7 Ko |
| **« les sept `.woff2` (144 Ko) »** | **Faux** : **14 fichiers**, 7 `.woff2` (139 Ko) *et* 7 `.woff` (132 Ko), `@fontsource` déclarant les deux formats | corrigé ; les `.woff` sont du lest assumé — les retirer demanderait de réécrire sept `@font-face` à la main, ce que DN-6 a écarté |
| **`Coquille` et `AdresseInconnue` sont des identifiants français**, ce que « le code est en anglais » interdit | **Juste**, et c'était la première occurrence dans le dépôt | `Shell` et `UnknownAddress`, fichiers renommés ; le plugin passe de `tokens-declares` à `declared-tokens` |
| **`colors.css` se contredit** : « l'un des deux écarts » puis « second et dernier », alors qu'il y en a trois | **Juste** | un seul écart *de valeur*, deux tokens *ajoutés* — dit ainsi |
| **« aucune valeur littérale »** alors que `60ch`, `14rem` et `42rem` en sont | **Juste** | la phrase dit ce qu'elle couvre, et pourquoi ces trois-là n'ont pas de token : la charte ne définit ni mesure ni gabarit de grille |

### Ce que la revue a signalé et que je n'ai pas corrigé

- **Le plugin accepte un token déclaré dans une portée où il ne s'applique pas** — `@media print { :root { --x } }` dans `tokens/`, consommé ailleurs : build vert. Réel, mais fermer ce trou demanderait un analyseur CSS complet là où le plugin fait 50 lignes. **Écrit dans le plugin**, avec le cas exact.
- **`design-reference.css` atterrit dans la feuille d'entrée**, pas dans un chunk : 1 912 octets servis sur `/` pour une page que seul un développeur visite. La cause est mesurée — l'`import` de la route est statique dans `routeTree.gen.ts`, donc `autoCodeSplitting` scinde le composant et pas sa feuille. Inscrit dans `index.html`.
- **Le raccourci `font:` réinitialise `font-variant-numeric`**, donc les `tabular-nums` que `base.css` pose sur `body` sont défaits partout où un rôle typographique s'applique. Le kit de la charte a le même trou ; le portage est fidèle. Sans effet aujourd'hui (les chiffres visibles sont en mono), réel pour les KPI de step-041.
- **Le volume de commentaire** est élevé (30 % en moyenne, 75 % sur `__root.tsx`), et le piège du nom de route est raconté trois fois. Assumé sur les gardes, dont tout l'intérêt est de dire ce qu'elles ne couvrent pas.

### Ce que CodeQL a trouvé, et que `make check` ne pouvait pas voir

`CLAUDE.md` prévient que trois portes ne se rejouent jamais en local — CodeQL, `code_quality`, et le
contrôle du job « Build client et déployable ». La première a bloqué cette PR après onze portes vertes.

**`js/incomplete-multi-character-sanitization`, sévérité haute**, sur la ligne qui retirait les
commentaires avant de compter les tokens : un remplacement unique de `<!--…-->` laisse passer une
imbrication.

Ce n'était pas une faille — le résultat d'un outil de build n'est jamais rendu comme HTML. Mais
l'alerte était juste **sur la forme**, et elle pointait un défaut de conception plus intéressant que
le risque qu'elle nommait : ce code n'a aucune raison de prétendre nettoyer du HTML. Ce dont il a
besoin, ce sont les blocs `<style>` du document.

Le correctif est donc plus précis que l'alerte ne l'exigeait. Les commentaires HTML — qui citent des
noms de tokens dans `index.html` — cessent d'être **lus**, au lieu d'être nettoyés. Muté comme le
reste : `var(--danger-border)` fait toujours échouer `make build` en nommant le token, et un token
déclaré par le `<style>` du document puis consommé par la feuille passe toujours — l'union que le
plugin juge n'a pas bougé.
