# language: fr
Fonctionnalité: Le temps réel, une socket par opérateur
  Le serveur consomme les trois flux de la passerelle et les ré-émet par sujet sur une seule socket,
  en ne livrant à chacune que les sujets que ses permissions ouvrent. Côté passerelle, c'est un faux
  serveur WebSocket du harnais : le mock Prism ne sert pas de WebSocket, et c'est la seule frontière
  simulée.

  `/ws` n'est pas une opération du contrat : une montée de protocole n'a pas de réponse que le serveur
  strict saurait typer. Le contrat en décrit les messages, et chaque message reçu ici est validé
  contre eux, comme chaque refus contre `Error`.

  Contexte:
    Étant donné une installation avec un opérateur
    Et une passerelle qui diffuse ses trois flux
    Et un serveur démarré

  Scénario: sans session, la socket est refusée avant de s'ouvrir
    Quand le navigateur ouvre la socket
    Alors le serveur répond 401
    Et le refus a la forme d'erreur du contrat

  Scénario: une socket demandée depuis une autre origine est refusée
    Étant donné l'opérateur détient le rôle "Exploitation"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur ouvre la socket depuis l'origine "https://voisin.exemple.test"
    Alors le serveur répond 403
    Et le refus a la forme d'erreur du contrat

  Scénario: une session sans second facteur n'ouvre pas la socket
    Étant donné l'opérateur se connecte avec son mot de passe
    Quand le navigateur ouvre la socket
    Alors le serveur répond 403
    Et le refus a la forme d'erreur du contrat

  Scénario: un sujet permis livre ce que la passerelle émet
    Étant donné l'opérateur détient le rôle "Exploitation"
    Et l'opérateur ouvre une session élevée
    Et la socket est ouverte
    Quand l'opérateur s'abonne à "sessions.events"
    Alors le sujet "sessions.events" est annoncé "live"
    Quand la passerelle émet un événement de session
    Alors la socket reçoit cet événement sur "sessions.events"

  Scénario: un sujet que les permissions n'ouvrent pas est refusé, et le refus nomme la clé
    Étant donné l'opérateur détient le rôle "Audit"
    Et l'opérateur ouvre une session élevée
    Et la socket est ouverte
    Quand l'opérateur s'abonne à "billing.alerts"
    Alors la socket refuse "billing.alerts" en nommant "billing:read"
    Quand la passerelle émet une alerte de facturation
    Alors aucune trame "billing.alerts" n'arrive

  # Invariant (e) : une panne en amont dégrade l'affichage d'un sujet, sans vider les autres.
  Scénario: la chute d'un flux rend son sujet périmé sans toucher aux autres
    Étant donné l'opérateur détient le rôle "Exploitation"
    Et l'opérateur ouvre une session élevée
    Et la socket est ouverte
    Et l'opérateur s'abonne à "sessions.events"
    Et le sujet "sessions.events" est annoncé "live"
    Et l'opérateur s'abonne à "metrics.traffic"
    Et le sujet "metrics.traffic" est annoncé "live"
    Quand la passerelle coupe le flux des sessions
    Alors le sujet "sessions.events" est annoncé "stale"
    Quand la passerelle émet un instantané de métriques
    Alors la socket reçoit cet instantané sur "metrics.traffic"
    Quand la passerelle rouvre le flux des sessions
    Alors le sujet "sessions.events" est annoncé "live"
