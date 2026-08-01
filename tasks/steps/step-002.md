# step-002 — Binaire unique : `embed.FS` et fallback SPA ordonné après `/api`

> **Jalon :** M0 (§1.3, §4.1) · **Statut :** À FAIRE
> **Dépend de :** step-000, step-001 · **Bloque :** step-007, step-186

## But
`go build` produit **un binaire autonome** qui sert l'application. C'est la promesse « un seul
déployable » du §4.1, et c'est aussi là que se joue le piège le plus coûteux de l'architecture SPA :
l'ordre entre le fallback et l'API.

## Périmètre (ce que fait CETTE PR)
- `embed.FS` sur la sortie de build du client, monté par le binaire.
- Service des assets avec les en-têtes qui vont bien : immuable pour les fichiers hashés,
  `no-cache` pour `index.html`.
- **Fallback SPA** : toute route non-API et non-asset rend `index.html`, pour que les URL profondes
  fonctionnent.
- **Ordonnancement explicite** : `/api/*` et `/ws` sont résolus **avant** le fallback. Une route
  `/api` inconnue rend **404**, jamais du HTML.
- `make build` enchaîne build client puis `go build`.

## Pièges connus, payés par la première tentative
- **Un motif `.gitignore` non ancré exclut le répertoire**, et git n'y redescend jamais : toute
  négation en-dessous est inerte. Un `.gitkeep` réputé commité ne l'était pas, et la branche ne
  compilait pas hors du poste de son auteur. Il faut dés-exclure le répertoire **avant** ses fichiers.
- **`emptyOutDir: true` de Vite supprime tout sauf `.git`** — donc le fichier qui conditionne
  `//go:embed`. Le nettoyage doit passer par `make`, qui sait l'épargner.
- **Le handler d'assets prend un `fs.FS` en paramètre**, jamais l'`embed.FS` en dur : sinon les tests
  Go dépendent d'un build client et `go test ./...` échoue sur un clone neuf.
- **Vérifier sur un vrai `git clone`**, pas sur le poste : c'est le seul endroit où l'absence d'un
  fichier ignoré se voit.
- **chi propage le `NotFound` du parent aux sous-routeurs qui n'en ont pas.** L'ordre des lignes ne
  protège donc rien : c'est la déclaration explicite d'un `NotFound` sur `/api` qui porte l'invariant.
  `/ws` doit être monté avant le repli lui aussi, même s'il rend un 501 jusqu'à step-043.

## Points d'implémentation clés
- **C'est l'ordre qui compte, et il se teste sur le binaire.** Si le fallback attrape `/api/inconnu`,
  la réponse est `200` + HTML. Le client lit `response.ok` puis appelle `.json()` : il lève, et l'écran
  affiche « indisponible » au lieu de « introuvable ». Le défaut est silencieux côté serveur et
  trompeur côté client — d'où un test qui interroge le binaire, pas le serveur de développement.
- `index.html` en `no-cache` est structurel, pas un réglage : il porte les références aux chunks
  hashés. Mis en cache, un onglet ouvert après un déploiement demanderait des chunks disparus — le
  risque que step-186 doit fermer pour de bon.
- Le binaire doit démarrer **sans Node installé**. C'est la vérification qui prouve que
  l'embarquement est réel.

## Tests (écrits dans la même PR)
- **Scénario** `assets.feature`, contre le binaire :
  - *Quand* une URL profonde est demandée, *Alors* `index.html` est rendu ;
  - *Quand* `/api/inconnu` est demandé, *Alors* la réponse est **404** et son type n'est pas `text/html` ;
  - *Quand* un asset hashé est demandé, *Alors* il porte un cache immuable ;
  - *Quand* `index.html` est demandé, *Alors* il porte `no-cache`.
- Le binaire démarre et sert l'application dans un conteneur **sans Node**.

## Definition of Done
- [ ] `make build` produit un binaire qui sert l'application seul
- [ ] `make check` vert
- [ ] la mutation « **repasser le repli en `r.NotFound()`, garde de `/api` retirée** » fait rougir le
      scénario — c'est **le** test de cette step, et il reproduit le défaut réel : 200 + HTML, pas une
      absence de route. *Ni la formulation initiale (« monter le fallback avant les routes `/api` »),
      ni la première correction (« retirer le `NotFound` de `/api` ») ne le reproduisent — les deux
      ont été mesurées, voir DN-9.*

