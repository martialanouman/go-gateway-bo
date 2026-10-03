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

  Scénario: suspendre un client laisse sa trace sur ce client
    Étant donné une passerelle servie par le mock du contrat
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/customers/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b/suspend"
    Alors le serveur répond 200
    Et la réponse est conforme au contrat du BFF
    Et le journal porte 2 événement "customer.suspend"
    Et l'issue "customer.suspend" désigne le client "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b"

  Scénario: sans customers:write, la suspension est refusée avant d'atteindre la passerelle
    Étant donné une passerelle qui compte les requêtes reçues
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/customers/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b/suspend"
    Alors le serveur répond 403
    Et le refus nomme la permission "customers:write"
    Et la passerelle n'a reçu aucune requête

  Scénario: l'impact d'une suspension ne compte actifs que les comptes actifs
    Étant donné une passerelle dont le client a 3 comptes, dont 2 actifs et 1 fermé
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/customers/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b/suspension-impact"
    Alors le serveur répond 200
    Et la réponse est conforme au contrat du BFF
    Et la réponse compte 3 comptes, dont 2 actifs et 1 fermé

  Scénario: sans customers:write, l'enregistrement d'un nom d'expéditeur est refusé avant d'atteindre la passerelle
    Étant donné une passerelle qui compte les requêtes reçues
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/customers/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b/sender-ids" avec le corps '{"address":"ACME"}'
    Alors le serveur répond 403
    Et le refus nomme la permission "customers:write"
    Et la passerelle n'a reçu aucune requête

  Plan du scénario: un nom d'expéditeur <défaut> est refusé avant d'atteindre la passerelle
    Étant donné une passerelle qui compte les requêtes reçues
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/customers/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b/sender-ids" avec le corps '{"address":"<nom>"}'
    Alors le serveur répond 400
    Et la passerelle n'a reçu aucune requête

    Exemples:
      | défaut                | nom          |
      | d'un caractère        | A            |
      | de douze caractères   | ABCDEFGHIJKL |
      | à caractère interdit  | ACME!        |

  Scénario: un nom d'expéditeur déjà enregistré par ce client est refusé sous son champ
    Étant donné une passerelle qui répond 409 à l'enregistrement d'un sender ID
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/customers/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b/sender-ids" avec le corps '{"address":"ACME"}'
    Alors le serveur répond 409
    Et la réponse est conforme au contrat du BFF
    Et le refus place une erreur sous le champ "address"
    Et le journal porte 2 événement "sender_id.create"

  Plan du scénario: un opérateur customers:read lit <objet>
    Étant donné une passerelle servie par le mock du contrat
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "<adresse>"
    Alors le serveur répond 200
    Et la réponse est conforme au contrat du BFF

    Exemples:
      | objet                  | adresse                                                          |
      | la fiche d'un client   | /api/customers/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b              |
      | les sender IDs         | /api/customers/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b/sender-ids   |

  Plan du scénario: <geste> laisse sa trace
    Étant donné une passerelle servie par le mock du contrat
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie <méthode> "<adresse>" avec le corps '<corps>'
    Alors le serveur répond <statut>
    Et la réponse est conforme au contrat du BFF
    Et le journal porte 2 événement "<action>"

    Exemples:
      | geste                        | méthode | adresse                                                                                              | corps                                               | statut | action              |
      | renommer un client           | PATCH   | /api/customers/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b                                                  | {"name":"Acme"}                                     | 200    | customer.update     |
      | affecter un client           | PUT     | /api/customers/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b/group                                            | {"groupId":"0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7c"}  | 200    | customer.group      |
      | réactiver un client          | POST    | /api/customers/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b/reactivate                                       |                                                     | 200    | customer.reactivate |
      | approuver un sender ID       | PATCH   | /api/customers/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b/sender-ids/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7d  | {"status":"active"}                                 | 200    | sender_id.update    |
      | supprimer un sender ID       | DELETE  | /api/customers/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b/sender-ids/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7d  |                                                     | 204    | sender_id.delete    |

  Scénario: détacher un client de son groupe envoie un groupe nul, pas un champ absent
    Étant donné une passerelle qui compte les requêtes reçues
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie PUT "/api/customers/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b/group" avec le corps '{}'
    Alors la passerelle a reçu un détachement de groupe

  Scénario: un opérateur accounts:read voit les comptes d'un client
    Étant donné une passerelle servie par le mock du contrat
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/accounts?customerId=0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b&status=active"
    Alors le serveur répond 200
    Et la réponse est conforme au contrat du BFF

  Scénario: le filtre par client atteint la passerelle
    Étant donné une passerelle qui compte les requêtes reçues
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/accounts?customerId=0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b"
    Alors la passerelle a reçu "customerId=0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b"

  Scénario: créer un compte laisse sa trace, et l'issue désigne le compte créé
    Étant donné une passerelle servie par le mock du contrat
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/accounts" avec le corps '{"customerId":"0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b","name":"trafic-otp"}'
    Alors le serveur répond 201
    Et la réponse est conforme au contrat du BFF
    Et le journal porte 2 événement "account.create"
    Et l'issue "account.create" désigne le compte que la réponse rend

  Scénario: sans accounts:write, la création d'un compte est refusée avant d'atteindre la passerelle
    Étant donné une passerelle qui compte les requêtes reçues
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/accounts" avec le corps '{"customerId":"0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b","name":"trafic-otp"}'
    Alors le serveur répond 403
    Et le refus nomme la permission "accounts:write"
    Et la passerelle n'a reçu aucune requête

  Scénario: un nom de compte déjà pris chez ce client est refusé sous son champ
    Étant donné une passerelle qui répond 409 à la création
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/accounts" avec le corps '{"customerId":"0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b","name":"trafic-otp"}'
    Alors le serveur répond 409
    Et la réponse est conforme au contrat du BFF
    Et le refus place une erreur sous le champ "name"
