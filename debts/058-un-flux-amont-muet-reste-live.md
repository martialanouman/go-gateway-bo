# 058 — Un flux amont devenu muet reste annoncé `live`

> **Porteur :** step-044

## Ce qu'elle coûte si elle dure

`internal/hub/upstream.go` lit chaque flux sans échéance. Si la passerelle disparaît sans fermer la
connexion (partition réseau, load balancer qui avale les paquets), `Read` reste bloqué : le sujet
reste `live` et l'écran montre des chiffres figés comme s'ils étaient frais. C'est l'inverse de ce
que l'invariant (e) demande. Seul le keepalive TCP du dialer finit par couper, après plusieurs
minutes. Relevé en revue le 26/09/2026, non mesuré.

La passerelle envoie un ping toutes les 20 s (`go-gateway/internal/adminapi/stream.go`,
`streamPingInterval`). Le paiement : une échéance réarmée à chaque trame et à chaque ping
(`DialOptions.OnPingReceived`), qui ferme la connexion et rend le sujet `stale`. Une trame d'une
version inconnue (`v`) laisse elle aussi le sujet `live` sans données : le même mécanisme doit la
compter comme un silence. step-044 la porte, parce qu'elle reprend ce consommateur.
