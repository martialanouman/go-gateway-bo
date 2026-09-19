# 022 — Le pool est détaché du contexte d'arrêt, et **sa fermeture non plus n'est gardée**

> **Porteur :** step-047

## Ce qu'elle coûte si elle dure

« Aucune porte, faute d'une requête assez lente pour traverser `SIGTERM` » : ce que la ligne change — une déconnexion annoncée plutôt que découverte — n'est visible d'aucun test du dépôt, et retirer la fermeture laisse tout vert parce que le processus s'arrête juste après.
