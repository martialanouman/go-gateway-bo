# language: fr
Fonctionnalité: Arrêt sur SIGTERM
  Un déploiement roulant remplace les instances une par une. Celle qui s'en va rend la main d'elle-même :
  sans quoi l'orchestrateur la tue, et les opérateurs qu'elle servait voient une erreur qui n'appartient
  à aucune panne.

  Ce que ce scénario n'observe pas : le délai de grâce. L'exercer contre le binaire demanderait une
  requête lente, donc une route que le produit n'a pas. Les requêtes en vol terminées et le refus des
  connexions pendant l'arrêt sont prouvés par les tests de `serve`, sur le même code.

  Scénario: le serveur s'arrête de lui-même sur SIGTERM
    Étant donné un serveur démarré
    Quand le serveur reçoit SIGTERM
    Alors le serveur s'arrête sans erreur
