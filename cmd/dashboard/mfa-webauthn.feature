# language: fr
Fonctionnalité: Le second facteur par passkey
  Une passkey est liée à l'origine du site : ce que l'hameçonnage transporte — un mot de passe, un
  code à six chiffres — elle ne le transporte pas. C'est pourquoi la spécification la privilégie
  quand l'appareil la supporte.

  Chaque cérémonie est en deux temps : le serveur tire un défi, l'appareil le signe. Le défi vit dans
  la session qui l'a demandé, porte l'objet pour lequel il a été tiré, et ne sert qu'une fois.

  Le compteur de signature est observé, mais **par la base et non par le harnais** : c'est le compteur
  mémorisé qu'on fait avancer, puis la clé qui en annonce un plus petit. Un authentificateur virtuel
  qui reculerait le sien dirait ce qu'on lui a fait écrire ; la base, elle, porte ce que le produit a
  réellement retenu. Sa monotonie, en tant que requête, s'observe dans `internal/store`.

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
    Et le serveur répond 200
    # L'enregistrement ne prouve rien : il pose un facteur, il ne le franchit pas.
    Et le second facteur n'est pas encore vérifié
    Quand l'opérateur présente sa clé d'accès
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 204
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
    # L'élévation est nécessaire au décor et non au propos : depuis qu'une cérémonie d'enregistrement
    # revérifie l'élévation à sa finition, un rejeu sur session non élevée serait refusé par cette
    # garde-là et n'atteindrait jamais l'anti-rejeu.
    Et l'opérateur a présenté sa clé d'accès
    # Le rejeu porte sur l'**enregistrement** et non sur l'assertion : sur le chemin d'assertion, le
    # challenge de premier facteur est consommé au succès et refuse le rejeu avant que le défi de
    # cérémonie n'ait son mot à dire.
    #
    # **Ce scénario est doublé**, et c'est mesuré : depuis qu'une clé déjà enregistrée est refusée au
    # lieu de violer bruyamment l'index, le rejeu bute sur cette garde-là avant l'anti-rejeu, et le
    # défi jamais consommé le laisse vert. Deux gardes dont l'une masque l'autre. L'anti-rejeu est
    # tenu par `TestUnDefiDeCeremonieSeRelitEtNeSeConsommeQuUneFois`, qui rougit.
    Quand l'opérateur représente exactement la même attestation
    Alors la réponse est conforme au contrat du BFF
    Et la cérémonie est refusée

  Scénario: un défi d'assertion ne finit pas un enregistrement
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et une clé d'accès enregistrée
    # Élevée pour la même raison que le scénario précédent : sans quoi la garde d'élévation de la
    # finition répondrait avant que l'objet du défi n'ait été regardé.
    Et l'opérateur a présenté sa clé d'accès
    # L'assertion ouverte ici tire un défi d'objet « assertion ». Le présenter à la finition d'un
    # enregistrement laisserait enrôler une clé neuve sans rien prouver.
    #
    # **Ce scénario ne garde pas à lui seul le contrôle d'objet**, et c'est mesuré : le `purpose`
    # retiré du `WHERE`, il reste vert. La raison n'est pas celle qu'une rédaction précédente
    # avançait — l'analyseur d'attestation n'est jamais atteint, puisque le défi d'enregistrement de
    # cette session a déjà été consommé par le décor. Ce que ce scénario observe est donc « aucun
    # défi d'enregistrement vivant », ce qui reste vrai sans le contrôle d'objet.
    # Celui-ci est tenu par `TestUnDefiDAssertionNeSeRelitPasCommeUnEnregistrement`, qui rougit.
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
    Et le serveur répond 200
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
    # Le statut, et pas seulement le compte restant : sans lui, un refus laisserait ce scénario vert
    # — le compte est le même que le retrait ait abouti ou non, et les trois statuts sont déclarés.
    # Mesuré en revue, un 409 à la place du 204 ne faisait rougir personne.
    Et le serveur répond 204
    Et il lui reste 1 clé d'accès

  Scénario: retirer la dernière clé d'accès d'un compte sans application d'authentification est refusé
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et une clé d'accès enregistrée
    Et l'opérateur a présenté sa clé d'accès
    Quand l'opérateur retire sa première clé d'accès
    Alors la réponse est conforme au contrat du BFF
    Et le refus dit qu'il faut d'abord un autre facteur
    Et il lui reste 1 clé d'accès

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
    Et il lui reste 1 clé d'accès

  Scénario: retirer une clé d'accès sans avoir franchi le second facteur est refusé
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et une clé d'accès enregistrée
    # La session n'a jamais été élevée — l'enregistrement pose un facteur, il ne le franchit pas.
    # Le refus attendu est celui de l'élévation et **non** celui du dernier facteur, bien que les deux
    # s'appliquent : c'est ce qui distingue les deux gardes, et ce qui fait rougir ce scénario si
    # l'exigence d'élévation disparaît.
    Quand l'opérateur retire sa première clé d'accès
    Alors la réponse est conforme au contrat du BFF
    Et le refus dit comment franchir le second facteur
    Et il lui reste 1 clé d'accès

  Scénario: enrôler une application d'authentification sans franchir la clé en place est refusé
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et une clé d'accès enregistrée
    # La session ne porte que le mot de passe. Sans cette garde, qui le détient s'enrôle une
    # application d'authentification neuve — l'enrôlement lui rend le secret **et** dix codes de
    # récupération — puis élève la session sans avoir jamais présenté la clé. Le second facteur ne
    # garderait alors rien du tout pour qui n'a que des passkeys.
    #
    # La preuve ne peut pas être présentée ici : le corps de cette route ne déclare que `totp` et
    # `recovery_code`. C'est donc l'élévation qui en tient lieu.
    Quand l'opérateur enrôle une application d'authentification
    Alors la réponse est conforme au contrat du BFF
    Et le refus dit comment ajouter un facteur
    Et le second facteur n'est pas encore vérifié

  Scénario: une cérémonie ouverte avant qu'un facteur n'existe ne l'attache pas après
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    # L'ouverture est légitime : le compte n'a aucun facteur, c'est l'amorçage.
    Et l'opérateur ouvre l'enregistrement d'une clé d'accès
    # Un facteur apparaît entre-temps — l'opérateur légitime enrôle son application. La cérémonie
    # ouverte plus tôt ne doit plus aboutir : le défi vit cinq minutes, et sans ce contrôle elle
    # attacherait une clé à un compte désormais protégé, depuis une session jamais élevée.
    Et l'opérateur enrôle une application d'authentification
    Quand l'opérateur finit l'enregistrement ouvert
    Alors la réponse est conforme au contrat du BFF
    Et le refus dit comment ajouter un facteur
    Et il lui reste 0 clé d'accès

  Scénario: une clé d'accès dont le compteur a reculé est refusée
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et une clé d'accès enregistrée
    # L'appareil enregistré a compté ; la clé présentée annonce moins. Deux copies de la même clé
    # privée existent donc, chacune avec son compteur — c'est le seul signal qu'un authentificateur
    # cloné laisse.
    #
    # Le compteur est avancé **en base** et non par l'authentificateur du harnais : un harnais qui
    # reculerait son propre compteur dirait ce qu'on lui a fait écrire, là où la base porte ce que le
    # produit a réellement mémorisé.
    Quand le compteur de la clé d'accès est avancé en base
    Et l'opérateur présente sa clé d'accès
    Alors la réponse est conforme au contrat du BFF
    Et le second facteur est refusé

  Scénario: une clé d'accès enregistrée depuis une autre origine est refusée
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    # Le pendant de l'assertion, pour l'enregistrement : sans lui, seul le liage d'origine de
    # l'assertion serait gardé, et celui de l'enregistrement pourrait disparaître en silence.
    Quand l'opérateur enregistre une clé d'accès signée pour une autre origine
    Alors la réponse est conforme au contrat du BFF
    Et la cérémonie est refusée
    Et il lui reste 0 clé d'accès

  Scénario: un identifiant de clé d'accès mal formé est refusé sur sa forme
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et une clé d'accès enregistrée
    Et l'opérateur a présenté sa clé d'accès
    # Ce que le chemin porte n'est pas nécessairement un identifiant : sans garde, la comparaison à
    # une colonne `uuid` échoue en base et rend 500 — un statut que le contrat ne déclare pas.
    Quand l'opérateur retire une clé d'accès dont l'identifiant est mal formé
    Alors la réponse est conforme au contrat du BFF
    Et il lui reste 1 clé d'accès

  Scénario: le verrou du second facteur est commun aux deux méthodes
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Et l'opérateur présente le code du pas courant
    Et une clé d'accès enregistrée
    # Une seconde connexion : il faut un challenge vivant pour que les essais suivants soient comptés,
    # et le précédent vient d'être consommé par l'élévation.
    Et l'opérateur se connecte avec son mot de passe
    Quand l'opérateur présente 5 assertions fausses
    # Le code est juste et l'application n'a rien fait de mal : c'est le **même seau** qui se referme.
    # C'est le prix de DN-7, et le seul scénario qui traverse les deux méthodes.
    Et l'opérateur présente le code du pas suivant
    Alors la réponse est conforme au contrat du BFF
    Et le second facteur est verrouillé

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

  # Un compteur d'**appels** et non d'échecs, comme celui de l'enrôlement : ouvrir une cérémonie
  # réussit toujours, et chaque ouverture écrit un défi que rien ne purge avant step-187. Le seuil est
  # quatre fois celui des autres dimensions, parce qu'une clé qu'on cherche et cinq minutes qu'on
  # laisse filer produisent de vraies reprises. Dette de step-024, payée ici.
  Scénario: vingt et une ouvertures d'affilée sont bornées
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Quand l'opérateur ouvre 21 enregistrements de clé d'accès
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 429
    Et la réponse porte l'en-tête "Retry-After"
    Et le message annonce la durée restante

  Scénario: le seuil des cérémonies est commun à l'enregistrement et à l'assertion
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur ouvre 20 enregistrements de clé d'accès
    # Sans clé enregistrée, une assertion rend 400 : c'est ce que ce scénario verrait si les deux
    # ouvertures comptaient chacune de leur côté.
    Quand l'opérateur ouvre une assertion sans clé enregistrée
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 429
