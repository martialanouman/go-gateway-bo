# step-080 — Trafic : instantané REST, widgets et graphiques

> **Jalon :** M4 (plan §9, spec §6.3) · **Statut :** FAIT
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
  step-081 les reprenne sans changement (l'enum ne vit que sur le paramètre de requête : le `window` des
  deux DTO de sortie est un `string`) ; `groupBy` ∈ `connector|customer|group`.
- **Graphiques en SVG maison** : le `Chart` du kit (aire teal + ligne, deux lignes de grille, sans
  axes, charte §07) porté dans `web/src/components/traffic/`, avec `MetricTile` ; leur CSS voyage dans
  le bloc de la route, la feuille d'entrée n'ayant plus d'octet libre (`cold-load.test.ts`). Aucune bibliothèque : aucun axe ni zoom
  demandé ; on en ajoutera une le jour où un écran en aura besoin (dette 047, visx contre Recharts, payée par cette décision). Le plan §9 (« Nouvelles
  dépendances : bibliothèque de graphiques ») est amendé.
- **Écran `/traffic`**, fenêtre fixe de 5 min, relu toutes les 10 s (une tranche) par React Query ;
  step-081 remplace ce rafraîchissement par le flux.
  - **Tuiles** : MT/s = `submitted`/300 ; MO/s = `mo_received`/300 ; taux de succès =
    `delivered`/(`delivered`+`failed`+`rejected`), parmi les issues connues — sur 5 min, des messages
    sont encore en vol ; latences p50 et p99 de bout en bout (`e2e_latency_ms_*`), une tuile chacune ; sessions actives —
    six tuiles, en grille de 3 colonnes, 6 à partir de 1280 px.
    Une valeur `null` ou absente se lit « non mesurée », jamais 0.
  - **Graphiques** depuis un seul appel `groupBy=customer` — le seul regroupement où chaque message
    figure (`connector` omet les messages jamais dispatchés) : « Débit MT » (soumis, remis) et « Taux
    d'échec » (échoués/soumis) par tranche de 10 s. Chacun porte un libellé accessible qui le résume.
  - **États** : squelette ; erreur avec « Réessayer », dernières valeurs conservées ; fenêtre sans
    message soumis.
- **Embarqué** : le secret de `SecretShown` passe à la ligne (`overflow-wrap: anywhere`, en style
  porté par l'élément pour ne pas toucher le budget de `cold-load.test.ts`) au lieu de défiler
  horizontalement — constaté au navigateur le 10/10/2026 (481 caractères sur 3 483 px dans un corps
  de 518 px, WCAG 1.4.10). go-gateway#294 n'étant pas mergée à la clôture, la dette 067 n'est pas supprimée : son porteur passe à step-081.

## Tests (les risques, et la preuve de chacun)
- **Lecture du trafic sans la clé** → scénario : `Audit` → 403 `permission_denied` sur les deux
  routes. Mutation : garde sur une autre clé.
- **Relais qui ne parle pas comme le contrat** → scénarios contre Prism, réponses conformes au
  contrat du BFF.
- **Sujet temps réel ouvert à qui n'a pas la clé** → test du hub : un client sans `traffic:read`
  n'est pas abonné. Mutation : permission retirée du `feed`.
- **Un `null` lu comme 0, un taux faux, une série oubliée dans la somme** → unitaires TS sur les
  calculs. Mutations : `?? 0` à la place de « non mesurée » ; somme sur la première série seulement.
- **États de l'écran** → tests de composant (chargement, erreur avec valeurs conservées, fenêtre vide, sondage et reprise).
- **Secret qui défile** → test de composant sur le style porté ; vérifié au navigateur
  (`scrollWidth ≤ clientWidth`).
- **Chemin d'écran** → parcours e2e de la coquille étendu jusqu'à « Trafic » ; `fakegateway` sert
  les deux routes de métriques.

## Vérifié
- Au navigateur le 10/10/2026 : les six tuiles lisent 30,0 / 5,0 / 95,6 % / 120 ms / 840 ms / 12 ; la modale
  du jeton fait 518/518 px (`scrollWidth` = `clientWidth`), sans défilement horizontal.
- Critère 4 : en production le handler de synthèse de go-gateway ne renseigne pas `active_sessions`,
  la tuile lit donc « non mesurée » ; les 12 vus au navigateur viennent de la fausse passerelle.
- Arbitrages de la revue finale : l'amont n'émet que les tranches non vides (regroupement sans
  remplissage), `totals` comble les trous par des zéros au pas de la fenêtre (10 s, 30 s, 60 s) ; à
  zéro message soumis, les six tuiles restent (MO/s et sessions peuvent être non nuls) et l'état vide
  ne remplace que les deux graphiques. Le sondage de 10 s et la reprise après un échec sont couverts
  par un test à horloge simulée.
- Mutations, chacune lancée dans un worktree isolé, le test nommé seul (toutes rouges) :

| Mutation | Test rouge |
|---|---|
| garde de `GetMetricsSummary` sur `audit:read` | scénario « sans traffic:read, le trafic est refusé et le refus nomme la clé » |
| permission du feed `metrics.traffic` remplacée par `audit:read` | scénario « le trafic temps réel est refusé à qui ne détient pas traffic:read » |
| `anyOf: []` sur l'entrée Trafic | `shell.test.tsx` « shows only what the session grants, and hides emptied groups » (`navigation.test.tsx` reste vert : il ne teste pas cette entrée) |
| `latency(null)` rend `'0 ms'` | `traffic.test.ts` « keeps an unmeasured latency unmeasured instead of zero » |
| `totals` ne lit que la première série | `traffic.test.ts` « sums every series, other included, per bucket » |
| `successRate` sans `rejected` au dénominateur | `traffic.test.ts` « rates success among the messages whose outcome is known » |
| `MetricTile` n'affiche jamais « non mesurée » | `chart.test.tsx` « says unmeasured instead of zero » |
| `window: '1h'` dans l'écran | `_shell.traffic.test.tsx` « asks the gateway for the five-minute window, per customer » |
| `style` retiré de `SecretShown` | `_shell.account.test.tsx` « shows the token once, with what it opens, and forgets it on close » |
| `retry` sans `summary.refetch()` | `_shell.traffic.test.tsx` « reads the figures again when the retry is used » |
| plancher d'échelle du graphique rétabli (`Math.max(..., 1)`) | `chart.test.tsx` « scales a ratio series on its own maximum instead of a floor of one » |
| comblement des tranches retiré | `traffic.test.ts` « fills the buckets the gateway left out with zeros, at the window step » |
| `refetchInterval` retiré | `_shell.traffic.test.tsx` « polls both endpoints every ten seconds and recovers after a failed poll » |
| tuiles masquées quand rien n'est soumis | `_shell.traffic.test.tsx` « says the window is empty rather than drawing zeros » |

## Hors périmètre
- Bascule 5 min / 1 h / 24 h et flux WS (step-081) ; 24 h n'est pas servi par l'amont (422).
- Ventilations par connecteur, client, compte, groupe, catégorie et drill-down CDR (step-082).
