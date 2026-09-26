# 057 — Le contrat ne décrit pas les trames des trois flux temps réel

> **Porteur :** step-044

## Ce qu'elle coûte si elle dure

`internal/hub/frames.go` décode les trames de `stream-metrics`, `stream-sessions` et
`stream-billing-alerts` avec des structs recopiés de `go-gateway/internal/metricstream/metricstream.go`.
Le contrat Admin ne décrit ces trames que dans une phrase de `description`, en 4.0.2 comme en 6.8.0,
la dernière version publiée (relevé le 26/09/2026). Si un champ amont est renommé, aucune porte ne le
voit : le champ arrive vide, et seul un changement de `v` est refusé.

La paie : une PR dans `go-gateway/api/` qui déclare `Snapshot`, `SessionEvent` et `BillingAlert` en
`components`, puis un bump ici, et un test qui confronte les structs de `frames.go` à ces schémas.
step-044 la porte parce qu'elle reprend ce consommateur pour le placer sous bail Redis : c'est la
prochaine step qui touche au décodage.
