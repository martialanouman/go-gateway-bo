# language: fr
Fonctionnalité: Configuration validée au démarrage
  Une installation incomplète se voit au démarrage, jamais à la première requête : un serveur qui
  démarre puis échoue laisse croire que l'installation est bonne.

  Scénario: une variable obligatoire absente empêche le démarrage
    Étant donné une configuration complète dont on retire "DASHBOARD_ADDR"
    Quand le serveur démarre
    Alors le serveur ne sert aucune requête
    Et le message d'erreur nomme "DASHBOARD_ADDR"
