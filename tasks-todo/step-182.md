# step-182 — Évaluateur BFF sur source durable à offset persisté

> **Jalon :** M9 (§6.8, §7) · **Statut :** À FAIRE
> **Dépend de :** step-180, step-044 · **Bloque :** —

## But
Évaluer les alertes métier — qui n'existent pas dans Prometheus — sans les perdre au premier
redémarrage.

## Périmètre (ce que fait CETTE PR)
- Évaluateur des règles `evaluation_owner = bff` : `account.reputation`,
  `billing.mt_balance_low`, `billing.mo_floor_reached`.
- Lecture d'une **source durable** (topic `billing.events` ou pull réconciliateur depuis
  `billing-svc`) avec **curseur/offset persisté**, de sorte qu'un redémarrage ou une bascule **rejoue
  les transitions manquées** au lieu de les perdre.
- Une seule instance évalue à la fois (verrou partagé, step-044) ; reprise à l'offset au basculement.
- Écriture des `notifications` correspondantes et distribution (step-181).

## Points d'implémentation clés
- **Le point du §6.8** : le flux WS sert l'affichage, **jamais l'unique détection**. Évaluer sur le
  flux Pub/Sub (au mieux une fois) reviendrait à perdre des alertes silencieusement — c'est
  exactement le défaut que cette step existe pour éviter.
- L'offset est persisté **après** traitement, jamais avant : en cas de crash, on rejoue plutôt que de
  sauter. Le dédoublonnage (step-181) absorbe le rejeu.
- Une bascule d'instance ne doit produire ni trou ni tempête de doublons : tester les deux.
- Le retard de l'évaluateur (lag d'offset) est une métrique à exposer : un évaluateur silencieusement
  en retard est pire qu'un évaluateur arrêté.

## Tests (écrits dans la même PR)
- Redémarrage au milieu d'un lot : les transitions manquées sont rejouées, aucune n'est perdue.
- Bascule d'instance : reprise à l'offset, sans doublon durable.
- Une transition franchissant un seuil crée exactement une notification.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] rejeu après redémarrage testé · lag exposé

## Hors périmètre
La réconciliation Alertmanager → step-183.
