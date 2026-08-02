# language: fr
Fonctionnalité: Configuration validée au démarrage
  Une installation incomplète se voit au démarrage, jamais à la première requête : un serveur qui
  démarre puis échoue laisse croire que l'installation est bonne.

  Scénario: une variable obligatoire absente empêche le démarrage
    Étant donné une configuration complète dont on retire "DASHBOARD_ADDR"
    Quand le serveur démarre
    Alors le serveur refuse de démarrer
    Et le message d'erreur nomme "DASHBOARD_ADDR"

  # La passerelle réelle est le défaut : c'est l'installation qui croit être en production, mais à
  # qui personne n'a donné de quoi s'authentifier, qui doit s'arrêter là plutôt qu'au premier écran.
  Scénario: la passerelle réelle sans identifiants empêche le démarrage
    Étant donné une configuration complète dont on passe "DASHBOARD_GATEWAY_MODE" à "real"
    Quand le serveur démarre
    Alors le serveur refuse de démarrer
    Et le message d'erreur nomme "DASHBOARD_GATEWAY_CLIENT_ID"
    Et le message d'erreur nomme "DASHBOARD_GATEWAY_CA_CERT"
