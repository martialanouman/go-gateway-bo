# step-080 — Trafic : instantané REST, widgets et graphiques

> **Jalon :** M4 (§6.3) · **Statut :** À FAIRE
> **Dépend de :** step-040, step-041 · **Bloque :** step-081, step-082

## But
Livrer l'écran d'accueil de l'exploitation : les compteurs qu'un opérateur regarde en premier, servis
par un instantané REST — le direct viendra en step-081.

## Périmètre (ce que fait CETTE PR)
- Écran Trafic : widgets MT/s, MO/s, taux de succès, latence p50/p99, sessions actives.
- Opérations : `get-metrics-summary`, `get-traffic-metrics`.
- Séries temporelles avec **Recharts**, habillées selon la charte §07 : aire teal + ligne, ligne bleue
  secondaire, grille discrète.
- Cinq états de contenu câblés (dont « données périmées » distinct de « erreur »).

## Points d'implémentation clés
- **Instantané ≠ direct** : aucun point pulsant à ce stade (charte). L'écran affiche l'heure de
  l'instantané.
- Les métriques viennent **exclusivement de l'API Admin** : le tableau de bord n'interroge jamais
  Prometheus/Thanos directement (§3.2).
- Les compteurs sont en mono ; les axes et légendes restent lisibles en thème sombre avec le contraste
  AA (§1.2).
- Pas de recalcul côté client de ce que la passerelle agrège déjà : l'agrégation est faite en amont (§2).

## Tests (écrits dans la même PR)
- Les widgets rendent les valeurs de l'instantané ; erreur amont → `ErrorState` avec « vos données
  locales restent affichées ».
- Aucun indicateur de direct tant que le flux WS n'est pas branché.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] graphiques conformes à la charte §07 · contraste AA vérifié

## Hors périmètre
Le flux WS et la bascule de plage → step-081. Les ventilations → step-082.
