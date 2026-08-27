# language: fr
Fonctionnalité: Le journal d'audit
  L'invariant (c) a deux moitiés : l'autorisation côté serveur, et la trace de ce qui a été fait. La
  seconde se gagne ici — chaque mutation laisse une ligne, et cette ligne ne porte ni secret ni corps
  de message.

  Six des huit mutations de `/auth/` en portent une. Les deux exemptées sont les ouvertures de
  cérémonie WebAuthn : un défi tiré, remplacé au prochain appel, consommé ou échu en cinq minutes.
  Les tracer produirait du bruit qu'une enquête devrait apprendre à écarter — le meilleur moyen de
  lui faire écarter autre chose.

  **Seuls les succès sont journalisés.** Un refus est déjà compté par le verrou d'essais, et
  journaliser les échecs de connexion ouvrirait une écriture par requête non authentifiée : c'est
  précisément ce que la table des compteurs existe pour éviter d'exposer.

  Scénario: une connexion réussie laisse exactement une trace
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Quand l'opérateur se connecte avec son mot de passe
    Alors le journal porte 1 événement "operator.login"
    Et l'événement porte l'adresse de l'appelant

  Scénario: une connexion refusée ne laisse aucune trace
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Quand l'opérateur se connecte avec un mauvais mot de passe
    # Ce que le verrou compte déjà, le journal n'a pas à le redire — et une écriture par requête non
    # authentifiée est exactement ce qu'on refuse d'ouvrir.
    Alors le journal porte 0 événement "operator.login"

  Scénario: enrôler un second facteur laisse une trace qui ne porte pas le secret
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Quand l'opérateur enrôle une application d'authentification
    Alors le journal porte 1 événement "mfa.enroll"
    # Le payload piégé : `Fields` n'a aucune méthode pour y verser un secret, mais c'est ici qu'on
    # observe que rien ne l'a contourné.
    Et le journal ne porte ni le secret ni les codes de récupération

  Scénario: retirer une clé d'accès laisse une trace, sans exiger de permission
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et une clé d'accès enregistrée
    Et l'opérateur a présenté sa clé d'accès
    Et une seconde clé d'accès enregistrée
    Quand l'opérateur retire sa première clé d'accès
    # Retirer sa propre clé est du self-service : aucune clé du catalogue n'y correspond, et en créer
    # une qu'il faudrait donner à tous les rôles ne garderait rien. C'est l'élévation qui garde le
    # geste, et le journal qui en garde la trace.
    Alors le journal porte 1 événement "passkey.remove"

  Scénario: franchir le second facteur laisse une trace
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Et l'opérateur enrôle une application d'authentification
    Quand l'opérateur présente le code du pas courant
    Alors le journal porte 1 événement "mfa.verify"

  Scénario: ouvrir une cérémonie ne laisse aucune trace
    Étant donné une installation avec un opérateur
    Et un serveur démarré
    Et l'opérateur se connecte avec son mot de passe
    Quand l'opérateur ouvre l'enregistrement d'une clé d'accès
    # Un défi tiré n'a aucun effet durable. L'enregistrement qui le suit, lui, en a un — et il est
    # tracé.
    Alors le journal porte 0 événement "passkey.register"
