# language: fr
Fonctionnalité: Les identifiants d'un compte SMPP
  Un compte a un identifiant de bind SMPP et une clé API. Leur secret est engendré par la passerelle
  et n'est montré qu'une fois, à la création ou à la rotation (invariant b) : ni le journal ni aucune
  autre réponse ne le portent.

  Contexte:
    Étant donné une installation avec un opérateur

  Scénario: un opérateur credentials:read lit les identifiants d'un compte
    Étant donné une passerelle servie par le mock du contrat
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/credentials"
    Alors le serveur répond 200
    Et la réponse est conforme au contrat du BFF

  Scénario: créer un identifiant SMPP rend le secret de la passerelle, que le journal ignore
    Étant donné une passerelle qui crée un identifiant
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/credentials" avec le corps '{"type":"smpp_bind","systemId":"acme01"}'
    Alors le serveur répond 201
    Et la réponse est conforme au contrat du BFF
    Et la passerelle a reçu '"system_id":"acme01"'
    Et la réponse rend le secret que la passerelle a engendré
    Et le journal ne porte pas le secret que la réponse rend
    Et le journal porte 2 événement "credential.create"
    Et l'issue "credential.create" porte '"system_id": "acme01"'

  Scénario: faire tourner un identifiant relaie la fenêtre de grâce et rend le nouveau secret, que le journal ignore
    Étant donné une passerelle qui crée un identifiant
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/credentials/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a80/rotate" avec le corps '{"gracePeriodSec":86400}'
    Alors le serveur répond 200
    Et la réponse est conforme au contrat du BFF
    Et la passerelle a reçu '"grace_period_sec":86400'
    Et la réponse rend le secret que la passerelle a engendré
    Et le journal ne porte pas le secret que la réponse rend
    Et le journal porte 2 événement "credential.rotate"
    Et l'issue "credential.rotate" porte '"grace_period_sec": 86400'

  Scénario: révoquer un identifiant laisse sa trace
    Étant donné une passerelle servie par le mock du contrat
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie DELETE "/api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/credentials/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a80"
    Alors le serveur répond 204
    Et le journal porte 2 événement "credential.revoke"
    Et l'issue "credential.revoke" porte '"account_id": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e"'

  Plan du scénario: un conflit à la création se place sous son champ et dit quoi faire, <cas>
    Étant donné une passerelle qui répond 409 à la création d'un identifiant
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/credentials" avec le corps '<corps>'
    Alors le serveur répond 409
    Et la réponse est conforme au contrat du BFF
    Et le refus place une erreur sous le champ "<champ>"
    Et le refus dit "<consigne>"

    Exemples:
      | cas                                                | corps                                     | champ    | consigne                    |
      | la clé API ne peut être que déjà là                | {"type":"api_key"}                        | type     | faites-la tourner           |
      | le system_id peut aussi être pris par un autre compte | {"type":"smpp_bind","systemId":"acme01"} | systemId | choisissez un autre system_id |

  Scénario: sans credentials:read, la lecture des identifiants est refusée avant d'atteindre la passerelle
    Étant donné une passerelle qui compte les requêtes reçues
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/credentials"
    Alors le serveur répond 403
    Et le refus nomme la permission "credentials:read"
    Et la passerelle n'a reçu aucune requête

  Plan du scénario: sans credentials:write, <geste> est refusée avant d'atteindre la passerelle
    Étant donné une passerelle qui compte les requêtes reçues
    Et un serveur démarré
    Et l'opérateur ne détient plus que le rôle personnalisé "Rotation seule" accordant "accounts:read credentials:read credentials:rotate"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie <méthode> "<adresse>" avec le corps '<corps>'
    Alors le serveur répond 403
    Et le refus nomme la permission "credentials:write"
    Et la passerelle n'a reçu aucune requête

    Exemples:
      | geste                        | méthode | adresse                                                                                             | corps                |
      | la création d'un identifiant | POST    | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/credentials                                      | {"type":"api_key"}   |
      | la révocation d'un identifiant | DELETE | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/credentials/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a80 |                      |

  Scénario: sans credentials:rotate, la rotation est refusée avant d'atteindre la passerelle, même avec credentials:write
    Étant donné une passerelle qui compte les requêtes reçues
    Et un serveur démarré
    Et l'opérateur ne détient plus que le rôle personnalisé "Écriture sans rotation" accordant "accounts:read credentials:read credentials:write"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/credentials/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a80/rotate" avec le corps '{}'
    Alors le serveur répond 403
    Et le refus nomme la permission "credentials:rotate"
    Et la passerelle n'a reçu aucune requête
