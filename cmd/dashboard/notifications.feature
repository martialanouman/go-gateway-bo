# language: fr
Fonctionnalité: Le centre de notifications
  Une alerte de facturation consommée par le porteur du bail est écrite, puis rendue à chaque
  opérateur qui détient la permission de sa source. Chacun la lit pour lui-même.

  Contexte:
    Étant donné une installation avec un opérateur
    Et une passerelle qui diffuse ses trois flux
    Et un serveur démarré

  Scénario: une alerte de facturation apparaît au centre de qui détient billing:read
    Étant donné l'opérateur détient le rôle "Reporting"
    Et l'opérateur ouvre une session élevée
    Et la socket est ouverte
    Et l'opérateur s'abonne à "notifications"
    Et le sujet "notifications" est annoncé "live"
    Quand la passerelle émet une alerte de facturation
    Alors la socket reçoit une notification de facturation
    Et le centre de l'opérateur compte 1 notification non lue
    Et la réponse est conforme au contrat du BFF

  Scénario: sans billing:read, l'alerte n'arrive ni sur la socket ni au centre
    Étant donné l'opérateur détient le rôle "Audit"
    Et l'opérateur ouvre une session élevée
    Et la socket est ouverte
    Et l'opérateur s'abonne à "notifications"
    Et le sujet "notifications" est annoncé "live"
    Quand la passerelle émet une alerte de facturation
    Alors aucune trame "notifications" n'arrive
    Et le centre de l'opérateur compte 0 notification non lue

  Scénario: marquée lue par un opérateur, elle reste non lue pour un autre
    Étant donné une notification de facturation déjà écrite
    Et un second opérateur détenant le rôle "Finance"
    Et l'opérateur détient le rôle "Reporting"
    Et l'opérateur ouvre une session élevée
    Quand l'opérateur marque la notification lue
    Alors le serveur répond 204
    Et le journal d'audit porte "notification.read" sur cette notification
    Et le centre de l'opérateur compte 0 notification non lue
    Et le centre du second opérateur compte 1 notification non lue

  Scénario: marquer une notification invisible répond comme si elle n'existait pas
    Étant donné une notification de facturation déjà écrite
    Et l'opérateur détient le rôle "Audit"
    Et l'opérateur ouvre une session élevée
    Quand l'opérateur marque la notification lue
    Alors le serveur répond 404
    Et la réponse est conforme au contrat du BFF
    Quand l'opérateur marque lue une notification qui n'existe pas
    Alors le serveur répond 404
    Et les deux refus sont indiscernables

  Scénario: sans second facteur, le centre est refusé
    Étant donné l'opérateur détient le rôle "Reporting"
    Et l'opérateur se connecte avec son mot de passe
    Quand le navigateur demande "/api/notifications"
    Alors le serveur répond 403
    Et la réponse est conforme au contrat du BFF

  Scénario: sans session, le centre est refusé
    Quand le navigateur demande "/api/notifications"
    Alors le serveur répond 401
    Et la réponse est conforme au contrat du BFF