## Hors périmètre
Le nonce CSP par requête → step-186. La rétention d'assets entre versions → step-186. Les sondes de
disponibilité → step-186.

## Design arrêté (2026-08-01)

Les trois premières décisions se tiennent en bloc : elles reposent toutes sur le même trio
`.gitkeep` + `all:` + répertoire ignoré par git. Arbitrées avec le modèle Fable, la spécification ne
tranchant pas.

### DN-1 — L'`embed.FS` vit dans `internal/webassets`, motif `all:dist`

`//go:embed` interprète ses motifs relativement au répertoire du fichier source et **ne peut pas
remonter** : `web/dist` doit donc être **copié** dans le répertoire du package qui embarque. Ce
répertoire est `internal/webassets/dist/`, parce que le `.gitignore` commité l'anticipe déjà
(lignes 25-34) avec le trio ordonné qui rend un `.gitkeep` réellement commitable — décision prise et
**payée par un défaut réel** lors d'une step précédente, qu'on ne rejoue pas pour respecter la lettre
d'une ligne de layout.

Le motif est `all:dist` et pas `dist` : `//go:embed dist` **exclut** les fichiers commençant par `.`
(doc du paquet `embed` : « the difference is that `image/*` embeds `image/.tempfile` while `image`
does not »), et un motif qui ne matche **aucun** fichier est une **erreur de compilation**. Sur un
clone neuf, `dist/` ne contient que `.gitkeep` : sans `all:`, `go build` casse partout sauf sur le
poste qui vient de construire le client — exactement la panne que le trio du `.gitignore` existe pour
empêcher.

**Conséquence assumée** : `tasks/plan.md` §1.1 et `CLAUDE.md` placent l'`embed.FS` dans
`cmd/dashboard/`. La divergence se corrige **dans le plan**, dans cette PR, pas en la contournant.

### DN-2 — `NewRouter(assets fs.FS)` : le handler d'assets reçoit un `fs.FS`, jamais l'`embed.FS`

Imposé par la fiche. La conséquence pratique est que `internal/bff` ne dépend pas d'un build client :
ses tests montent un `fstest.MapFS` et `go test ./...` passe sur un clone neuf.
`internal/webassets` expose `FS() (fs.FS, error)` qui fait `fs.Sub(embedded, "dist")` ; `main` l'appelle
et passe le résultat au routeur.

### DN-3 — Trois niveaux de preuve, et une lacune nommée

1. **Logique** (ordonnancement, en-têtes, repli, méthodes) — tests `internal/bff` sur `fstest.MapFS`.
2. **Câblage réel** (embed, `fs.Sub`, routeur, dans le binaire compilé) — scénario godog
   `cmd/dashboard/assets.feature`. Le harnais met en scène des **fixtures d'assets** dans
   `internal/webassets/dist/` avant de compiler, et restaure l'état d'origine ensuite : le répertoire
   est ignoré par git, donc rien ne salit l'arbre, et les quatre `Alors` s'exécutent **toujours**, sur
   clone neuf comme dans le job CI sans Node. Rien n'est simulé *dans le produit* — les assets sont
   une **entrée** du système sous test, comme le mock Prism l'est côté passerelle.
3. **Lacune assumée, écrite ici parce qu'elle n'est pas testable ici** : aucun test de cette step ne
   prouve que la **vraie** sortie de Vite atterrit dans le binaire. Cette affirmation appartient à
   `make build` (DN-4) et sera traversée par les parcours Playwright contre le binaire de step-007.

### DN-4 — `make build` enchaîne, `build-go` reste granulaire

`make build` = `build-web` → copie vers `internal/webassets/dist/` → `build-go`. Le job CI « Build Go »
appelle désormais `build-go`, parce qu'il n'a **ni Node ni pnpm** et que l'en-tête du Makefile pose la
règle : un job de CI n'invoque jamais une cible qui dépend de l'autre toolchain. Les deux exigences —
« `make build` enchaîne » et « le job Go reste sans Node » — redeviennent vraies ensemble.

