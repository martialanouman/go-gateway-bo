# language: fr
Fonctionnalité: Le BFF interroge l'API Admin de la passerelle
  Aucun écran ne joint la passerelle en direct : c'est le BFF qui l'appelle, et ce qu'il en rapporte
  est ce que l'opérateur verra. Ces scénarios exercent ce trajet-là contre le mock Prism monté sur le
  contrat publié — la frontière du système sous test. Une page de clients qui revient dit que l'URL,
  l'authentification sortante et le décodage typé tiennent ensemble sur le chemin réel.

  Ce que ces scénarios n'observent pas : la passerelle réelle. Le mock rend les exemples du contrat,
  jamais ce que produit le plan de contrôle, et il n'exige aucun certificat. Le mTLS, l'obtention du
  jeton machine par `client_credentials` et le rejeu restent prouvés par les tests unitaires du
  package, sur le même code.

  Scénario: le BFF liste les clients de la passerelle
    Étant donné le mock de l'API Admin monté sur le contrat publié
    Quand le BFF demande la liste des clients
    Alors il obtient une page de clients à afficher

  # Le refus est celui que le contrat déclare pour cette opération, demandé au mock par l'en-tête
  # `Prefer: code=422`. Ce qui compte est qu'un écran puisse dire *pourquoi* on lui refuse la liste :
  # un motif perdu en route redevient « une erreur est survenue », et l'opérateur ouvre un ticket.
  Scénario: un refus de la passerelle arrive au BFF avec son motif
    Étant donné le mock de l'API Admin monté sur le contrat publié
    Quand la passerelle refuse la liste des clients en 422
    Alors le BFF rend une erreur qui porte le motif "forbidden_scope"
