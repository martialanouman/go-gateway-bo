# language: fr
Fonctionnalité: Configuration validée au démarrage
  Une installation incomplète se voit au démarrage, jamais à la première requête : un serveur qui
  démarre puis échoue laisse croire que l'installation est bonne.

  Scénario: une variable obligatoire absente empêche le démarrage
    Étant donné une configuration complète dont on retire "DASHBOARD_ADDR"
    Quand le serveur démarre
    Alors le serveur refuse de démarrer
    Et le message d'erreur nomme "DASHBOARD_ADDR"

  # Le DSN est refusé sur sa **forme**, avant même qu'on tente de joindre quoi que ce soit : c'est
  # `internal/config` qui l'analyse, et le message nomme la variable plutôt que la valeur, qui porte
  # le mot de passe. Depuis step-020, un DSN bien formé mais dont la base ne répond pas ou porte un
  # schéma en retard arrête aussi le démarrage — c'est `schema.feature` qui le décrit.
  Scénario: un DSN de base mal formé empêche le démarrage
    Étant donné une configuration complète dont on passe "DASHBOARD_DATABASE_URL" à "pas-un-dsn"
    Quand le serveur démarre
    Alors le serveur refuse de démarrer
    Et le message d'erreur nomme "DASHBOARD_DATABASE_URL"

  # La passerelle réelle est le défaut : c'est l'installation qui croit être en production, mais à
  # qui personne n'a donné de quoi s'authentifier, qui doit s'arrêter là plutôt qu'au premier écran.
  Scénario: la passerelle réelle sans identifiants empêche le démarrage
    Étant donné une configuration complète dont on passe "DASHBOARD_GATEWAY_MODE" à "real"
    Quand le serveur démarre
    Alors le serveur refuse de démarrer
    Et le message d'erreur nomme "DASHBOARD_GATEWAY_CLIENT_ID"
    Et le message d'erreur nomme "DASHBOARD_GATEWAY_CA_CERT"

  # Une passkey est liée à un **domaine**, et une adresse IP n'en est pas un : le navigateur refuserait
  # la cérémonie, et la bibliothèque refuse la configuration. Ce refus-là est le seul de ce fichier qui
  # ne vienne pas d'`internal/config` — il vient de `webauthn.New`.
  #
  # Ce que ce scénario garde : que le domaine vient bien de la configuration et qu'un domaine
  # inutilisable arrête le démarrage. Ce qu'il **ne garde pas** : que le refus arrive *avant* la
  # liaison du port. Mesuré — la construction déplacée après `net.Listen`, il reste vert, parce qu'il
  # observe la sortie du process et non son écoute. L'ordre est tenu par le commentaire de
  # `cmd/dashboard/main.go` et par rien d'autre.
  Scénario: un domaine de clé d'accès qui est une adresse IP empêche le démarrage
    Étant donné une configuration complète dont on passe "DASHBOARD_WEBAUTHN_RP_ID" à "127.0.0.1"
    Quand le serveur démarre
    Alors le serveur refuse de démarrer
    Et le message d'erreur nomme "RPID"
