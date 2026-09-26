# step-044 — HA : bail Redis + Pub/Sub entre instances, bascule automatique

> **Jalon :** M2 (§4.1, §4.2, §5.2) · **Statut :** À FAIRE
> **Dépend de :** step-043 · **Bloque :** step-045

## But
Avec deux instances, chacune consomme aujourd'hui les trois flux amont : la passerelle voit autant
d'abonnés que d'instances, et une socket ne reçoit que ce que son instance consomme. Désormais, une
seule instance, celle qui détient un bail Redis, consomme la passerelle et republie en Pub/Sub, et
chaque instance rediffuse ce qu'elle lit sur Redis. Si le porteur du bail meurt, une autre prend le
relais sans intervention.

## Décisions (arbitrées, ne pas rouvrir)
- **Un seul chemin.** Chaque instance, porteur du bail compris, ne diffuse que ce qu'elle lit sur
  Redis. Redis injoignable : tous les sujets passent `stale`, jusqu'à son retour. Il n'y a pas de repli
  sur une consommation directe, et la passerelle ne voit jamais plus d'un abonné. *Arbitré le
  26/09/2026 avec l'utilisateur.*
- **Redis n'empêche pas le démarrage.** `DASHBOARD_REDIS_URL` est obligatoire et validée en forme au
  démarrage (`redis://` ou `rediss://`), mais un Redis injoignable ne bloque pas le binaire : login et
  écrans restent servis, et seul le temps réel se dégrade (invariant e). C'est l'inverse de PostgreSQL,
  sans lequel rien ne fonctionne.
- **Le bail** : clé `dashboard:realtime:leader`, valeur = identifiant aléatoire de l'instance,
  `SET NX PX 6000`. Le porteur le renouvelle toutes les 2 s, par un script Lua qui compare avant de
  prolonger. Les autres tentent de le prendre toutes les 2 s. Un renouvellement refusé ou en échec
  arrête aussitôt les consommateurs amont. À l'arrêt propre, le porteur rend le bail, par un script
  Lua qui compare avant de supprimer, et un autre le reprend dans les 2 s. Si le porteur est tué, la
  reprise prend au plus 6 s + 2 s.
- **Le canal** : `dashboard:realtime`. Il transporte les messages déjà sérialisés par les DTO de
  step-043 (trames et états), et rien d'autre : aucun octet amont brut n'y passe.
- **Battement de cœur** : le porteur publie `{"heartbeat":…}` toutes les 2 s. Une instance qui n'en a
  lu aucun depuis 6 s (porteur mort, Redis coupé, abonnement rompu) passe tous ses sujets `stale`.
  C'est ce qui rend visible le trou d'une bascule, au lieu d'afficher `live` sur des chiffres figés.
- **Dette 058 payée ici.** Côté porteur, chaque flux amont a une échéance de 60 s, réarmée à chaque
  trame et à chaque ping de la passerelle (`OnPingReceived`, ping toutes les 20 s). Si elle expire, la
  connexion est fermée et le sujet passe `stale`. Une trame de version inconnue ne réarme pas
  l'échéance, et son journal n'est émis qu'une fois par connexion.
- **Au mieux une fois.** Redis Pub/Sub perd ce qui passe pendant une coupure. C'est acceptable pour
  de l'affichage, jamais pour une détection (§1.6).

## Périmètre (ce que fait CETTE PR)
- **Contrat** : 6.8.0, installé le 26/09/2026 (PR #110). Aucun changement des trois `stream-*`
  depuis. La dette 057 (trames non décrites) ne se paie pas ici : elle attend une PR dans
  `go-gateway/api/`, et son porteur passe à step-045.
- **`internal/hub`** : le bail (`lease.go`), la republication et l'abonnement (`relay.go`), le battement
  de cœur, et l'échéance amont de la dette 058. `Hub.Run` prend un client Redis et l'identifiant
  d'instance.
- **Configuration** : `DASHBOARD_REDIS_URL`, posée aussi dans `.env.example`, la CI (Go et e2e) et
  `playwright.config.ts`. Le service `redis` revient dans `docker-compose.yml` en `redis:8-alpine`, l'image qu'il
  avait avant son retrait (step-037), et la CI prend la même.
- **Dépendances** : `github.com/redis/go-redis/v9` v9.22.0, et en test
  `github.com/testcontainers/testcontainers-go/modules/redis` v0.44.0. Versions relevées sur
  `proxy.golang.org`, sans avis OSV, le 26/09/2026.
- **Tests Redis** : `DASHBOARD_TEST_REDIS_URL` désigne un Redis partagé (service de la CI, ou
  `docker compose` en local) ; sans elle, un conteneur est monté. Même forme que PostgreSQL
  (`internal/bddtest`).

## Tests (écrits dans la même PR)
- **godog** (`cmd/dashboard/haute-disponibilite.feature`, deux binaires, un Redis, un PostgreSQL, le
  faux amont de step-043) :
  - deux instances, **une seule** connexion par flux sur le faux amont ;
  - une socket ouverte sur l'instance qui ne porte pas le bail reçoit ce que la passerelle émet ;
  - le porteur est tué (SIGKILL) : les sujets passent `stale`, l'autre instance prend le bail, le faux
    amont voit une nouvelle connexion, les sujets repassent `live` et les trames reprennent ;
  - Redis arrêté : les sujets passent `stale`.
- **Go** : bail — deux candidats, un seul porteur ; renouvellement refusé quand la valeur a changé ;
  restitution qui ne supprime pas le bail d'un autre. Battement de cœur manqué → `stale`. Flux amont
  muet → `stale` après l'échéance (le ping la réarme). Fuite : les goroutines du bail et de
  l'abonnement s'arrêtent à l'annulation.
- **Mutations** : comparaison avant renouvellement, comparaison avant restitution, arrêt des
  consommateurs sur perte du bail, battement de cœur, réarmement par ping, `stale` sur Redis coupé.

## Definition of Done
- [ ] `make check` vert, et le scénario deux instances rejoué **en CI** (checkpoint M2).
- [ ] Aucun octet amont brut sur le canal Redis, vérifié sur le livré.

## Hors périmètre
- Drain des sockets et déploiement roulant → step-047. Client React → step-045. Notifications →
  step-046.
- Rejouer ce qui a été perdu pendant une bascule : Pub/Sub est au mieux une fois, par décision.
