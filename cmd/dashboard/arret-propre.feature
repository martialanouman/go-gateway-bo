# language: fr
Fonctionnalité: Arrêt propre
  Un déploiement roulant remplace les instances une par une. Celle qui s'en va rend la main d'elle-même
  et cesse de servir : sans quoi l'orchestrateur la tue, et les opérateurs qu'elle servait voient une
  erreur qui n'appartient à aucune panne.

  Scénario: le serveur s'arrête de lui-même sur SIGTERM
    Étant donné un serveur démarré
    Quand le serveur reçoit SIGTERM
    Alors le serveur s'arrête sans erreur
    Et il n'accepte plus aucune connexion
