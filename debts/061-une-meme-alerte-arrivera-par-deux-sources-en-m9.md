# 061 — Une même alerte arrivera par deux sources en M9

> **Porteur :** step-182

## Ce qu'elle coûte si elle dure

step-046 écrit `mo_floor_reached` depuis le flux (`billing_alert_stream`) ; la spec confie sa
détection à l'évaluateur sur source durable (§6.8, `bff_evaluator`). Les deux actifs, chaque
alerte s'écrira deux fois au centre et en toast. step-182 tranche : dédoublonner, ou retirer
l'écriture depuis le flux.
