# language: fr
Fonctionnalité: Administrer les opérateurs et les rôles
  Qui entre et ce qu'il peut faire, depuis l'interface plutôt que depuis la base. Chaque refus
  structurel est expliqué : un contrôle interdit nomme ce qui manque et par où passer.

  Contexte:
    Étant donné une installation avec un opérateur
    Et l'opérateur détient le rôle "super_admin"
    Et un comparse "martin.leroy@exemple.test" sans rôle
    Et un serveur démarré
    Et l'opérateur ouvre une session élevée

  Scénario: sans operators:manage, la création est refusée, expliquée et tracée
    Étant donné l'opérateur ne détient plus que le rôle "auditor"
    Quand l'opérateur crée l'opérateur "nadia.benali@exemple.test"
    Alors le serveur répond 403
    Et le refus nomme la permission "operators:manage"
    Et la réponse valide le contrat du BFF
    Et le journal porte 1 événement "permission.denied"

  Scénario: avec operators:manage, l'opérateur créé peut entrer
    Quand l'opérateur crée l'opérateur "nadia.benali@exemple.test"
    Alors le serveur répond 201
    Et la réponse valide le contrat du BFF
    Et le journal porte 1 événement "operator.create"
    Et "nadia.benali@exemple.test" se connecte avec le mot de passe choisi pour elle

  Scénario: un mot de passe trop court est refusé à la création
    Quand l'opérateur crée l'opérateur "nadia.benali@exemple.test" avec le mot de passe "court"
    Alors le serveur répond 400
    Et la réponse valide le contrat du BFF
    Et le journal porte 0 événement "operator.create"

  Scénario: la liste des opérateurs dit qui détient quoi
    Quand l'opérateur demande la liste des opérateurs
    Alors le serveur répond 200
    Et la réponse valide le contrat du BFF
    Et la liste porte "martin.leroy@exemple.test" sans rôle

  Scénario: attribuer un rôle à un comparse
    Quand l'opérateur attribue le rôle "auditor" au comparse
    Alors le serveur répond 200
    Et la réponse valide le contrat du BFF
    Et le journal porte 1 événement "operator.roles.set"

  Scénario: se retirer operators:manage est refusé
    Quand l'opérateur s'attribue le seul rôle "auditor"
    Alors le serveur répond 409
    Et la réponse valide le contrat du BFF
    Et l'opérateur détient toujours la permission "operators:manage"

  Scénario: se désactiver est refusé
    Quand l'opérateur désactive son propre compte
    Alors le serveur répond 409
    Et la réponse valide le contrat du BFF

  Scénario: désactiver un opérateur ferme ses sessions, même s'il est réactivé
    Étant donné le comparse est connecté dans un autre navigateur
    Quand l'opérateur désactive le comparse
    Et l'opérateur réactive le comparse
    Alors le serveur répond 200
    Et la réponse valide le contrat du BFF
    Et le journal porte 1 événement "operator.disable"
    Et la session du comparse est refusée

  Scénario: réinitialiser le second facteur d'un comparse le laisse se réenrôler
    Étant donné le comparse a enrôlé une application d'authentification
    Et le comparse est connecté dans un autre navigateur
    Quand l'opérateur réinitialise le second facteur du comparse
    Alors le serveur répond 204
    Et la réponse valide le contrat du BFF
    Et le journal porte 1 événement "operator.mfa.reset"
    Et la session du comparse est refusée
    Et le comparse se reconnecte sans aucun second facteur

  Scénario: réinitialiser son propre second facteur est refusé
    Quand l'opérateur réinitialise son propre second facteur
    Alors le serveur répond 409
    Et la réponse valide le contrat du BFF

  Scénario: composer un rôle personnalisé puis le modifier
    Quand l'opérateur crée le rôle "astreinte" accordant "alerts:read"
    Alors le serveur répond 201
    Et la réponse valide le contrat du BFF
    Quand l'opérateur accorde aussi "alerts:write" au rôle "astreinte"
    Alors le serveur répond 200
    Et la réponse valide le contrat du BFF
    Et le journal porte 1 événement "role.create"
    Et le journal porte 1 événement "role.update"

  Scénario: la liste des rôles distingue les rôles par défaut
    Quand l'opérateur demande la liste des rôles
    Alors le serveur répond 200
    Et la réponse valide le contrat du BFF
    Et la liste porte les neuf rôles par défaut

  Scénario: un rôle par défaut ne se modifie ni ne se supprime
    Quand l'opérateur supprime le rôle "auditor"
    Alors le serveur répond 409
    Et la réponse valide le contrat du BFF
    Quand l'opérateur accorde aussi "alerts:write" au rôle "auditor"
    Alors le serveur répond 409

  Scénario: supprimer un rôle détenu est refusé en nommant ses détenteurs
    Étant donné l'opérateur a créé le rôle "astreinte" accordant "alerts:read"
    Et l'opérateur a attribué le rôle "astreinte" au comparse
    Quand l'opérateur supprime le rôle "astreinte"
    Alors le serveur répond 409
    Et la réponse valide le contrat du BFF
    Et le refus nomme "martin.leroy@exemple.test"

  Scénario: supprimer un rôle que personne ne détient
    Étant donné l'opérateur a créé le rôle "astreinte" accordant "alerts:read"
    Quand l'opérateur supprime le rôle "astreinte"
    Alors le serveur répond 204
    Et la réponse valide le contrat du BFF
    Et le journal porte 1 événement "role.delete"

  Scénario: se retirer roles:manage en éditant son propre rôle est refusé
    Étant donné l'opérateur ne détient plus que le rôle personnalisé "gestion" accordant "operators:manage roles:manage"
    Quand l'opérateur retire "roles:manage" du rôle "gestion"
    Alors le serveur répond 409
    Et la réponse valide le contrat du BFF
    Et l'opérateur détient toujours la permission "roles:manage"
