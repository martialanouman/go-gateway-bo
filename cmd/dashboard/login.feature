# language: fr
Fonctionnalité: Le premier facteur, et la porte qui le limite
  Un opérateur prouve d'abord ce qu'il sait. Le serveur ne dit jamais lequel des deux facteurs a
  échoué : une adresse inconnue et un mot de passe faux rendent le même code et le même corps — et
  la même durée, que ces scénarios ne mesurent pas.

  Rien n'est ouvert à l'issue de ces scénarios. Le challenge est une promesse de session, pas une
  session : le cookie appartient à step-022, la vérification du second facteur à step-023.

  Ce que ces scénarios n'observent pas : l'égalité des **durées** entre « adresse inconnue » et
  « mot de passe faux ». Un test de temps est instable en CI, et la fiche l'écarte. Ce qui la tient
  est la forme de `passwordMatches` dans `internal/auth` — un opérateur absent traverse la même
  fonction que les autres — et le constat écrit au-dessus.

  Scénario: des identifiants justes rendent un challenge de second facteur
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Quand l'opérateur se connecte avec son mot de passe
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 200
    Et un challenge est émis avec son échéance

  Scénario: un mot de passe faux est refusé sans nommer ce qui a échoué
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Quand l'opérateur se connecte avec un mauvais mot de passe
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 401
    Et le refus ne nomme ni l'adresse ni le facteur en cause

  Scénario: une adresse inconnue est refusée exactement comme un mot de passe faux
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Quand l'opérateur se connecte avec un mauvais mot de passe
    Et quelqu'un se connecte avec une adresse qui n'existe pas
    Alors les deux refus sont indiscernables

  Scénario: cinq échecs verrouillent, et le refus dit combien de temps attendre
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Quand l'opérateur se connecte 5 fois avec un mauvais mot de passe
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 429
    Et la réponse porte l'en-tête "Retry-After"
    Et le message annonce la durée restante

  Scénario: le verrou tient même quand le mot de passe est le bon
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte 5 fois avec un mauvais mot de passe
    Quand l'opérateur se connecte avec son mot de passe
    Alors le serveur répond 429

  Scénario: un verrou échu laisse un nouvel essai passer
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte 5 fois avec un mauvais mot de passe
    Quand le verrou arrive à échéance
    Et l'opérateur se connecte avec son mot de passe
    Alors le serveur répond 200
    Et un challenge est émis avec son échéance

  Scénario: un corps illisible est refusé sans citer de champ interne
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Quand le navigateur envoie un corps qui n'est pas du JSON à la connexion
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 400
