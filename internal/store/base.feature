# language: fr
Fonctionnalité: Le schéma propre au BFF s'applique sur une base vierge
  Une installation neuve joue les migrations et obtient les neuf tables du §3.1. Les rejouer est sans
  effet : le produit tourne à ≥2 instances et elles démarrent ensemble, donc la seconde ne doit ni
  échouer ni modifier le schéma que la première vient de poser.

  Scénario: une base vierge reçoit le schéma du tableau de bord
    Étant donné une base PostgreSQL vierge
    Quand les migrations sont jouées
    Alors les neuf tables du schéma existent
    Et le journal d'audit accepte un événement daté du mois courant
    Et le journal d'audit accepte un événement daté du mois suivant

  Scénario: rejouer les migrations ne change rien et n'échoue pas
    Étant donné une base PostgreSQL vierge
    Et les migrations déjà jouées
    Quand les migrations sont rejouées
    Alors la seconde exécution n'a rien appliqué
    Et le schéma est inchangé
