# step-087 — Trafic : débit MO par tranche

> **Jalon :** M4 (plan §9, spec §6.3) · **Statut :** À FAIRE · *(insérée le 11/10/2026)*
> **Dépend de :** step-080, **contrat 7.7.0** · **Bloque :** step-081

## But
La spec promet des « compteurs/graphiques MT/MO » ; step-080 n'a livré que la tuile MO/s, faute de
MO par tranche au contrat. La 7.7.0 (go-gateway#302) ajoute `mo_received` à chaque point de
`get-traffic-metrics` : l'écran Trafic gagne un graphique « Débit MO ».

## Décisions (11/10/2026)
- **Relevé du contrat 7.3.0 → 7.7.0** en ouverture de step, diff du YAML relu le 11/10/2026 : rien de
  ce que le BFF consomme ne se resserre (`priority_tier` 0–2 et `priority_flag_default` ne sont lus
  par aucun code, step-083 les prendra). Installée le 11/10/2026, avant la fin de sa quarantaine
  (12/10 à 13 h 42 UTC), **par exception épinglée décidée par l'utilisateur**, qui remplace celle de
  la 7.3.0 (`web/pnpm-workspace.yaml`). 136 opérations avant et après. Le client Go régénéré renomme
  les constantes de `TrafficCategory` (`Marketing` → `TrafficCategoryMarketing`) : aucun appelant.
- **Relais** : `TrafficPoint` du contrat du BFF gagne `moReceived` (requis, un absent lu 0 comme les
  autres compteurs de `count()`), relayé par `internal/bff/metrics.go`.
- **Un graphique à part, « Débit MO »**, pas une troisième courbe dans « Débit MT » : à ~5 MO/s pour
  ~30 MT/s, une échelle commune l'écraserait au ras du bas — le défaut même que step-080 a corrigé
  sur « Taux d'échec ». Le MO n'a ni « remis » ni « échec » au sens du MT : une seule courbe.
- **Ce que la courbe compte** : les MO **routés** à un compte (`mo_received` des séries) ; un MO non
  routé n'est dans aucune série (description de `get-traffic-metrics`). La tuile MO/s lit la
  synthèse : si les deux ne comptent pas la même population, le libellé du graphique le dit.
  À confronter à `CDRReader.MetricsSummary` de go-gateway avant d'écrire la copie (critère 2).
- **`totals`** somme `moReceived` sur toutes les séries et comble les tranches vides par 0, comme
  pour le MT.
- **Hors périmètre** : le compteur temps réel `mo_received_total` du flux (`stream-metrics`) — il
  compte par segment et inclut le non routé, donc pas la même grandeur ; il se branche avec le flux,
  step-081. Les ventilations restent step-082.

## Tests (les risques, et la preuve de chacun)
- **Relais qui ne parle pas comme le contrat** → scénario godog de `traffic.feature` étendu à
  `moReceived` contre Prism.
- **MO oublié dans la somme, ou lu sur une seule série** → unitaire `traffic.test.ts`. Mutation :
  `totals` sans `moReceived`.
- **Graphique MO absent ou sur la mauvaise donnée** → test de composant de l'écran (libellé
  accessible avec pic et dernière tranche). Mutation : la courbe MO lit `submitted`.
- **État vide** : à zéro MT, l'état vide ne remplace aujourd'hui que les graphiques MT — décider si
  « Débit MO » reste (du MO peut arriver sans MT) ; test de composant de la règle retenue.
- **Chemin d'écran** → parcours e2e de la coquille : la section Trafic lit le graphique « Débit MO » ;
  `fakegateway` sert `mo_received` par tranche.

## Hors périmètre
- Flux WS, bascule de plage, compteur temps réel MO (step-081).
- Ventilations et drill-down (step-082).
