# language: fr
Fonctionnalité: Le serveur sert sa sonde et s'arrête proprement

  La sonde de vivacité ne touche ni la base ni la passerelle : une sonde qui
  dépend de ses dépendances fait redémarrer un process sain dès que l'une d'elles
  tombe.

  Contexte:
    Étant donné un serveur démarré

  Scénario: la sonde de vivacité répond
    Quand "/api/health" est demandé
    Alors le statut de la réponse est 200
    Et le corps de la réponse est le JSON {"status":"ok"}
    Et le type de la réponse est "application/json"

  Scénario: une route inconnue sous /api n'est pas servie
    Quand "/api/inconnu" est demandé
    Alors le statut de la réponse est 404
    Et la réponse n'est pas du HTML

  Scénario: l'arrêt rend la main
    Quand le serveur reçoit l'ordre de s'arrêter
    Alors le serveur rend la main sans erreur
