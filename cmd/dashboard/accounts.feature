# language: fr
Fonctionnalité: La fiche d'un compte SMPP
  Un opérateur lit un compte, règle ses canaux et ses opérations SMPP, et gère ses webhooks. Le secret
  de signature d'un webhook n'est montré qu'une fois, à la création ou à la rotation (invariant b).

  Contexte:
    Étant donné une installation avec un opérateur

  Plan du scénario: un opérateur accounts:read lit <objet>
    Étant donné une passerelle servie par le mock du contrat
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "<adresse>"
    Alors le serveur répond 200
    Et la réponse est conforme au contrat du BFF

    Exemples:
      | objet                 | adresse                                                       |
      | la fiche d'un compte  | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e            |
      | ses webhooks          | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/webhooks   |
      | ses binds ouverts     | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/sessions   |

  Scénario: la fiche d'un compte ne dit rien de la politique de sender ID
    Étant donné une passerelle servie par le mock du contrat
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e"
    Alors le serveur répond 200
    Et la réponse ne porte pas "senderIdPolicy"

  Scénario: les binds ouverts se comptent comme la passerelle les compte, pas à la longueur de leur liste
    Étant donné une passerelle qui compte 8 binds ouverts pour une limite de 4, sans en lister aucun
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/sessions"
    Alors le serveur répond 200
    Et la réponse est conforme au contrat du BFF
    Et la réponse compte 8 binds ouverts pour une limite de 4

  Plan du scénario: <geste> atteint la passerelle
    Étant donné une passerelle qui compte les requêtes reçues
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie PUT "/api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/<route>" avec le corps '<corps>'
    Alors la passerelle a reçu '<relayé>'

    Exemples:
      | geste               | route    | corps                                           | relayé                                          |
      | couper REST         | channels | {"smppEnabled":true,"restEnabled":false}        | "rest_enabled":false                            |
      | refuser cancel_sm   | smpp-ops | {"querySmEnabled":true,"cancelSmEnabled":false} | "cancel_sm_enabled":false                       |
      | abaisser la limite  | session-limits | {"maxSessions":2,"allowedBindTypes":"trx"} | {"allowed_bind_types":"trx","max_sessions":2}   |

  Scénario: couper le dernier canal est refusé en des termes qui disent quoi faire
    Étant donné une passerelle qui refuse les canaux sur le champ "smpp_enabled"
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie PUT "/api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/channels" avec le corps '{"smppEnabled":false,"restEnabled":false}'
    Alors le serveur répond 422
    Et la réponse est conforme au contrat du BFF
    Et le refus dit "au moins un canal"

  Plan du scénario: <geste> laisse sa trace
    Étant donné une passerelle servie par le mock du contrat
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie <méthode> "<adresse>" avec le corps '<corps>'
    Alors le serveur répond <statut>
    Et la réponse est conforme au contrat du BFF
    Et le journal porte 2 événement "<action>"
    Et l'issue "<action>" porte '<trace>'

    Exemples:
      | geste                     | méthode | adresse                                                                                                  | corps                                            | statut | action                | trace                         |
      | régler les canaux         | PUT     | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/channels                                              | {"smppEnabled":true,"restEnabled":false}         | 200    | account.channels      | "rest_enabled": false         |
      | régler les opérations     | PUT     | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/smpp-ops                                              | {"querySmEnabled":true,"cancelSmEnabled":false}  | 200    | account.smpp_ops      | "cancel_sm_enabled": false    |
      | régler les sessions       | PUT     | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/session-limits                                        | {"maxSessions":2,"allowedBindTypes":"tx"}        | 200    | account.session_limits | "max_sessions": 2, "allowed_bind_types": "tx" |
      | désactiver un webhook     | PATCH   | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/webhooks/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7f         | {"status":"disabled"}                            | 200    | webhook.update        | "status": "disabled"          |
      | supprimer un webhook      | DELETE  | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/webhooks/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7f         |                                                  | 204    | webhook.delete        | "account_id": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e" |

  Scénario: créer un webhook rend un secret que la passerelle a reçu, et que le journal ignore
    Étant donné une passerelle qui crée un webhook
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/webhooks" avec le corps '{"eventType":"dlr","url":"https://client.example/dlr"}'
    Alors le serveur répond 201
    Et la réponse est conforme au contrat du BFF
    Et la passerelle a reçu le secret que la réponse rend
    Et le journal ne porte pas le secret que la réponse rend
    Et le journal porte 2 événement "webhook.create"

  Scénario: faire tourner le secret d'un webhook en rend un nouveau, que la passerelle a reçu
    Étant donné une passerelle qui crée un webhook
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/webhooks/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7f/secret"
    Alors le serveur répond 200
    Et la réponse est conforme au contrat du BFF
    Et la passerelle a reçu le secret que la réponse rend
    Et le journal ne porte pas le secret que la réponse rend
    Et le journal porte 2 événement "webhook.rotate_secret"

  Scénario: un type d'événement qui a déjà son webhook est refusé sous son champ
    Étant donné une passerelle qui répond 409 à la création d'un webhook
    Et un serveur démarré
    Et l'opérateur détient le rôle "Clientèle"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/webhooks" avec le corps '{"eventType":"mo","url":"https://client.example/mo"}'
    Alors le serveur répond 409
    Et la réponse est conforme au contrat du BFF
    Et le refus place une erreur sous le champ "eventType"

  Plan du scénario: sans accounts:read, <objet> est refusé avant d'atteindre la passerelle
    Étant donné une passerelle qui compte les requêtes reçues
    Et un serveur démarré
    Et l'opérateur détient le rôle "Reporting"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "<adresse>"
    Alors le serveur répond 403
    Et le refus nomme la permission "accounts:read"
    Et la passerelle n'a reçu aucune requête

    Exemples:
      | objet                 | adresse                                                       |
      | la fiche d'un compte  | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e            |
      | ses webhooks          | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/webhooks   |
      | ses binds ouverts     | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/sessions   |

  Plan du scénario: sans accounts:write, <geste> est refusé avant d'atteindre la passerelle
    Étant donné une passerelle qui compte les requêtes reçues
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie <méthode> "<adresse>" avec le corps '<corps>'
    Alors le serveur répond 403
    Et le refus nomme la permission "accounts:write"
    Et la passerelle n'a reçu aucune requête

    Exemples:
      | geste                       | méthode | adresse                                                                                                         | corps                                                |
      | le réglage des canaux       | PUT     | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/channels                                                     | {"smppEnabled":true,"restEnabled":true}              |
      | le réglage des opérations   | PUT     | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/smpp-ops                                                     | {"querySmEnabled":true,"cancelSmEnabled":true}       |
      | le réglage des sessions     | PUT     | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/session-limits                                               | {"maxSessions":1,"allowedBindTypes":"trx"}           |
      | la création d'un webhook    | POST    | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/webhooks                                                     | {"eventType":"mo","url":"https://client.example/mo"} |
      | la modification d'un webhook | PATCH  | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/webhooks/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7f                | {"status":"disabled"}                                |
      | la suppression d'un webhook | DELETE  | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/webhooks/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7f                |                                                      |
      | la rotation d'un secret     | POST    | /api/accounts/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e/webhooks/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7f/secret         |                                                      |
