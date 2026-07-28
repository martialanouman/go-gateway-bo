# step-044 — HA : Redis Pub/Sub entre instances BFF

> **Jalon :** M2 (§4.1, §1.2) · **Statut :** À FAIRE
> **Dépend de :** step-043 · **Bloque :** step-186

## But
Rendre la cible de 99,9 % atteignable : plusieurs instances BFF, aucun SPOF, et une passerelle dont
le nombre d'abonnés WS ne croît pas avec le nombre d'instances.

## Périmètre (ce que fait CETTE PR)
- Élection : **une seule instance** consomme les trois flux amont à un instant donné (verrou Redis
  avec bail renouvelé), republie sur Redis Pub/Sub ; toutes les instances rediffusent à leurs clients.
- Bascule automatique à la perte du bail, sans trou d'abonnement perceptible.
- Compose local à deux instances derrière un proxy, pour reproduire la topologie en développement.

## Points d'implémentation clés
- **Le point du §4.1** : consommer une fois, republier, rediffuser. Une instance qui consomme pour
  son propre compte multiplie les abonnés côté passerelle — c'est le défaut à éviter.
- Le bail doit expirer plus vite que la tolérance de fraîcheur (2–5 s, §1.2) mais assez lentement
  pour ne pas osciller ; valeurs configurables et documentées.
- Redis Pub/Sub est **au mieux une fois** : acceptable pour des compteurs agrégés, **inacceptable**
  pour une détection d'alerte — d'où l'évaluateur sur source durable de la step-182.
- Pendant une bascule, l'UI signale la fraîcheur ; elle n'invente jamais une valeur.

## Tests (écrits dans la même PR)
- Deux instances, un seul consommateur amont ; tuer le porteur du bail bascule l'autre en < N s.
- Un client connecté à l'instance B reçoit les messages consommés par l'instance A.
- Aucun doublon durable de consommation pendant la bascule.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] scénario deux instances vérifié en test d'intégration

## Hors périmètre
Le déploiement réel et l'affinité WS au load balancer → step-186.
