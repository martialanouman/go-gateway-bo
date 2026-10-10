# step-071 — Jeton personnel pour scripts et collection

> **Jalon :** M3 · **Statut :** FAIT
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
- **Permission dédiée `gateway:personal_token`**, détenue par défaut par `Propriétaire` seul
  (arbitré après revue, 10/10/2026). Hors du BFF, `admin:read`/`admin:write` ne sont plus bornés par
  les gardes fines : « Scripts » publierait, « Clientèle » rechargerait un solde, « Reporting »
  lirait le routage. `Exploitation` non plus ne couvre pas `admin:write` (facturation en lecture,
  pas de clé client). Quatrième orpheline délibérée ; spec §6.10 amendée. La garde est
  `requires(GatewayPersonalToken)` : permission, élévation (403 `mfa_required`) et refus audité.
- **Jamais dans un jeton personnel** : `content:read`, `content:erase`, `gdpr:erase` (invariant a,
  ADR-0008 de la passerelle ; effacements derrière la confirmation de l'écran).
- **Scopes** : `GatewayScopes(grants)` moins ces trois-là, relu à la délivrance. Un scope demandé
  hors de cet ensemble → 403 `forbidden_scope` qui le nomme ; liste vide → 400 (validateur du
  contrat, `minItems`).
- **Émetteur** : `Issuer.Personal(subject, scopes)` — même signature que `Token`, 1 h, hors cache.
- **Audit** `gateway_token.issue`, scopes et expiration dans `After`. Le jeton n'est écrit nulle
  part : ni log, ni audit, ni cache client.
- **Client** : carte « Jeton d'API personnel » dans « Mon compte », bouton désactivé et expliqué sans
  la permission. Le jeton est montré une fois (`SecretShown`), copiable, effacé du cache des
  mutations à la fermeture.
- **Choix des scopes dans l'interface** : hors périmètre — l'API accepte le sous-ensemble, la carte
  délivre l'ensemble.

## Tests (les risques, et la preuve de chacun)
- **Délivré sans la permission, ou sans second facteur** → scénarios : `Exploitation` → 403
  `permission_denied` ; session non élevée → 403 `mfa_required`.
- **Corps des messages emporté** → scénario : le Propriétaire demande `content:read` → 403 qui le
  nomme ; le jeton par défaut ne porte ni `content:*` ni `gdpr:erase`.
- **Scopes au-delà des siens** → même mécanisme d'inclusion, même scénario.
- **Jeton que la passerelle refuse ou garde trop longtemps** → scénario : vérifié par la clé du
  JWKS servi, `sub`, `scope` attendu, `exp − iat` = 1 h.
- **Jeton dans le journal, les logs ou le cache client** → scénario (journal, sortie du process) et
  test de composant (`getMutationCache()`).
- **Chemin d'écran** → parcours e2e `shell.spec.ts` étendu (critère 1).

**Non testé, écrit ici (critère 4)** : la branche `noGatewayAccess` (403 `permission_denied`) n'est
atteinte que par un rôle personnalisé qui porte `gateway:personal_token` sans aucune clé ouvrant la
passerelle ; aucun rôle par défaut n'y mène. Retirée, `Personal` rendrait `ErrNoScope`, soit un 500
au lieu du 403 — vérifié à la lecture, pas par un scénario.

## Hors périmètre
- Durée réglable, choix des scopes dans l'UI, second facteur repassé à la délivrance.
- Comptes de service, révocation.
