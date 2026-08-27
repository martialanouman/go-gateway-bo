# language: fr
Fonctionnalité: Le second facteur par passkey
  Une passkey est liée à l'origine du site : ce que l'hameçonnage transporte — un mot de passe, un
  code à six chiffres — elle ne le transporte pas. C'est pourquoi la spécification la privilégie
  quand l'appareil la supporte.

  Chaque cérémonie est en deux temps : le serveur tire un défi, l'appareil le signe. Le défi vit dans
  la session qui l'a demandé, porte l'objet pour lequel il a été tiré, et ne sert qu'une fois.

  Ce que ces scénarios n'observent pas : le compteur de signature, dont la monotonie se tient dans un
  `UPDATE` et s'observe dans `internal/store`. Un authentificateur virtuel qui reculerait son compteur
  ne dirait rien du produit — il dirait ce que le harnais a bien voulu écrire.

  **Le domaine ne ressemble pas à l'adresse d'écoute**, et c'est délibéré : le serveur écoute sur
  `127.0.0.1` mais tient ses cérémonies pour `dashboard.exemple.test`. Un code qui lirait l'origine
  dans la requête refuserait donc tout, et ces scénarios seraient rouges — c'est ce qui leur donne
  leur force.

  Scénario: enregistrer une passkey puis s'en servir élève la session
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Quand l'opérateur enregistre une clé d'accès
    Alors la réponse est conforme au contrat du BFF
    # L'enregistrement ne prouve rien : il pose un facteur, il ne le franchit pas.
    Et le second facteur n'est pas encore vérifié
    Quand l'opérateur présente sa clé d'accès
    Alors la réponse est conforme au contrat du BFF
    Et le second facteur est vérifié

  Scénario: présenter une clé sans en avoir enregistré est refusé, pas une panne
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Quand l'opérateur ouvre une assertion sans clé enregistrée
    Alors la réponse est conforme au contrat du BFF
    Et la réponse conduit vers l'enrôlement

  Scénario: une attestation d'enregistrement déjà servie ne se rejoue pas
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et une clé d'accès enregistrée
    # Le rejeu porte sur l'**enregistrement** et non sur l'assertion, et c'est une correction : sur le
    # chemin d'assertion, le challenge de premier facteur est consommé au succès et refuse le rejeu
    # avant que le défi de cérémonie n'ait son mot à dire. Mesuré — le défi jamais consommé laissait
    # ce scénario vert dans sa première rédaction. L'enregistrement, lui, n'exige aucun challenge :
    # le défi de cérémonie y est la seule garde.
    Quand l'opérateur représente exactement la même attestation
    Alors la réponse est conforme au contrat du BFF
    Et la cérémonie est refusée

  Scénario: un défi d'assertion ne finit pas un enregistrement
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et une clé d'accès enregistrée
    # L'assertion ouverte ici tire un défi d'objet « assertion ». Le présenter à la finition d'un
    # enregistrement laisserait enrôler une clé neuve sans rien prouver.
    #
    # **Ce scénario ne garde pas à lui seul le contrôle d'objet**, et c'est mesuré : le `purpose`
    # retiré du `WHERE`, il reste vert — parce que l'analyseur d'attestation refuse de toute façon
    # une réponse d'assertion. Deux gardes, dont l'une masque l'autre ici. Celle qui compte est tenue
    # par `TestUnDefiDAssertionNeSeRelitPasCommeUnEnregistrement`, qui rougit, lui.
    Quand l'opérateur ouvre une assertion puis finit un enregistrement avec ce défi
    Alors la réponse est conforme au contrat du BFF
    Et la cérémonie est refusée

  Scénario: le défi ouvert dans une autre session n'élève rien
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et une clé d'accès enregistrée
    # Le même opérateur, et pourtant non : une cérémonie ne traverse pas deux sessions.
    #
    # **Ce scénario ne garde pas à lui seul le contrôle de session**, et c'est mesuré : la session
    # retirée du `WHERE`, il reste vert — parce que se reconnecter ferme la session précédente, et
    # que la clé étrangère emporte ses défis en cascade. Deux gardes là encore. Celle du `WHERE` est
    # tenue par `TestLeDefiDUneAutreSessionNeSeRelitPas`.
    Quand l'opérateur ouvre une assertion puis se reconnecte avant de la finir
    Alors la réponse est conforme au contrat du BFF
    Et le second facteur est refusé

  Scénario: une assertion signée pour une autre origine est refusée
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et une clé d'accès enregistrée
    # C'est exactement ce qu'un site d'hameçonnage produirait : la bonne clé, le bon défi, et sa
    # propre origine dans les données signées.
    Quand l'opérateur présente sa clé d'accès signée pour une autre origine
    Alors la réponse est conforme au contrat du BFF
    Et le second facteur est refusé

  Scénario: un opérateur détient plusieurs clés d'accès, et la console les compte
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et une clé d'accès enregistrée
    Et l'opérateur a présenté sa clé d'accès
    Quand l'opérateur enregistre une seconde clé d'accès
    Alors la réponse est conforme au contrat du BFF
    Et il lui reste 2 clés d'accès

  Scénario: retirer une clé d'accès quand il en reste une autre réussit
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et une clé d'accès enregistrée
    Et l'opérateur a présenté sa clé d'accès
    Et une seconde clé d'accès enregistrée
    Quand l'opérateur retire sa première clé d'accès
    Alors la réponse est conforme au contrat du BFF
    Et il lui reste 1 clés d'accès

  Scénario: retirer la dernière clé d'accès d'un compte sans application d'authentification est refusé
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et une clé d'accès enregistrée
    Et l'opérateur a présenté sa clé d'accès
    Quand l'opérateur retire sa première clé d'accès
    Alors la réponse est conforme au contrat du BFF
    Et le refus dit qu'il faut d'abord un autre facteur
    Et il lui reste 1 clés d'accès

  Scénario: enregistrer une clé d'accès sans avoir franchi le facteur en place est refusé
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et une clé d'accès enregistrée
    # La session n'a jamais été élevée : elle ne porte que le mot de passe. En ajouter un second
    # facteur ici permettrait à qui détient le mot de passe de contourner celui qui existe.
    Quand l'opérateur enregistre une seconde clé d'accès
    Alors la réponse est conforme au contrat du BFF
    Et le refus dit comment ajouter un facteur
    Et il lui reste 1 clés d'accès

  Scénario: cinq assertions fausses verrouillent le second facteur, application d'authentification comprise
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et une clé d'accès enregistrée
    Quand l'opérateur présente 5 assertions fausses
    # Le verrou porte sur l'opérateur, pas sur la méthode : c'est le même seau que celui des codes
    # à six chiffres, et le prix en est écrit.
    Et l'opérateur présente sa clé d'accès
    Alors la réponse est conforme au contrat du BFF
    Et le second facteur est verrouillé
