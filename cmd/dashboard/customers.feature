# language: fr
Fonctionnalité: Les clients relayés depuis la passerelle
  La tranche verticale du plan : un opérateur voit les clients selon ses permissions, en crée un, et
  l'action laisse sa trace avant et après l'appel à la passerelle.

  Contexte:
    Étant donné une installation avec un opérateur

  Scénario: un opérateur qui détient customers:read voit une page de clients
    Étant donné une passerelle servie par le mock du contrat
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/customers?status=active&groupId=0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b"
    Alors le serveur répond 200
    Et la réponse est conforme au contrat du BFF

  Scénario: le filtre par groupe atteint la passerelle
    Étant donné une passerelle qui compte les requêtes reçues
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/customers?groupId=0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b"
    Alors la passerelle a reçu "groupId=0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b"

  Scénario: créer un client laisse sa trace, et l'issue désigne le client créé
    Étant donné une passerelle servie par le mock du contrat
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/customers" avec le corps '{"name":"Acme Télécom"}'
    Alors le serveur répond 201
    Et la réponse est conforme au contrat du BFF
    Et le journal porte 2 événement "customer.create"
    Et l'issue "customer.create" désigne le client que la réponse rend

  Scénario: sans customers:write, la création est refusée avant d'atteindre la passerelle
    Étant donné une passerelle qui compte les requêtes reçues
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/customers" avec le corps '{"name":"Acme Télécom"}'
    Alors le serveur répond 403
    Et le refus nomme la permission "customers:write"
    Et la passerelle n'a reçu aucune requête
