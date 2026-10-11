# step-087 — Trafic : débit MO par tranche

> **Jalon :** M4 (plan §9, spec §6.3) · **Statut :** FAIT · *(insérée le 11/10/2026)*
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
- **Disposition (arbitrée avec l'utilisateur)** : trois cartes de même largeur, Débit MT, Débit MO,
  Taux d'échec — l'ordre des tuiles. La grille passe de `auto-fit, minmax(20rem, 1fr)`, qui aurait
  rendu 2 + 1, à trois colonnes fixes : sous 1280 px chaque graphique tombe sous sa tuile.
- **Les trois cartes restent toujours** : une carte sans donnée porte son propre état vide (« Aucun
  MT soumis… » pour Débit MT et Taux d'échec, « Aucun MO reçu… » pour Débit MO), jugé sur ses propres
  séries. Remplace l'état vide unique de step-080, qui recouvrait les graphiques à zéro MT soumis ; du
  MO peut arriver sans MT.
- **Ce que la courbe compte** : les MO routés à un compte. Confronté à go-gateway `c68af44` : la
  synthèse (`MetricsSummary`) et les séries (`Traffic`) lisent toutes deux la CDR, qui ne reçoit
  qu'une ligne par MO **routé** (go-gateway#302) — la tuile MO/s et la courbe comptent la même
  population, aucune mention n'est due.
- **Les libellés nomment le flux (arbitré avec l'utilisateur)** : taux de succès, latences et taux
  d'échec ne portent que sur le MT (`direction = 'mt'` dans les requêtes de go-gateway) ; ils
  deviennent « Succès MT », « Latence MT p50/p99 », « Taux d'échec MT ». « Sessions actives » devient
  « Sessions SMPP » : un bind porte les deux directions. Pas de tuile d'échec : la spec n'en liste
  pas, et une septième casserait la grille.
- **Taux d'échec en ambre** (`--amber-500`, aire à 16 %), comme le graphique « Taux d'erreur » de la
  maquette du kit : l'ambre est l'état dégradé de la charte, le rouge reste aux états critiques.
- **Une infobulle par tranche** (arbitré avec l'utilisateur, qui a écarté une lecture « valeur ·
  pic » dans l'en-tête, jugée encombrante) : sans axe, chaque courbe est mise à l'échelle de son
  propre maximum, et un pic à 3 % se dessine comme un pic à 30 %. Au survol, un trait marque la
  tranche la plus proche et l'infobulle donne son heure et ses valeurs, débits en messages par
  seconde comme les tuiles. Équivalent clavier (WCAG 2.1.1) : le graphique prend le focus, ←/→
  changent de tranche, Début/Fin vont aux extrémités, Échap ferme ; l'infobulle est une région
  `status` hors du `role="img"`, dont les enfants ne seraient pas annoncés. Le libellé accessible
  garde la dernière tranche et le pic, en messages par seconde.
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
- **État vide** → tests de composant : MO sans MT (les deux cartes MT disent leur vide, la courbe MO
  reste), et MT sans MO.
- **Chemin d'écran** → parcours e2e de la coquille : la section Trafic lit le graphique « Débit MO » ;
  `fakegateway` sert `mo_received` par tranche.

## Vérifié
- `make check` vert, parcours e2e vert (11/10/2026).
- Au navigateur, binaire local et trafic généré : les trois cartes à 3 × 261 px (1100 px) et
  3 × 375 px (1440 px), chacune sous sa tuile à 1100 px. Critère 4 : la grille de trois colonnes et
  la teinte ambre du taux d'échec ne sont tenues par aucun test — vérifiées ici. L'infobulle vue au
  navigateur (instance de sonde sur une base séparée) : trait et valeurs sur Débit MT, bascule à
  gauche du trait près du bord droit sur Taux d'échec MT.
- Le libellé accessible et la courbe MO lisent une seule série (`moSeries`) : la mutation « courbe sur
  `submitted` » restait verte tant que le libellé était calculé à part.
- Mutations, le test nommé seul, l'arbre restauré entre chacune (toutes rouges) :

| Mutation | Test rouge |
|---|---|
| `totals` ne somme pas `moReceived` | `traffic.test.ts` « sums every series, other included, per bucket » |
| `moSeries` lue sur `submitted` | `_shell.traffic.test.tsx` « shows the figures of the last five minutes » |
| « Débit MO » masqué quand rien n'est soumis | `_shell.traffic.test.tsx` « says each chart is empty rather than drawing zeros, and keeps the MO flowing without MT » |
| état vide MO retiré | `_shell.traffic.test.tsx` « says the MO chart is empty when no MO was received » |
| état vide MT retiré | `_shell.traffic.test.tsx` « says each chart is empty rather than drawing zeros, and keeps the MO flowing without MT » |
| pic lu sur la dernière tranche | `_shell.traffic.test.tsx` « shows the figures of the last five minutes » |
| dernière valeur lue sur la première tranche | `_shell.traffic.test.tsx` « shows the figures of the last five minutes » |
| `bucketRate` rend un compte par tranche au lieu d'un débit par seconde | `_shell.traffic.test.tsx` « shows the figures of the last five minutes » |
| le focus n'ouvre pas l'infobulle | `_shell.traffic.test.tsx` « reads one bucket in a tooltip, from the keyboard and from the pointer » |
| ← avance au lieu de reculer | idem |
| Échap sans effet | idem |
| sortie du pointeur sans effet | idem |
| survol sur la tranche précédente (`floor` au lieu de `round`) | idem — vert tant que le pointeur tombait pile au milieu d'une tranche (x = 50 sur 3 points), rouge à x = 40 |
| « Remis » lu sur `submitted` | idem |
| relais sans `MoReceived` (`internal/bff/metrics.go`) | e2e `shell.spec.ts` (« Débit MO, pic de 50… » introuvable) ; le scénario godog reste vert, il ne juge que la conformité |

## Hors périmètre
- Flux WS, bascule de plage, compteur temps réel MO (step-081).
- Ventilations et drill-down (step-082).
