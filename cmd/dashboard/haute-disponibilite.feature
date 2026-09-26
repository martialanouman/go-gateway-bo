# language: fr
Fonctionnalité: Plusieurs instances, un seul consommateur de la passerelle
  Seule l'instance qui porte le bail Redis consomme les trois flux de la passerelle ; elle republie
  sur Redis, et chaque instance rediffuse ce qu'elle y lit. Tuer le porteur fait passer les sujets
  périmés, puis l'autre instance prend le bail et les rend vivants. Deux binaires, un PostgreSQL, un
  Redis joint à travers un relais que le harnais sait couper, et le faux amont de `temps-reel.feature`.

  Contexte:
    Étant donné une installation avec un opérateur
    Et l'opérateur détient le rôle "Exploitation"
    Et une passerelle qui diffuse ses trois flux
    Et deux instances démarrées, la première portant le bail
    Et l'opérateur ouvre une session élevée
    Et la socket est ouverte sur la seconde instance
    Et l'opérateur s'abonne à "sessions.events"
    Et le sujet "sessions.events" est annoncé "live"

  Scénario: l'instance sans bail rediffuse ce que la passerelle émet, sur une seule connexion
    Quand la passerelle émet un événement de session
    Alors la socket reçoit cet événement sur "sessions.events"
    Et la passerelle compte 1 connexion sur le flux des sessions

  Scénario: le porteur du bail tué, l'autre instance reprend la passerelle
    Quand la première instance est tuée
    Alors le sujet "sessions.events" est annoncé "stale"
    Et le sujet "sessions.events" est annoncé "live"
    Et la passerelle compte 2 connexions sur le flux des sessions
    Quand la passerelle émet un événement de session
    Alors la socket reçoit cet événement sur "sessions.events"

  # Arrêt propre : le bail est rendu, et l'autre instance n'attend pas son expiration (6 à 8 s).
  Scénario: le porteur du bail arrêté proprement, l'autre instance reprend aussitôt
    Quand la première instance reçoit SIGTERM
    Alors la passerelle compte 2 connexions sur le flux des sessions en moins de 4 secondes

  Scénario: Redis coupé, les sujets passent périmés
    Quand Redis devient injoignable
    Alors le sujet "sessions.events" est annoncé "stale"
