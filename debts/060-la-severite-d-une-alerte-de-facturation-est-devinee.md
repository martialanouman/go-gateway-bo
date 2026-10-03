# 060 — La sévérité d'une alerte de facturation est devinée par le BFF

> **Porteur :** step-182

## Ce qu'elle coûte si elle dure

`BillingAlert` ne porte aucune sévérité (contrat Admin 6.10.0, `openapi-admin.yaml:3197`) : le BFF
écrit `warning` pour toute valeur d'`alert` (`cmd/dashboard/main.go`, `recordBillingAlert`). Juste
pour `mo_floor_reached`, qui ne bloque rien (spec passerelle §6.9 : « Le solde MO est un compteur
postpayé qui ne bloque rien »), mais la passerelle annonce d'autres alertes — solde MT bas,
disjoncteur ouvert (`openapi-admin.yaml:1850`) — qui arriveraient en `warning` jusqu'à un
déploiement du BFF. Correctif : une PR dans `go-gateway/api/` qui ajoute `severity` à
`BillingAlert`, puis un bump ici.
