# language: fr
Fonctionnalité: Configuration validée au démarrage

  Le serveur refuse de démarrer quand une variable obligatoire manque, et nomme
  celles qui manquent. La v1.0 démarrait puis levait à la première requête
  d'authentification : l'installation paraissait bonne jusqu'à ce qu'un opérateur
  s'y connecte.

  Scénario: une variable obligatoire absente empêche le démarrage
    Étant donné un environnement complet
    Et que "DASHBOARD_ADDR" est absent
    Quand la configuration est chargée
    Alors le chargement échoue
    Et le message dit que "DASHBOARD_ADDR" est obligatoire

  Scénario: une variable présente mais invalide est diagnostiquée autrement
    Étant donné un environnement complet
    Et que "DASHBOARD_ADDR" vaut ":99999"
    Quand la configuration est chargée
    Alors le chargement échoue
    Et le message nomme "DASHBOARD_ADDR"
    Et le message ne la dit pas obligatoire

  Scénario: un environnement complet est accepté
    Étant donné un environnement complet
    Quand la configuration est chargée
    Alors le chargement réussit
