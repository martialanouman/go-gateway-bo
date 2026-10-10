# step-071 — Jeton personnel pour scripts et collection

> **Jalon :** M3 · **Statut :** EN COURS
> **Dépend de :** step-070 (émetteur, JWKS, `GatewayScopes`) · **Bloque :** —

## But
Un opérateur qui travaille sur l'API Admin hors du tableau de bord — la collection Bruno de
`go-gateway/api/collections/`, un script lancé à la main — a besoin d'un jeton que la passerelle
accepte en production. ADR-0019 : le BFF le délivre à un opérateur authentifié **et passé par le
second facteur**, à **son** `sub`, scopes inclus dans les siens, durée d'une heure au plus. Pas de
compte de service.

## Décisions (arbitrées le 10/10/2026 avec l'utilisateur)
- **Durée fixe : 1 h.** Des durées de 7 à 90 jours ont été envisagées puis écartées : elles ne
  servent qu'une automatisation sans humain, que l'ADR exclut (arbitrage du 27/09/2026), et un JWT
  signé ne se révoque pas. Si une automatisation arrive : comptes gérés par le BFF, révocables
  (ADR-0019, « À revoir »), pas un JWT long.
- **Route** `POST /auth/gateway-token`, corps optionnel `{ "scopes": [...] }` ; absent, tous les
  scopes de l'opérateur. Réponse `{ token, scopes, expiresAt }`.
- **Garde** : exemptée dans `authorization` (self-service, aucune clé du catalogue ne la désigne) ;
  le handler exige la session (401) et l'élévation (409 `mfa_elevation_required`), sur le patron de
  `DeleteWebauthnPasskey`.
- **Scopes** : `GatewayScopes(grants)` relu à la délivrance. Un scope demandé hors de cet ensemble →
  403 qui le nomme ; aucun scope (liste vide demandée, ou opérateur sans droit à la passerelle) →
  400 / 403.
- **Émetteur** : `Issuer.Personal(subject, scopes)` — même signature que `Token`, 1 h, hors cache.
- **Audit** `gateway_token.issue`, scopes et expiration dans `After`. Le jeton n'est écrit nulle
  part : ni log, ni audit, ni cache client.
- **Client** : carte « Jeton d'API personnel » dans « Mon compte ». Le jeton est montré une fois,
  copiable ; la carte dit qu'il expire dans l'heure et tombe à la rotation de clé.
- **Choix des scopes dans l'interface** : hors périmètre — l'API accepte le sous-ensemble, la carte
  délivre l'ensemble.

## Tests (les risques, et la preuve de chacun)
- **Délivré sans second facteur** → scénario : session non élevée, 409. Mutation : retirer le
  contrôle d'élévation.
- **Scopes au-delà des siens** → scénario : un scope non détenu est refusé et nommé. Mutation :
  retirer le contrôle d'inclusion.
- **Jeton que la passerelle refuse ou garde trop longtemps** → scénario : vérifié par la clé du
  JWKS servi, `sub` de l'opérateur, `scope` attendu, `exp − iat` = 1 h. Mutation : durée de 5 min.
- **Jeton dans le journal** → scénario : l'audit porte les scopes, jamais le jeton.
- **Chemin d'écran** → parcours e2e existant étendu (critère 1).

## Hors périmètre
- Durée réglable, choix des scopes dans l'UI, second facteur repassé à la délivrance.
- Comptes de service, révocation.
