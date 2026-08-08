# step-022 — Session BFF : cookie signé, `/auth/me`, `/auth/logout`

> **Jalon :** M1 (§6.9, §4.2) · **Statut :** À FAIRE
> **Dépend de :** step-021 · **Bloque :** step-023, step-024, step-025, step-027

## But
Savoir qui est connecté d'une requête à l'autre, et le savoir de la même façon depuis n'importe
laquelle des instances. `/auth/me` devient le seul endroit d'où le client apprend ce qu'il a le droit
de faire — l'UI se rend sur des **permissions**, jamais sur un rôle codé en dur (§4.2).

## Périmètre (ce que fait CETTE PR)
- Session **avec état** : une ligne par session (migration `00005`) et un cookie porteur d'un
  identifiant opaque **signé** (`DASHBOARD_SESSION_SECRET`), `HttpOnly`, `Secure`, `SameSite=Lax`,
  sans `Domain`.
- Deux niveaux dans la même session : premier facteur franchi, et **second facteur vérifié**
  (`elevated_at`). Le second est ce que step-025 exigera de toute écriture.
- Middleware de résolution de session, avec sa politique d'expiration **tranchée et écrite**
  (absolue, glissante, ou les deux).
- `GET /auth/me` : opérateur, **union des permissions** de ses rôles, état du second facteur,
  expiration.
- `POST /auth/logout` : la session est supprimée et le cookie expiré.

## Points d'implémentation clés
- **Avec état, et la raison n'est pas le confort.** Un jeton signé sans état ne se révoque pas avant
  son expiration, or trois choses de ce jalon l'exigent : le logout, la désactivation d'un opérateur
  (step-029), et l'élévation qui change **au milieu** d'une session (step-023, step-024). `step-187`
  déclare d'ailleurs déjà purger les « sessions mortes » : le plan attend cette table. Le §3.1 ne la
  déclare pas, et step-005 l'a explicitement renvoyée « à la step qui saura ce qu'elle doit
  contenir » — c'est celle-ci, et elle écrit ce que la spec ne disait pas.
- **La signature ne remplace pas la lecture en base** : elle empêche de deviner un identifiant, elle
  ne dit rien sur le fait que la session vit encore. Les deux, dans cet ordre.
- **Fixation de session** : l'identifiant est régénéré au passage du premier facteur au second. Sans
  ça, un identifiant obtenu avant le second facteur reste valable après.
- `/auth/me` ne rend **aucun rôle nu** comme surface de décision : la spec interdit le contrôle de
  rôle côté client, et une liste de rôles dans le DTO invite à le réintroduire. Les rôles peuvent y
  figurer pour l'affichage ; ce sont les permissions qui décident.
- **Le DTO ne porte ni `password_hash`, ni `mfa_totp_secret`, ni les passkeys.** Le type de domaine du
  store ne traverse pas la frontière (§1.11) : c'est ici que la porte de step-004 cesse de garder une
  sonde de vivacité pour garder quelque chose.
- Le secret de signature n'a **aucun repli** : une clé par défaut serait publique, donc n'importe qui
  signerait une session. Le binaire refuse de démarrer sans elle.

## Tests (écrits dans la même PR)
- **Scénario** `session.feature` : login → `/auth/me` répond ; logout → `/auth/me` refuse ; cookie
  d'une session supprimée → refus.
- Un cookie dont la signature ne colle pas est refusé sans que la base soit interrogée.
- Une session expirée est refusée, et la ligne ne ressuscite pas.
- Deux pools distincts sur la même base (deux instances simulées) résolvent la même session.
- `/auth/me` rend l'**union** des permissions d'un opérateur à deux rôles, sans doublon.

## Definition of Done
- [ ] `make check` vert
- [ ] la politique d'expiration est écrite avec sa raison, pas seulement implémentée
- [ ] la mutation « accepter un cookie non signé » fait rougir
- [ ] la mutation « ne pas supprimer la ligne au logout » fait rougir — le cookie expiré seul ne
      protège rien, il suffit de le rejouer
- [ ] la mutation « ne pas régénérer l'identifiant à l'élévation » fait rougir

## Hors périmètre
La vérification du second facteur → step-023 et step-024 ; cette step ne fait que porter le niveau.
Les gardes de permission et l'audit → step-025. Les écrans → step-027. La purge des sessions
expirées → step-187.
