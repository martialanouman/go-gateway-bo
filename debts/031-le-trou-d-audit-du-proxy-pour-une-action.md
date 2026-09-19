# 031 — Le **trou d'audit du proxy** : pour une action proxyfiée vers la passerelle, `Record` écrit **après** le succès, hors transaction commune

> **Porteur :** step-060

## Ce qu'elle coûte si elle dure

Une panne entre les deux perd la trace, et l'action reste faite. « M3 en héritera — le découvrir alors coûterait une passe. »
