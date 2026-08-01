# language: fr
Fonctionnalité: Le binaire sert l'application qu'il embarque
  Le tableau de bord se livre en un seul déployable : le binaire porte le client autant que le
  serveur. Un opérateur colle une URL dans sa barre d'adresse et arrive sur l'écran qu'il visait ;
  un appel d'API vers une route qui n'existe pas lui dit « introuvable » plutôt que de lui rendre
  l'application en 200, que son navigateur essaierait ensuite de lire comme du JSON.

  Ce que ces scénarios n'observent pas : que la sortie réelle de Vite atterrit dans le binaire. Les
  fichiers embarqués ici sont posés par le harnais, faute de quoi le scénario se tairait partout où
  le client n'a jamais été construit — un clone neuf, le job de CI sans Node — c'est-à-dire qu'il
  serait vert sans rien prouver. Cette affirmation-là appartient à `make build`, et les parcours de
  bout en bout de step-007 la traverseront.

  Scénario: une URL collée dans la barre d'adresse ouvre le tableau de bord
    Étant donné un serveur démarré
    Quand le navigateur demande "/clients/42/comptes"
    Alors le tableau de bord s'affiche
    Et le navigateur ne garde pas la réponse en cache

  Scénario: le fichier que la coquille référence est gardé en cache un an
    Étant donné un serveur démarré
    Quand le navigateur demande "/"
    Et le navigateur demande le script que la coquille référence
    Alors le script est servi
    Et le navigateur garde la réponse en cache un an

  Scénario: un appel d'API vers une route inconnue est introuvable, pas l'application
    Étant donné un serveur démarré
    Quand le navigateur demande "/api/inconnu"
    Alors le serveur répond 404
    Et la réponse n'est pas une page HTML
