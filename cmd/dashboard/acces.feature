# language: fr
Fonctionnalité: Définir son mot de passe par un lien à usage unique
  Personne ne connaît le mot de passe d'un autre : le titulaire le définit lui-même, et un lien
  qui a servi, expiré ou été remplacé est refusé sans dire lequel des trois.

  Contexte:
    Étant donné une installation avec un opérateur
    Et l'opérateur détient le rôle "Propriétaire"
    Et un comparse "martin.leroy@exemple.test" sans rôle
    Et un serveur démarré

  Scénario: un lien d'activation définit le mot de passe
    Étant donné le comparse n'a pas de mot de passe et a reçu un lien d'activation
    Quand le comparse utilise son lien avec le mot de passe "Nouveau-mot-de-passe-1"
    Alors le serveur répond 204
    Et la réponse valide le contrat du BFF
    Et le journal porte 1 événement "operator.password_set"
    Et le comparse entre avec "Nouveau-mot-de-passe-1"

  Scénario: un lien de réinitialisation efface les facteurs et ferme les sessions
    Étant donné le comparse a enrôlé une application d'authentification
    Et le comparse est connecté dans un autre navigateur
    Et l'opérateur ouvre une session élevée
    Quand l'opérateur envoie un lien au comparse
    Alors le serveur répond 202
    Et le journal porte 1 événement "operator.access_link"
    Et la session du comparse est encore acceptée
    Étant donné le lien du comparse est parti
    Quand le comparse utilise son lien avec le mot de passe "Nouveau-mot-de-passe-1"
    Alors le serveur répond 204
    Et la session du comparse est refusée
    Et le comparse se reconnecte sans aucun second facteur

  Scénario: un lien ne sert qu'une fois, n'expire pas en silence et cède au suivant
    Étant donné le comparse n'a pas de mot de passe et a reçu un lien d'activation
    Et le comparse garde une copie de son lien
    Quand le comparse utilise son lien avec le mot de passe "Nouveau-mot-de-passe-1"
    Et le comparse réutilise la copie de son lien
    Alors le serveur répond 410
    Et la réponse valide le contrat du BFF
    Et le refus dit "Ce lien n'est plus valable : demandez-en un nouveau à un administrateur."
    Étant donné le lien du comparse a expiré
    Quand le comparse réutilise la copie de son lien
    Alors le refus dit "Ce lien n'est plus valable : demandez-en un nouveau à un administrateur."
    Étant donné le comparse a reçu un second lien
    Quand le comparse réutilise la copie de son lien
    Alors le refus dit "Ce lien n'est plus valable : demandez-en un nouveau à un administrateur."

  Scénario: un mot de passe faible est refusé en nommant ce qui manque
    Étant donné le comparse n'a pas de mot de passe et a reçu un lien d'activation
    Quand le comparse utilise son lien avec le mot de passe "motdepasselong"
    Alors le serveur répond 400
    Et la réponse valide le contrat du BFF
    Et le refus nomme "une majuscule"
    Et le refus nomme "un chiffre"

  Scénario: un compte sans mot de passe refuse la connexion comme un mot de passe faux
    Étant donné le comparse n'a pas de mot de passe et a reçu un lien d'activation
    Quand le comparse se connecte avec "n'importe quoi"
    Alors le serveur répond 401
