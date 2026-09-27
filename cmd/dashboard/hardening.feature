# language: fr
Fonctionnalité: Le serveur ne sert une mutation qu'à sa propre application
  `SameSite=Lax` raisonne par **site** et non par origine : un sous-domaine voisin compromis en est
  le même site, et son `POST` partirait avec le cookie de l'opérateur. Le contrôle d'origine referme
  cet écart, et l'exigence du type de contenu referme l'autre moitié — un formulaire inter-site
  n'envoie que `text/plain`, `form-urlencoded` ou `multipart`, jamais `application/json`, et n'a donc
  aucun pré-vol à franchir.

  Ce fichier ne porte **aucun** scénario « une mutation légitime passe » : `login.feature`,
  `mfa-totp.feature`, `mfa-webauthn.feature` et `session.feature` ne sont que cela, et ils traversent
  désormais le contrôle d'origine à chaque `POST`. Un scénario de plus ici n'ajouterait qu'une
  quatrième façon de le redire.

  Scénario: un POST venu d'une autre origine est refusé
    Étant donné un serveur démarré
    Quand le navigateur envoie la connexion depuis l'origine "https://voisin.exemple.test"
    Alors le serveur répond 403
    Et la réponse est conforme au contrat du BFF

  # Un navigateur envoie toujours l'un des deux sur une méthode non sûre. Les deux absents, c'est un
  # client qui n'en est pas un — et qui ne porte donc aucun cookie qu'on lui aurait donné.
  Scénario: un POST sans origine ni indication de destination est refusé
    Étant donné un serveur démarré
    Quand le navigateur envoie la connexion sans annoncer d'origine
    Alors le serveur répond 403

  # Depuis la bonne origine, donc c'est bien le type de contenu qui refuse — et non le contrôle
  # d'origine, qui rendrait le même verdict pour une autre raison.
  Scénario: un POST annoncé en texte brut est refusé
    Étant donné un serveur démarré
    Quand le navigateur envoie la connexion depuis la bonne origine en "text/plain"
    Alors le serveur répond 415
    Et la réponse est conforme au contrat du BFF

  Scénario: la coquille, un fichier haché et l'API portent les en-têtes de durcissement
    Étant donné un serveur démarré
    Quand le navigateur demande "/"
    Alors la réponse porte les en-têtes de durcissement
    Quand le navigateur demande le script que la coquille référence
    Alors la réponse porte les en-têtes de durcissement
    Quand le navigateur demande "/api/health"
    Alors la réponse porte les en-têtes de durcissement

  # Le corps annoncé n'arrive jamais en entier. Sans échéance, la goroutine et le descripteur
  # restent pris aussi longtemps que le client le décide.
  Scénario: un corps qui n'arrive pas est coupé à l'échéance
    Étant donné un serveur démarré
    Quand le navigateur annonce un corps de connexion qu'il n'envoie pas
    Alors le serveur rend la main avant la fin du corps annoncé
