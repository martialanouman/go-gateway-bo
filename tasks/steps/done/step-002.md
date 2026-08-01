# step-002 — Binaire unique : `embed.FS` et fallback SPA ordonné après `/api`

> **Jalon :** M0 (§1.3, §4.1) · **Statut :** LIVRÉE
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
- [x] `make build` produit un binaire qui sert l'application seul
- [x] `make check` vert
- [x] la mutation « monter le fallback avant les routes `/api` » fait rougir le scénario — c'est **le**
      test de cette step, et il doit reproduire le défaut réel : 200 + HTML, pas une absence de route

## Hors périmètre
Le nonce CSP par requête → step-186. La rétention d'assets entre versions → step-186. Les sondes de
disponibilité → step-186.
