# step-081 — Trafic : flux WS + bascule de plage (5 min / 1 h / 24 h)

> **Jalon :** M4 (§6.3, §1.2) · **Statut :** À FAIRE
> **Dépend de :** step-080, step-045 · **Bloque :** step-082

## But
Mettre l'écran en direct, avec une règle claire : les plages courtes viennent du flux, les longues
d'un instantané pré-agrégé.

## Périmètre (ce que fait CETTE PR)
- Abonnement au sujet `metrics.traffic` via `useTopic` ; mise à jour des widgets en place.
- Contrôle segmenté de plage : **5 min (WS)**, **1 h (REST)**, **24 h (REST)** — comme la charte §05.
- Indicateur de direct (point pulsant) uniquement en plage WS ; horodatage de fraîcheur sinon.
- Bascule en « données périmées » au-delà de la tolérance de 2–5 s.

## Points d'implémentation clés
- Le §6.3 est explicite : plages courtes via WS, longues via instantané REST pré-agrégé. Ne pas
  tenter de reconstituer 24 h à partir du flux.
- Changer de plage ne doit pas provoquer un saut visuel de valeurs : conserver l'échelle et signaler
  la transition.
- Se désabonner quand l'écran est démonté ou en plage REST : 300 opérateurs × N widgets, ça compte (§2).
- Une coupure du flux ne vide jamais le graphique : elle le marque périmé (invariant e).

## Tests (écrits dans la même PR)
- En plage 5 min, un message WS met à jour les widgets ; en 1 h et 24 h, aucun abonnement actif.
- Coupure du flux → état périmé, pas d'écran vide, reconnexion automatique.
- Le point pulsant n'apparaît qu'en direct.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] désabonnement effectif hors plage WS · fraîcheur affichée

## Hors périmètre
Les ventilations et le drill-down → step-082.
