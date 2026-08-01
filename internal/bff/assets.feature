# language: fr
Fonctionnalité: Le binaire sert la SPA sans jamais masquer l'API

  Le piège le plus coûteux de l'architecture SPA est l'ordre : si le repli
  attrape `/api/inconnu`, la réponse est 200 + HTML. Le client lit `response.ok`
  puis appelle `.json()`, il lève, et l'écran affiche « indisponible » au lieu de
  « introuvable ». Le défaut est silencieux côté serveur et trompeur côté client.

  Contexte:
    Étant donné un serveur démarré avec des assets embarqués

  Scénario: une URL profonde jamais visitée rend l'application
    Quand "/clients" est demandé
    Alors le statut de la réponse est 200
    Et le corps de la réponse est celui de l'index

  Scénario: une route d'API inconnue n'est jamais masquée par le repli
    Quand "/api/inconnu" est demandé
    Alors le statut de la réponse est 404
    Et la réponse n'est pas du HTML

  Scénario: la sonde de vivacité passe avant le repli
    Quand "/api/health" est demandé
    Alors le statut de la réponse est 200
    Et le type de la réponse est "application/json"

  Scénario: un asset hashé est mis en cache pour toujours
    Quand "/assets/index-abc123.js" est demandé
    Alors le statut de la réponse est 200
    Et la réponse porte un cache immuable

  Scénario: l'index n'est jamais mis en cache
    Quand "/" est demandé
    Alors le statut de la réponse est 200
    Et la réponse interdit la mise en cache

  Scénario: un asset absent ne rend pas l'index et n'est pas mis en cache
    Quand "/assets/disparu.js" est demandé
    Alors le statut de la réponse est 404
    Et la réponse n'est pas du HTML
    # Sans cette assertion, retirer la garde laissait un 404 en cache un an :
    # pendant un déploiement roulant, l'onglet d'un opérateur ne rechargerait
    # plus jamais le chunk demandé à la mauvaise instance.
    Et la réponse ne porte pas de cache immuable

  Scénario: le flux temps réel n'est pas encore livré, et le dit
    Quand "/ws" est demandé
    Alors le statut de la réponse est 501
    Et le type de la réponse est "application/json"
