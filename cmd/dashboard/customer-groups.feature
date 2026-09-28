# language: fr
Fonctionnalité: Les groupes de clients relayés depuis la passerelle
  Le BFF est seul à joindre l'API Admin. Ce qu'il en rapporte arrive dans la forme d'erreur du
  produit, avec les champs en cause, et une panne amont laisse sa trace au journal du serveur.

  Contexte:
    Étant donné une installation avec un opérateur

  Scénario: un opérateur qui détient groups:read voit les groupes
    Étant donné une passerelle servie par le mock du contrat
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/customer-groups"
    Alors le serveur répond 200
    Et la réponse liste au moins un groupe
    Et la réponse est conforme au contrat du BFF

  Scénario: sans groups:read, la liste est refusée et le refus est journalisé
    Étant donné une passerelle servie par le mock du contrat
    Et un serveur démarré
    Et l'opérateur détient le rôle "Audit"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/customer-groups"
    Alors le serveur répond 403
    Et le refus nomme la permission "groups:read"
    Et le journal porte 1 événement "permission.denied"

  Scénario: un refus de la passerelle arrive avec les champs qu'il nomme
    Étant donné une passerelle qui refuse la liste des groupes sur le champ "status"
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/customer-groups"
    Alors le serveur répond 422
    Et le refus place une erreur sous le champ "status"
    Et la réponse est conforme au contrat du BFF

  Scénario: une passerelle en panne se dit indisponible et laisse une trace au journal du serveur
    Étant donné une passerelle qui répond 500 avec le message "trace interne de la passerelle"
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/customer-groups"
    Alors le serveur répond 503
    Et la réponse est conforme au contrat du BFF
    Et la sortie du serveur porte "list-customer-groups"
    Et aucune sortie ne porte "trace interne de la passerelle"

  Scénario: un statut que le contrat ne connaît pas est refusé avant d'atteindre la passerelle
    Étant donné une passerelle qui compte les requêtes reçues
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/customer-groups?status=supprime"
    Alors le serveur répond 400
    Et le refus place une erreur sous le champ "status"
    Et la réponse est conforme au contrat du BFF
    Et la passerelle n'a reçu aucune requête

  Scénario: une passerelle injoignable se dit indisponible, et non en erreur imprévue
    Étant donné une passerelle injoignable
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/customer-groups"
    Alors le serveur répond 503
    Et le refus nomme "bff_upstream_unreachable"
    Et la réponse est conforme au contrat du BFF
