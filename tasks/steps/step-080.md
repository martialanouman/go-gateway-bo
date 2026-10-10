# step-080 — Trafic : instantané REST, widgets et graphiques

> **Jalon :** M4 (plan §9, spec §6.3) · **Statut :** EN COURS
> **Dépend de :** step-043 (hub), step-070 (jeton de l'opérateur), **contrat 7.3.0** · **Bloque :** step-081, step-082

## But
Le premier écran du cockpit d'incident : ce que la passerelle a traité ces cinq dernières minutes,
lisible d'un coup d'œil. L'instantané REST seul ; le flux temps réel et la bascule de plage sont
step-081, les ventilations et le drill-down step-082.

## Décisions (arbitrées le 10/10/2026 avec l'utilisateur)
- **Contrat : on reste en 7.3.0.** Relevé le 10/10/2026 : 7.6.0 publiée. Les opérations
  `get-metrics-summary`, `get-traffic-metrics` et les schémas `MetricsSummary`, `TrafficMetrics` sont
  identiques octet pour octet entre les deux. Écart consigné dans la PR.
- **Permission `traffic:read`**, classe `GatewayRead` (→ `admin:read`), accordée à tous les rôles par
  défaut sauf `Audit` (spec : « `audit:read` uniquement »). La description de `Reporting` (« rien
  d'autre ») et la spec §6.10 sont amendées. Le rail (`navigation.ts`) et le sujet `metrics.traffic`
  du hub l'exigent aussi : les trois portes disent la même chose. Les commentaires qui affirment
  « aucune clé pour lire le trafic » (`internal/hub/frames.go`, `navigation.ts`) sont réécrits.
- **Routes relayées** `GET /api/metrics/summary?window=` et `GET /api/metrics/traffic?window=&groupBy=`,
  `requires(TrafficRead)`, DTO de sortie déclarés. `window` ∈ `5m|15m|30m|1h` comme l'amont, pour que
  step-081 les reprenne sans changement ; `groupBy` ∈ `connector|customer|group`.
- **Graphiques en SVG maison** : le `Chart` du kit (aire teal + ligne, deux lignes de grille, sans
  axes, charte §07) porté dans `web/src/components/traffic/`, avec `MetricTile` ; leur CSS voyage dans
  le bloc de la route, la feuille d'entrée n'ayant plus d'octet libre (`cold-load.test.ts`). Aucune bibliothèque : aucun axe ni zoom
  demandé ; on en ajoutera une le jour où un écran en aura besoin. Le plan §9 (« Nouvelles
  dépendances : bibliothèque de graphiques ») est amendé.
- **Écran `/traffic`**, fenêtre fixe de 5 min, relu toutes les 10 s (une tranche) par React Query ;
  step-081 remplace ce rafraîchissement par le flux.
  - **Tuiles** : MT/s = `submitted`/300 ; MO/s = `mo_received`/300 ; taux de succès =
    `delivered`/(`delivered`+`failed`+`rejected`), parmi les issues connues — sur 5 min, des messages
    sont encore en vol ; latences p50 et p99 de bout en bout (`e2e_latency_ms_*`), une tuile chacune ; sessions actives —
    six tuiles.
    Une valeur `null` ou absente se lit « non mesurée », jamais 0.
  - **Graphiques** depuis un seul appel `groupBy=customer` — le seul regroupement où chaque message
    figure (`connector` omet les messages jamais dispatchés) : « Débit MT » (soumis, remis) et « Taux
    d'échec » (échoués/soumis) par tranche de 10 s. Chacun porte un libellé accessible qui le résume.
  - **États** : squelette ; erreur avec « Réessayer », dernières valeurs conservées ; fenêtre sans
    message soumis.
- **Embarqué** : le secret de `SecretShown` passe à la ligne (`overflow-wrap: anywhere`, en style
  porté par l'élément pour ne pas toucher le budget de `cold-load.test.ts`) au lieu de défiler
  horizontalement — constaté au navigateur le 10/10/2026 (481 caractères sur 3 483 px dans un corps
  de 518 px, WCAG 1.4.10). Dette 067 supprimée si go-gateway#294 est mergée d'ici la fin de la step.

## Tests (les risques, et la preuve de chacun)
- **Lecture du trafic sans la clé** → scénario : `Audit` → 403 `permission_denied` sur les deux
  routes. Mutation : garde sur une autre clé.
- **Relais qui ne parle pas comme le contrat** → scénarios contre Prism, réponses conformes au
  contrat du BFF.
- **Sujet temps réel ouvert à qui n'a pas la clé** → test du hub : un client sans `traffic:read`
  n'est pas abonné. Mutation : permission retirée du `feed`.
- **Un `null` lu comme 0, un taux faux, une série oubliée dans la somme** → unitaires TS sur les
  calculs. Mutations : `?? 0` à la place de « non mesurée » ; somme sur la première série seulement.
- **États de l'écran** → tests de composant (chargement, erreur avec valeurs conservées, fenêtre vide).
- **Secret qui défile** → test de composant sur le style porté ; vérifié au navigateur
  (`scrollWidth ≤ clientWidth`).
- **Chemin d'écran** → parcours e2e de la coquille étendu jusqu'à « Trafic » ; `fakegateway` sert
  les deux routes de métriques.

## Hors périmètre
- Bascule 5 min / 1 h / 24 h et flux WS (step-081) ; 24 h n'est pas servi par l'amont (422).
- Ventilations par connecteur, client, compte, groupe, catégorie et drill-down CDR (step-082).
