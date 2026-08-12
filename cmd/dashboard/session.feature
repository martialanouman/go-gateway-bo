# language: fr
Fonctionnalité: La session, d'une requête à l'autre
  Le premier facteur ouvre une session. Le cookie qui la porte ne dit rien de plus que « demande à la
  base » : son sceau l'empêche d'être forgé, la ligne dit s'il vaut encore quelque chose — les deux,
  dans cet ordre.

  Deux échéances, et les deux mordent : douze heures depuis l'ouverture, que rien ne repousse, et
  deux heures sans requête. La première borne ce qu'un cookie volé vaut au maximum, la seconde ferme
  le poste qu'on a quitté.

  Ce que ces scénarios n'observent pas : que le sceau est vérifié **avant** la lecture en base. Une
  requête servie ne dit pas dans quel ordre elle a travaillé — c'est `internal/session` qui l'observe,
  sur un pool fermé où « refusé au sceau » et « arrivé jusqu'à la base » se distinguent.

  # La borne d'entrée de la route : sans cookie du tout, il n'y a rien à résoudre et rien à ouvrir.
  # Tous les autres scénarios passent par une connexion, donc aucun ne l'exerçait.
  Scénario: sans cookie, la route de session refuse
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Quand le navigateur demande "/api/auth/me"
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 401
    Et le refus ne dit pas ce qui manque à la session

  Scénario: une connexion ouvre une session que la requête suivante retrouve
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Quand l'opérateur se connecte avec son mot de passe
    Et le navigateur demande "/api/auth/me"
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 200
    Et la réponse nomme l'opérateur connecté
    Et la réponse annonce que le second facteur n'est pas vérifié
    # Ce corps porte l'identité et l'ensemble des permissions : rien ne doit l'écrire ailleurs, ni le
    # cache d'historique d'un poste partagé, ni un intermédiaire qui met en cache.
    Et la réponse interdit toute mise en cache

  # Les deux rôles sont choisis **non emboîtés** : six clés propres à chacun, six partagées. Avec une
  # paire emboîtée — `billing_readonly` est inclus dans `billing_admin` — ce scénario ne distinguait
  # pas une union d'un « garder le plus fourni des deux », et restait vert sur un serveur qui ignore
  # un rôle sur deux. Mesuré en revue le 11/08/2026.
  Scénario: les permissions rendues réunissent les rôles détenus, sans répéter celles qu'ils partagent
    Étant donné une installation avec un opérateur
    Et l'opérateur détient les rôles "billing_admin" et "account_manager"
    Et un serveur démarré
    Quand l'opérateur se connecte avec son mot de passe
    Et le navigateur demande "/api/auth/me"
    Alors le serveur répond 200
    Et les permissions rendues sont celles des deux rôles réunis
    Et aucune permission n'est rendue deux fois

  Scénario: un cookie que ce serveur n'a pas scellé n'ouvre rien
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Quand le sceau du cookie de session est altéré
    Et le navigateur demande "/api/auth/me"
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 401
    Et le refus ne dit pas ce qui manque à la session

  Scénario: deux heures sans requête ferment la session, et se la faire refuser ne la rouvre pas
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Quand la session reste 3 heures sans requête
    Et le navigateur demande "/api/auth/me"
    Alors le serveur répond 401
    Et redemander "/api/auth/me" est refusé de même

  # Le rejeu est le cœur du scénario, pas un ornement. Constater que "/api/auth/me" refuse après une
  # déconnexion ne prouverait rien : c'est le navigateur qui a jeté son cookie. Ce qui prouve que la
  # ligne a disparu est de renvoyer exactement celui qu'il avait avant.
  Scénario: se déconnecter détruit la session, et le cookie rejoué ne la ressuscite pas
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et le navigateur retient son cookie de session
    Quand le navigateur se déconnecte
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 204
    Et le cookie de session est expiré
    Quand le navigateur rejoue le cookie qu'il avait retenu
    Et le navigateur demande "/api/auth/me"
    Alors le serveur répond 401

  # C'est la seule remédiation dont un opérateur dispose avant step-029. S'il croit son cookie
  # compromis, se reconnecter doit fermer la session que ce cookie porte — sinon le navigateur échange
  # sa valeur contre la nouvelle, plus personne n'atteint l'ancienne, et celui qui en détient la copie
  # garde douze heures d'accès.
  Scénario: se reconnecter ferme la session que le navigateur présentait
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et le navigateur retient son cookie de session
    Quand l'opérateur se connecte avec son mot de passe
    Alors le serveur répond 200
    Et le navigateur reçoit un cookie de session
    Quand le navigateur rejoue le cookie qu'il avait retenu
    Et le navigateur demande "/api/auth/me"
    Alors le serveur répond 401

  # Se déconnecter est une demande d'état, et l'état est atteint. Refuser obligerait le client à
  # traiter un cas sans conséquence, et dirait à qui teste un cookie ce qu'il vaut encore.
  Scénario: se déconnecter sans session réussit aussi
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Quand le navigateur se déconnecte
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 204

  # Une base en panne n'est pas une session fermée. Les confondre ferait se reconnecter l'opérateur
  # en boucle pendant que la panne dure, et masquerait l'incident derrière un écran de connexion.
  Scénario: une base en panne ne se lit pas comme une session fermée
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Quand la table des sessions devient illisible
    Et le navigateur demande "/api/auth/me"
    # Pas de conformité au contrat ici : aucune route ne déclare 500, qui est une panne et non une
    # réponse. Ce que le scénario tient est que la panne ne se déguise pas en 401.
    Alors le serveur répond 500
    Et le refus ne dit pas ce qui manque à la session

  Scénario: une session qui a passé son échéance absolue meurt, même utilisée sans arrêt
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Quand la session dépasse son échéance absolue
    Et le navigateur demande "/api/auth/me"
    Alors le serveur répond 401
