# language: fr
Fonctionnalité: Le BFF s'authentifie auprès de la passerelle au nom de l'opérateur
  La passerelle ne détient aucun secret : elle vérifie contre le JWKS du tableau de bord un jeton
  signé au nom de l'opérateur connecté, et n'ouvre que les scopes que ses permissions traduisent.

  Contexte:
    Étant donné une installation avec un opérateur

  Scénario: la passerelle reçoit l'identité et les droits de l'opérateur, jamais son cookie
    Étant donné une passerelle qui vérifie les jetons du tableau de bord
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/customer-groups"
    Alors le serveur répond 200
    Et la passerelle a reçu un jeton au nom de l'opérateur avec le scope "admin:read msisdn:reveal"
    Et la passerelle n'a reçu aucun cookie
    Et aucune sortie ne porte le jeton reçu par la passerelle

  Scénario: un changement de rôle change les droits du jeton suivant, sans déconnexion
    Étant donné une passerelle qui vérifie les jetons du tableau de bord
    Et un serveur démarré
    Et l'opérateur détient le rôle "Reporting"
    Et l'opérateur ouvre une session élevée
    Et l'opérateur détient le rôle "Clientèle"
    Quand le navigateur demande "/api/customer-groups"
    Alors la passerelle a reçu un jeton au nom de l'opérateur avec le scope "admin:read admin:write"

  Scénario: les flux temps réel s'ouvrent au nom de l'identité système, en lecture seule
    Étant donné une passerelle qui vérifie les jetons du tableau de bord
    Et un serveur démarré
    Alors la passerelle a ouvert le flux "/admin/stream/metrics" au nom de l'identité système avec le scope "admin:read"

  Scénario: un jeton refusé par la passerelle laisse la session ouverte
    Étant donné une passerelle qui refuse tout jeton
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/customer-groups"
    Alors le serveur répond 502
    Et la réponse porte '"code":"bff_gateway_rejected_token"'
    Quand le navigateur demande "/api/auth/me"
    Alors le serveur répond 200

  Scénario: une passerelle indisponible laisse la session ouverte
    Étant donné une passerelle qui répond 503 "service_unavailable"
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/customer-groups"
    Alors le serveur répond 503
    Quand le navigateur demande "/api/auth/me"
    Alors le serveur répond 200

  Scénario: un scope refusé par la passerelle est un refus expliqué
    Étant donné une passerelle qui répond 403 "forbidden_scope"
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/customer-groups"
    Alors le serveur répond 403
    Et la réponse porte '"code":"forbidden_scope"'

  Scénario: le JWKS se lit sans session et ne publie aucune partie privée
    Étant donné un serveur démarré
    Quand le navigateur demande "/.well-known/jwks.json"
    Alors le serveur répond 200
    Et la réponse publie une clé ES256 sans partie privée

  Scénario: la clé de signature fournie n'apparaît dans aucune sortie
    Étant donné une clé de signature fournie au serveur
    Et un serveur démarré
    Alors la sortie du serveur nomme le kid actif
    Et aucune sortie ne porte la clé de signature

  Scénario: un opérateur élevé reçoit un jeton personnel d'une heure que la passerelle accepte
    Étant donné une passerelle qui vérifie les jetons du tableau de bord
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/auth/gateway-token"
    Alors le serveur répond 200
    Et la réponse est conforme au contrat du BFF
    Et le jeton rendu vaut une heure
    Et le journal porte 1 événement "gateway_token.issue"
    Et l'événement "gateway_token.issue" porte '"admin:read msisdn:reveal"'
    Et le journal ne porte pas le jeton rendu
    Et aucune sortie ne porte le jeton rendu
    Quand un script présente le jeton rendu à la passerelle
    Alors la passerelle a reçu un jeton au nom de l'opérateur avec le scope "admin:read msisdn:reveal"

  Scénario: le jeton personnel se demande sur un sous-ensemble de ses scopes
    Étant donné une passerelle qui vérifie les jetons du tableau de bord
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/auth/gateway-token" avec le corps '{"scopes":["admin:read"]}'
    Alors le serveur répond 200
    Quand un script présente le jeton rendu à la passerelle
    Alors la passerelle a reçu un jeton au nom de l'opérateur avec le scope "admin:read"

  Scénario: un scope que l'opérateur ne détient pas est refusé et nommé
    Étant donné un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur envoie POST "/api/auth/gateway-token" avec le corps '{"scopes":["admin:read","admin:write"]}'
    Alors le serveur répond 403
    Et la réponse porte 'admin:write'
    Et la réponse est conforme au contrat du BFF
    Et le journal porte 0 événement "gateway_token.issue"

  Scénario: sans second facteur, aucun jeton personnel n'est délivré
    Étant donné un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur se connecte avec son mot de passe
    Quand le navigateur envoie POST "/api/auth/gateway-token"
    Alors le serveur répond 409
    Et la réponse porte '"code":"mfa_elevation_required"'
    Et la réponse est conforme au contrat du BFF

  Scénario: sans session, aucun jeton personnel n'est délivré
    Étant donné un serveur démarré
    Quand le navigateur envoie POST "/api/auth/gateway-token"
    Alors le serveur répond 401
    Et la réponse est conforme au contrat du BFF
