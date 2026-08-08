# language: fr
Fonctionnalité: Le vocabulaire de l'autorisation est semé depuis le catalogue Go
  La table des permissions est une **image** du catalogue, jamais une seconde source, et les neuf
  rôles par défaut sont l'image du §6.10. Un déploiement rejoue le seed ; il doit pouvoir le faire
  sans rien changer, et dire ce qu'il change quand il change quelque chose.

  Ce que « idempotent » ne veut pas dire ici : ignorer ce qui diverge. Une description modifiée est
  remise à ce que le catalogue dit, une clé disparue du catalogue est nommée plutôt que supprimée —
  sinon la base garde indéfiniment un vocabulaire que plus personne ne lit, et le premier symptôme
  sera un écran de rôle qui affiche une permission que le serveur ignore.

  Scénario: une base migrée reçoit le catalogue et les neuf rôles par défaut
    Étant donné une base migrée
    Quand le seed est joué
    Alors le catalogue du code et celui de la base coïncident
    Et les neuf rôles par défaut accordent ce que le code leur donne

  Scénario: rejouer le seed ne change rien et n'échoue pas
    Étant donné une base migrée
    Et le seed déjà joué
    Quand le seed est rejoué
    Alors la seconde exécution ne rapporte aucun changement
    Et le vocabulaire de la base est inchangé

  Scénario: une description réécrite à la main est remise à ce que le catalogue dit
    Étant donné une base migrée
    Et le seed déjà joué
    Et la description de "audit:read" réécrite à la main
    Quand le seed est rejoué
    Alors "audit:read" a retrouvé la description du catalogue
    Et la seconde exécution ne rapporte que la mise à jour de "audit:read"

  Scénario: une clé que le catalogue ne déclare plus est signalée, jamais supprimée
    Étant donné une base migrée
    Et le seed déjà joué
    Et une clé "legacy:read" posée en base hors du catalogue
    Quand le seed est rejoué
    Alors le rapport nomme "legacy:read" comme inconnue du catalogue
    Et "legacy:read" est toujours en base

  Scénario: une attribution ajoutée à la main sur un rôle par défaut est révoquée
    Étant donné une base migrée
    Et le seed déjà joué
    Et "content:read" accordée à la main au rôle "auditor"
    Quand le seed est rejoué
    Alors le rapport révoque "content:read" du rôle "auditor"
    Et le rôle "auditor" n'accorde plus "content:read"

  Scénario: un rôle créé depuis l'interface n'est pas touché par le seed
    Étant donné une base migrée
    Et le seed déjà joué
    Et un rôle personnalisé "astreinte_nuit" qui accorde "sessions:disconnect"
    Quand le seed est rejoué
    Alors le rôle "astreinte_nuit" accorde toujours "sessions:disconnect"
    Et le rapport ne nomme jamais "astreinte_nuit"
