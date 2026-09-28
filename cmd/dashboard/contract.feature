# language: fr
Fonctionnalité: Les réponses du BFF valident son contrat
  `api/openapi-bff.yaml` est la frontière entre les deux moitiés du produit : le client en dérive ses
  types sans jamais lire le code du serveur. « La réponse est du type engendré par le contrat, donc
  elle valide » est une pétition de principe — ça suppose que le générateur encode fidèlement le
  schéma et que la sérialisation émet du JSON conforme. Le scénario lit donc le contrat du dépôt
  lui-même et lui confronte la réponse que le binaire sert vraiment.

  Ce que ce scénario n'observe pas : le binaire valide les requêtes à l'exécution, pas ses réponses.
  La confrontation des réponses vit donc dans le test.

  Scénario: la sonde de vivacité rend ce que le contrat décrit
    Étant donné un serveur démarré
    Quand le navigateur demande "/api/health"
    Alors la réponse valide le contrat du BFF
    Et le service se déclare "ok"
