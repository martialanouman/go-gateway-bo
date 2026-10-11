# language: fr
Fonctionnalité: L'instantané du trafic
  Le tableau de bord relaie les compteurs et les séries de l'API Admin à qui détient traffic:read.

  Contexte:
    Étant donné une installation avec un opérateur
    Et une passerelle servie par le mock du contrat
    Et un serveur démarré

  Scénario: les compteurs des cinq dernières minutes sont relayés tels que le contrat les décrit
    Étant donné l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/metrics/summary?window=5m"
    Alors le serveur répond 200
    Et la réponse est conforme au contrat du BFF

  Scénario: les séries par client sont relayées telles que le contrat les décrit
    Étant donné l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/metrics/traffic?window=5m&groupBy=customer"
    Alors le serveur répond 200
    Et la réponse est conforme au contrat du BFF

  Scénario: sans traffic:read, le trafic est refusé et le refus nomme la clé
    Étant donné l'opérateur détient le rôle "Audit"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/metrics/summary"
    Alors le serveur répond 403
    Et la réponse porte 'traffic:read'
    Quand le navigateur demande "/api/metrics/traffic"
    Alors le serveur répond 403

  Scénario: une fenêtre que l'amont ne sert pas est refusée avant tout appel
    Étant donné l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/metrics/summary?window=24h"
    Alors le serveur répond 400
