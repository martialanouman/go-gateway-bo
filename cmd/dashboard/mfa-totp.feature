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
    Et l'URI porte le nom de produit configuré
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
    # **Le même**, à la lettre, et non un code recalculé au pas courant. Recalculer rendait ce
    # scénario dépendant d'une frontière de pas : si les trente secondes basculaient entre les deux
    # présentations — une reconnexion coûte son argon2id — le second code était celui du pas suivant,
    # que l'anti-rejeu accepte à juste titre, et le scénario tombait en accusant la garde. C'est aussi
    # ce que fait celui qui intercepte un code : il renvoie celui qu'il a vu, il n'en calcule pas.
    Et l'opérateur représente le même code
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

  Scénario: un code faux est refusé sans dire lequel des motifs s'applique
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Quand l'opérateur présente un code faux
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 401
    Et le refus ne dit pas ce qui a été refusé
    Et le second facteur n'est pas encore vérifié

  # La fenêtre existe pour le téléphone qui dérive de quelques secondes. C'est celle que les
  # applications compatibles Google Authenticator supposent — un pas de chaque côté.
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

  # **Le remplacement détruit ce qu'il remplace** — le secret en place et les dix codes de
  # récupération partent ensemble. Il exige donc de présenter ce qu'on détruit, et ni le mot de passe
  # ni un cookie de session élevée ne suffisent : sans cela, un cookie capté évincerait définitivement
  # l'opérateur.
  Scénario: remplacer son authentificateur sans le présenter est refusé
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Et l'opérateur présente le code du pas courant
    Quand l'opérateur enrôle une application d'authentification
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 409
    Et le refus dit par où passer
    Et le refus dit qu'aucune preuve n'a été présentée
    # L'enrôlement en place n'a pas bougé : un refus qui écraserait quand même le secret enfermerait
    # l'opérateur dehors, ce que le statut seul ne dirait pas.
    Et il lui reste 10 codes de récupération

  # **Le même 409, l'autre cause.** L'opérateur a bien présenté un code, et c'est ce code qui a été
  # refusé. Jusqu'à step-035 les deux rendaient la même phrase — « le remplacer demande de franchir
  # d'abord celui qui est en place » —, que celui-ci venait précisément de faire : rien ne lui disait
  # que son code était en cause, et il retapait le même.
  #
  # Ce scénario existe pour que les deux corps restent séparés : sans lui, les reconfondre laisse
  # tout vert.
  Scénario: remplacer son authentificateur avec un code faux dit que c'est le code qui a été refusé
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Et l'opérateur présente le code du pas courant
    Quand l'opérateur tente un remplacement avec un code faux
    Alors la réponse est conforme au contrat du BFF
    Et le refus dit que le facteur présenté a été refusé
    # Le facteur en place n'a pas bougé : le refus n'a rien détruit.
    Et il lui reste 10 codes de récupération

  # Le témoin de la garde ci-dessus. Sans lui, un enrôlement qui refuserait **toujours** passerait le
  # scénario précédent — et l'opérateur qui change de téléphone n'aurait aucune sortie.
  Scénario: remplacer son authentificateur en présentant son code réussit
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Et l'opérateur présente le code du pas courant
    Quand l'opérateur remplace son authentificateur en présentant son code
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 200
    Et le secret rendu diffère du précédent

  # **Le verrou que step-028 a découvert en s'en servant.** L'enrôlement écrit le secret avant que
  # l'opérateur ait scanné quoi que ce soit — `Enrolled` vaut `mfa_totp_secret IS NOT NULL`. Qui
  # ferme l'onglet à cet instant portait donc un facteur que personne ne détient, pas même lui : sa
  # prochaine connexion lui réclamait un code qu'aucune application ne produit, le remplacement
  # exigeait la preuve de ce qu'il n'avait pas, et le premier administrateur n'a aucun supérieur
  # pour le réinitialiser (dette 044). C'est la panne que cet écran existe pour empêcher.
  #
  # `mfa_totp_last_step` tranche, et il était déjà là : `NULL` dit qu'aucun code n'a jamais été
  # consommé. Ça n'élargit pas la fenêtre de la dette 004 — un premier enrôlement y est déjà libre
  # pour toute session de premier facteur ; ça rend seulement récupérable ce qui ne l'était pas.
  Scénario: un authentificateur jamais confirmé se remplace sans rien présenter
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Quand l'opérateur enrôle une application d'authentification
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 200
    Et le secret rendu diffère du précédent

  # Les gardes du client ne lisent que `secondFactors` : un facteur annoncé là envoie au challenge,
  # et l'enrôlement reste hors d'atteinte quoi que la route accepte. Livré ainsi, trouvé à la main.
  Scénario: un enrôlement abandonné n'est pas annoncé comme un second facteur
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Quand l'opérateur enrôle une application d'authentification
    Alors le serveur répond 200
    Et la session n'annonce aucun second facteur

  # **Le témoin de la détente ci-dessus, et il tient la moitié qui compte.** Sans sa condition sur
  # les clés d'accès, un compte gardé par une passkey qui marche et portant un TOTP abandonné
  # laisserait quiconque détient le mot de passe remplacer ce TOTP sans élévation, puis s'en servir
  # pour franchir le second facteur : la passkey ne garderait plus rien.
  #
  # La combinaison n'est pas théorique — c'est ce que produit un opérateur qui ajoute une
  # application d'authentification depuis une session élevée par sa clé, et ne la confirme jamais.
  Scénario: un authentificateur jamais confirmé ne se remplace pas quand une clé d'accès garde le compte
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et une clé d'accès enregistrée
    Et l'opérateur a présenté sa clé d'accès
    Et l'opérateur enrôle une application d'authentification
    Quand l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 409
    Et le refus dit qu'aucune preuve n'a été présentée

  # Six chiffres de code, trois pas valables à la fois : sans compteur, la recherche exhaustive n'est
  # bornée par rien. Et le compteur du **premier** facteur n'y suffit pas — une connexion réussie
  # n'incrémente rien, donc qui détient le mot de passe émet autant de challenges qu'il veut.
  Scénario: cinq codes faux verrouillent le second facteur, et le bon code qui suit ne rouvre rien
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Quand l'opérateur présente 5 codes faux
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 429
    Et la réponse porte l'en-tête "Retry-After"
    Et le message annonce la durée restante
    Quand l'opérateur présente le code du pas courant
    Alors le serveur répond 429
    Et le second facteur n'est pas encore vérifié

  # Même défaut qu'au premier facteur, en pire : un échec ne consomme pas le challenge, donc qui
  # détient le mot de passe rejoue le même trente fois d'un coup et essaie trente codes pour un
  # plafond de cinq.
  Scénario: trente vérifications simultanées ne consomment que cinq essais
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Quand trente vérifications simultanées présentent un mauvais code
    Alors 4 réponses refusent le second facteur
    Et 26 réponses annoncent le verrou
    Et 5 essais seulement ont été consommés

  # Le verrou porte sur l'opérateur et pas sur la connexion : se reconnecter ne le lève pas. Sans quoi
  # il ne bornerait rien — c'est exactement le trou que le compteur du premier facteur laissait.
  Scénario: se reconnecter ne lève pas le verrou du second facteur
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Et l'opérateur présente 5 codes faux
    Quand l'opérateur se connecte avec son mot de passe
    Alors le serveur répond 200
    Quand l'opérateur présente le code du pas courant
    Alors le serveur répond 429

  # **Le pendant du scénario ci-dessus, et il tient l'inverse** : le challenge n'est PAS consommé sur
  # échec. Sans cette propriété, une faute de frappe obligerait à refaire toute la connexion — et une
  # garde qui refuse du légitime finit retirée. Mesuré en revue : ajouter la consommation au chemin
  # d'échec laissait tous les scénarios verts.
  Scénario: une faute de frappe n'oblige pas à refaire la connexion
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Quand l'opérateur présente un code faux
    Alors le serveur répond 401
    Quand l'opérateur présente le code du pas courant
    Alors le serveur répond 204
    Et le second facteur est vérifié

  # Sans cette garde, `Verify` partirait déchiffrer une colonne vide et rendrait 500 : une panne là où
  # il n'y a qu'un compte à qui il reste à enrôler.
  Scénario: présenter un code sans avoir enrôlé est refusé, pas une panne
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Quand l'opérateur présente un code qui n'est celui d'aucun authentificateur
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 401
    Et le refus ne dit pas ce qui a été refusé

  # Les bornes que le contrat déclare sont redites en Go, parce que rien dans ce dépôt ne valide une
  # requête à l'exécution contre le YAML. Sans ces deux cas, les redire ne serait qu'un commentaire.
  Scénario: une requête de second facteur mal formée est refusée sur sa forme
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Quand l'opérateur présente un code démesuré
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 400
    Quand l'opérateur présente une méthode que le contrat ne déclare pas
    Alors le serveur répond 400

  # Le challenge est à usage unique, et ce que ce scénario tient est que le **handler** le consomme —
  # pas seulement que la requête SQL sache le faire. Le second code appartient au pas suivant, donc
  # l'anti-rejeu le laisserait passer : ce qui refuse ici est le challenge déjà servi, et rien d'autre.
  #
  # Sans cette consommation, un challenge de cinq minutes vaudrait pour les douze heures de la session.
  Scénario: un challenge déjà servi ne ressert pas
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Quand l'opérateur présente le code du pas courant
    Alors le serveur répond 204
    Quand l'opérateur présente le code du pas suivant
    Alors le serveur répond 401

  # Le challenge dit « le mot de passe de **cet** opérateur vient d'être présenté ». Sans le contrôle
  # d'appartenance, il ne dirait plus que « un mot de passe vient d'être présenté quelque part », et
  # celui qui obtient un challenge — le sien, en se connectant — élèverait la session d'un autre avec
  # son propre code.
  Scénario: le challenge d'un autre opérateur n'élève rien
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Et un second opérateur qui vient de se connecter
    Et l'opérateur se connecte avec son mot de passe
    Quand l'opérateur présente son code sur le challenge du second opérateur
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 401
    Et le second facteur n'est pas encore vérifié
    # Le témoin : le même code, sur son propre challenge, ouvre. Sans lui, un serveur qui refuserait
    # tout passerait ce scénario.
    Quand l'opérateur présente le code du pas courant
    Alors le serveur répond 204
    Et le second facteur est vérifié

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

  # Un compteur d'**appels** et non d'échecs : cette route réussit, donc le verrou d'essais ne la voit
  # jamais passer. Elle hache dix argon2id à chaque fois, et une session de premier facteur suffisait
  # à la répéter sans borne. Dette de step-023, payée ici.
  Scénario: six enrôlements d'affilée sont bornés, et le refus dit combien de temps attendre
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Quand l'opérateur enrôle une application d'authentification 6 fois
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 429
    Et la réponse porte l'en-tête "Retry-After"
    Et le message annonce la durée restante

  # Deux choses à la fois, et la seconde ne se voit qu'avec plusieurs appels : le verrou se lève, et
  # la fenêtre **oublie** — le compteur repart à un plutôt que de reprendre à six. S'il reprenait, le
  # deuxième appel d'après l'échéance reverrouillerait aussitôt, et le verrou serait en pratique
  # définitif pour qui a franchi le seuil une fois.
  Scénario: le verrou de l'enrôlement se lève tout seul, et la fenêtre oublie
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification 6 fois
    Quand le verrou arrive à échéance
    Et l'opérateur enrôle une application d'authentification 5 fois
    # 200 : le premier des six appels a écrit un secret que personne n'a jamais confirmé, et un tel
    # facteur se reprend sans rien présenter. Ce qui compte ici est que ce ne soit plus 429 — la
    # route répond de nouveau pour elle-même.
    Alors le serveur répond 200

  # **Les deux routes partagent un seul seau, et c'est le sujet de ces deux scénarios.** La migration
  # 00007 ne bornait que la vérification ; le remplacement, qui compare lui aussi un code, ouvrait un
  # second seau de cinq essais. Qui détient le mot de passe disposait de dix devinettes par quart
  # d'heure au lieu de cinq — la moitié par une route que personne ne regardait.
  #
  # Chaque scénario se termine sur la route où **l'autre** borne ne peut pas mordre : le compteur
  # d'appels de l'enrôlement ne s'applique pas à la vérification, et il est à zéro quand le second
  # scénario appelle l'enrôlement pour la première fois. Un 429 ne peut donc venir que du seau commun.
  #
  # Quatre remplacements et non cinq, et l'écart n'est pas cosmétique : le compteur d'appels de la
  # migration 00009 borne l'enrôlement à cinq requêtes par quart d'heure, dont la première a servi à
  # enrôler. **Le seuil de cinq échecs n'est donc pas atteignable par cette route seule** — ce qui
  # est une seconde borne, découverte en écrivant ce scénario, et non celle qu'on cherchait. Le
  # cinquième échec vient de la vérification, et c'est précisément ce qui montre que les deux
  # alimentent le même seau.
  Scénario: les codes faux du remplacement comptent dans le seau de la vérification
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    # Le facteur est **confirmé** avant la suite : un enrôlement que personne n'a jamais confirmé se
    # reprend sans preuve, donc aucun code ne serait examiné et le seau ne compterait rien. Et la
    # session repart du premier facteur, sans quoi les codes qui suivent tomberaient sur une session
    # déjà élevée, que la vérification sert sans rien compter.
    Et l'opérateur présente le code du pas courant
    Et l'opérateur se connecte avec son mot de passe
    Quand l'opérateur tente 4 remplacements avec un code faux
    Et l'opérateur présente un code faux
    Et l'opérateur présente le code du pas courant
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 429
    Et le second facteur n'est pas encore vérifié

  # Le code présenté ici est **juste**, et c'est ce qui rend ce scénario discriminant. Avec un code
  # faux, le refus viendrait de l'échec compté et non du verrou consulté : les deux rendent le même
  # 429, et la mutation qui retire la consultation resterait verte — mesuré. Un code juste sépare les
  # deux : sans consultation, il remplacerait l'authentificateur d'un compte verrouillé, c'est-à-dire
  # que le verrou échouerait à empêcher le succès qu'il existe pour empêcher.
  Scénario: un compte verrouillé ne remplace pas son authentificateur, même avec le bon code
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    # Confirmé puis reconnecté, pour les deux raisons du scénario du seau partagé : un facteur que
    # personne n'a confirmé se reprend sans preuve, et une session déjà élevée est servie sans que
    # les codes qui suivent comptent.
    Et l'opérateur présente le code du pas courant
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur présente 5 codes faux
    Quand l'opérateur remplace son authentificateur en présentant son code
    Alors la réponse est conforme au contrat du BFF
    Et le serveur répond 429
    Et le message annonce la durée restante
