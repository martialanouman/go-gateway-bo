# language: fr
Fonctionnalité: Le binaire refuse de servir sur un schéma en retard
  Un déploiement roulant remplace les instances une par une, et rien ne garantit que les migrations
  ont été jouées avant. Une instance qui servirait sur un schéma en retard échouerait à l'exécution,
  sur des colonnes absentes — c'est-à-dire au premier écran, avec une erreur de forme inconnue.

  Le refus arrive avant que le port ne soit lié : une instance déjà à l'écoute est déjà dans le pool
  du load balancer, le temps d'un aller-retour de sonde.

  Ce que ces scénarios n'observent pas : un schéma **en avance**, qui est accepté délibérément (une
  instance en cours de remplacement voit le schéma que sa remplaçante vient de poser). L'exercer ici
  demanderait un binaire d'une autre version ; la comparaison elle-même est tenue par
  `internal/store`.

  Scénario: un schéma en retard d'une migration empêche le serveur de servir
    Étant donné une base dont le schéma est en retard d'une migration
    Quand le serveur démarre
    Alors le serveur refuse de démarrer
    Et le message d'erreur nomme la version trouvée et la version attendue

  Scénario: une base qu'aucune migration n'a touchée empêche le serveur de servir
    Étant donné une base vierge
    Quand le serveur démarre
    Alors le serveur refuse de démarrer
    Et le message d'erreur nomme la version trouvée et la version attendue

  # L'ordre du démarrage, observé par le seul moyen qui le rende visible de l'extérieur : on occupe
  # d'avance l'adresse d'écoute. Le serveur a deux raisons de refuser, et celle qu'il nomme dit
  # laquelle des deux il a examinée en premier.
  Scénario: le schéma est contrôlé avant que le port ne soit lié
    Étant donné une base vierge
    Et l'adresse d'écoute déjà occupée
    Quand le serveur démarre
    Alors le serveur refuse de démarrer
    Et le message d'erreur parle du schéma et non de l'adresse
