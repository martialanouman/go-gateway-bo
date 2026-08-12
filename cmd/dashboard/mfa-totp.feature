# language: fr
Fonctionnalité: Le second facteur TOTP
  Le premier facteur ouvre une session, le second l'élève. Entre les deux, un challenge de cinq
  minutes : le cookie dit de qui il s'agit, le challenge dit que le mot de passe vient d'être
  présenté. Aucun des deux ne dit ce que dit l'autre.

  Le code n'est accepté qu'une fois, et pas seulement « pas deux fois le même » : la fenêtre de
  dérive accepte trois pas à la fois, donc l'anti-rejeu porte sur le pas et refuse tout ce qui n'est
  pas strictement au-delà du dernier consommé.

  Ce que ces scénarios n'observent pas : que le secret est chiffré en base. La colonne n'est lue
  d'aucune route, et c'est `internal/mfa` qui l'observe, sur un chiffré qu'un autre opérateur ne
  déchiffre pas. Le harnais, lui, tient le secret **en clair** parce que l'enrôlement le lui a rendu
  — c'est exactement ce que fait l'application de l'opérateur.

  Scénario: enrôler puis présenter le premier code élève la session
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Quand l'opérateur enrôle une application d'authentification
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 200
    Et l'enrôlement rend l'URI, le secret et dix codes de récupération
    # L'enrôlement n'élève rien : sans cette ligne, s'attacher un authentificateur suffirait à
    # franchir le second facteur, ce qui n'en serait plus un.
    Et le second facteur n'est pas encore vérifié
    Quand l'opérateur présente le code du pas courant
    Alors la réponse valide le contrat du BFF
    Et le serveur répond 204
    Et le navigateur reçoit un cookie de session
    Et le second facteur est vérifié

  # **Le test central de la step.** La fenêtre de dérive rend un code valable une minute et demie :
  # sans anti-rejeu, celui qui l'intercepte s'en sert.
  Scénario: le même code présenté deux fois est refusé la seconde
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Quand l'opérateur présente le code du pas courant
    Alors le serveur répond 204
    Quand l'opérateur se connecte avec son mot de passe
    Et l'opérateur présente le code du pas courant
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 401
    Et le refus ne dit pas ce qui a été refusé
    Et le second facteur n'est pas encore vérifié

  # Le pas précédent est encore dans la fenêtre : une garde qui ne refuserait que le code identique
  # le laisserait passer. C'est pour ça qu'elle est monotone.
  Scénario: le code du pas précédent ne se rejoue pas non plus
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Quand l'opérateur présente le code du pas courant
    Alors le serveur répond 204
    Quand l'opérateur se connecte avec son mot de passe
    Et l'opérateur présente le code du pas précédent
    Alors le serveur répond 401

  Scénario: un code faux est refusé sans dire lequel des cinq motifs s'applique
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Quand l'opérateur présente un code faux
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 401
    Et le refus ne dit pas ce qui a été refusé
    Et le second facteur n'est pas encore vérifié

  # La fenêtre existe pour le téléphone qui dérive de quelques secondes. Sans elle — c'est le défaut
  # de la bibliothèque — un opérateur en avance d'une seconde serait refusé une fois sur trente.
  Scénario: le code du pas voisin est accepté
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Quand l'opérateur présente le code du pas suivant
    Alors le serveur répond 204
    Et le second facteur est vérifié

  # La borne haute de la fenêtre. Deux pas doubleraient la durée pendant laquelle un code intercepté
  # vaut encore quelque chose.
  Scénario: le code à deux pas est refusé
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Quand l'opérateur présente le code à deux pas
    Alors le serveur répond 401
    Et le second facteur n'est pas encore vérifié

  Scénario: un code de récupération ouvre une fois et une seule
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Alors il lui reste 10 codes de récupération
    Quand l'opérateur présente son premier code de récupération
    Alors le serveur répond 204
    Et le second facteur est vérifié
    Et il lui reste 9 codes de récupération
    Quand l'opérateur se connecte avec son mot de passe
    Et l'opérateur présente son premier code de récupération
    Alors le serveur répond 401
    Et il lui reste 9 codes de récupération

  # Sans cette garde, quiconque détient le mot de passe contourne le second facteur en s'en attachant
  # un neuf, et toute la step ne garde rien.
  Scénario: remplacer un second facteur depuis une session non élevée est refusé
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Quand l'opérateur enrôle une application d'authentification
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 409
    Et le refus dit par où passer
    # L'enrôlement en place n'a pas bougé : un refus qui écraserait quand même le secret enfermerait
    # l'opérateur dehors, ce que le statut seul ne dirait pas.
    Quand l'opérateur présente le code du pas courant
    Alors le serveur répond 204

  # Le témoin de la garde ci-dessus. Sans lui, un enrôlement qui refuserait **toujours** passerait le
  # scénario précédent — et l'opérateur qui change de téléphone n'aurait aucune sortie.
  Scénario: une session élevée peut remplacer son second facteur
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Et l'opérateur présente le code du pas courant
    Quand l'opérateur enrôle une application d'authentification
    Alors le serveur répond 200
    Et le secret rendu diffère du précédent

  # Cinq minutes de challenge, six chiffres de code, trois pas valables à la fois : sans compteur, la
  # recherche exhaustive n'est bornée par rien.
  Scénario: cinq codes faux tuent le challenge, et le bon code qui suit ne rouvre rien
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Quand l'opérateur présente 5 codes faux
    Et l'opérateur présente le code du pas courant
    Alors le serveur répond 401
    Et le second facteur n'est pas encore vérifié

  Scénario: après l'enrôlement, plus aucune réponse ne porte le secret
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Et l'opérateur présente le code du pas courant
    Quand le navigateur demande "/api/auth/me"
    Alors le serveur répond 200
    Et la réponse ne porte ni le secret ni aucun code de récupération
    Et la réponse annonce un second facteur enrôlé