La copie **purge les fichiers obsolètes en épargnant `.gitkeep`** : rien ne vide
`internal/webassets/dist/` (contrairement à `web/dist`, que Vite vide à chaque build), et sans purge
les assets hachés d'un build précédent s'accumuleraient dans le binaire. Supprimer le `.gitkeep`
rendrait l'arbre sale et recréerait le défaut de DN-1.

**Coût assumé** : plus aucun job de CI ne compile le binaire *complet*. « Build Go » compile un binaire
qui n'embarque que `.gitkeep` — c'est une porte de compilation, pas un artefact livrable.

### DN-5 — `/assets/*` immuable, tout le reste `no-cache`

`Cache-Control: public, max-age=31536000, immutable` pour ce qui est servi sous `/assets/`, `no-cache`
pour `index.html` et tout autre fichier racine. La frontière est le **chemin**, pas une reconnaissance
de hachage dans le nom : Vite place sous `assets/` tout ce qu'il hache — vérifié sur la sortie réelle
(`assets/index-BZaM5Pg4.js`, `assets/index-BM7VFVhX.css`, `assets/routes-Bm97Ugzo.js`) — et
`index.html`, qui porte les références à ces noms hachés, reste à la racine.

### DN-6 — Un asset absent sous `/assets/` rend 404, jamais `index.html`

C'est le même défaut trompeur que sur `/api`, transposé : un `<script src="/assets/…">` qui reçoit du
HTML en 200 échoue avec une erreur de syntaxe illisible, très loin de sa cause. Le repli ne s'applique
donc pas sous `/assets/`.

### DN-7 — Le repli ne répond qu'en `GET` et `HEAD`

Un `POST /clients` sur une route non montée doit dire « cette méthode n'est pas là », pas rendre la
coquille de la SPA en 200. Les autres méthodes rendent **405**.

### DN-8 — `/api` porte un `NotFound` explicite ; `/ws` est monté avant le repli

Le 404 de `/api` rend un **DTO déclaré** `{code, message}` — la forme d'erreur unique du produit
(§1.4), dont la traduction complète depuis l'API Admin arrive en step-003. `/ws` est monté dès
maintenant et rend **501** jusqu'à step-043 : une route déclarée qui ne mène nulle part vaut mieux
qu'une URL qui tombe dans le repli et rend du HTML à un client WebSocket.

### DN-9 — La mutation de la DoD est corrigée (deux fois)

La fiche demandait de muter en « montant le fallback avant les routes `/api` ». **Cette mutation
resterait verte** : dans chi v5.3.1, `NotFound` déclaré sur le parent est propagé à tout sous-routeur
qui n'en a pas — au moment de l'appel (`mux.go:212-216`, `updateSubRoutes`) **et** au montage
(`mux.go:308-309`). L'ordre des lignes ne protège donc rien, et l'inverser ne casse rien.

La première correction de cette DN désignait le **retrait du `NotFound` de `/api`** comme la mutation
juste. **Mesurée, elle ne l'est pas non plus** — parce que l'implémentation retenue monte le repli en
**routes** (`r.Get("/*")` + `r.Head("/*")`, exigé par DN-7 : c'est chi qui rend alors 405 sur les
autres méthodes) et non en `r.NotFound()`. Or chi fait gagner le segment statique `/api` sur le
wildcard `/*` : `/api/inconnu` n'atteint jamais le repli, et le retrait de la garde rend **404
`text/plain`**, pas la coquille.

Ce qui porte l'invariant est donc le **montage** ; le `NotFound` explicite de `/api` porte la **forme**
de l'erreur, plus un filet pour le jour où quelqu'un repasserait le repli en `r.NotFound()`. La
mutation qui reproduit le défaut réel — vérifiée, `200` + `<!doctype html` sur `/api/inconnu` — est
donc **le passage du repli de routes à `r.NotFound()`, garde de `/api` retirée**.

Les deux mutations sont conservées au tableau de la PR : celle qui produit le défaut réel, et celle
qui prouve que la garde porte bien la forme.
