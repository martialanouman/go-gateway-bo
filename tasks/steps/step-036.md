# step-036 — Durcissement HTTP et configuration

> **Jalon :** M1 (§6.9, §1.2) · **Statut :** À FAIRE
> **Dépend de :** step-022, step-031 · **Bloque :** step-027
>
> *Issue de l'audit du 16/09/2026. Elle se lit **avant** step-027, le premier écran qui envoie un
> `POST` depuis le navigateur.*

## But
Le BFF refuse une mutation qui ne vient pas de sa propre origine, pose les en-têtes de sécurité qui ne
dépendent pas d'un nonce, borne la durée d'une requête `/api`, et refuse au démarrage une configuration
de production dangereuse au lieu de l'accepter en silence.

## Constats de l'audit
| Où | Ce qui se passe |
|---|---|
| `internal/bff/router.go:67-72`, `internal/session/cookie.go:115` | La seule défense CSRF est `SameSite=Lax`, qui raisonne par site et non par origine. Le décodeur engendré ne vérifie pas le `Content-Type` : un corps JSON envoyé en `text/plain` passe sans pré-vol. Un sous-domaine voisin compromis peut donc déclencher les mutations `/api/auth/*`. |
| `internal/bff/router.go:95-101`, `internal/bff/assets.go` | La SPA et `/api` sont servies sans `X-Content-Type-Options`, sans `X-Frame-Options`, sans `Referrer-Policy`. |
| `internal/config/config.go:229`, `internal/auth/source.go:94` | Un `DASHBOARD_TRUSTED_PROXIES` absent est accepté. Derrière le load balancer, toutes les requêtes semblent venir de lui : cinq mots de passe faux bloquent tous les opérateurs pendant quinze minutes. |
| `cmd/dashboard/server.go:35-37` | Seul `ReadHeaderTimeout` est posé. `ReadTimeout` et `WriteTimeout` restent à zéro pour la WebSocket, et c'est juste ; mais aucune échéance ne borne une requête `/api`, dont le corps peut arriver à un octet par minute. |
| `internal/config/config.go:520`, `internal/gateway/client.go` | Une URL rejetée est citée par `%q`, avec les identifiants qu'elle contient, puis journalisée. |
| `internal/config/config.go:231` | `DASHBOARD_WEBAUTHN_ORIGIN` accepte `http://` pour n'importe quel hôte. |
| `internal/config` | `DASHBOARD_GATEWAY_MODE=mock` n'est contrôlé par rien. |

## Périmètre (ce que fait CETTE PR)
- **Contrôle d'origine sur toute méthode non sûre de `/api`** : refus si `Sec-Fetch-Site` n'est pas
  `same-origin`, ou si l'`Origin` diffère de l'origine configurée. `application/json` est exigé.
  Refus rédigés, déclarés dans `api/openapi-bff.yaml`.
- **Les en-têtes** : `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: same-origin`, sur la coquille, les assets et `/api`.
- **`DASHBOARD_TRUSTED_PROXIES` devient obligatoire**, avec la valeur explicite `none` pour un poste
  sans proxy. Posée aussi dans `.env.example`, les décors des scénarios, la CI et Playwright.
- **Une échéance par requête `/api`**, sans toucher `/ws`.
- **Les URL citées dans une erreur de configuration** perdent leurs identifiants.
- **`http://` n'est accepté pour `DASHBOARD_WEBAUTHN_ORIGIN` que sur une adresse de bouclage.**
- `DASHBOARD_GATEWAY_MODE=mock` : décider, et écrire, ce qui l'empêche d'atteindre la production.

## Points d'implémentation clés
- **L'origine de référence est `DASHBOARD_WEBAUTHN_ORIGIN`**, déjà validée au démarrage. N'en pas
  créer une seconde.
- **`Sec-Fetch-Site` absent** (client non navigateur, ancien navigateur) : se rabattre sur `Origin`.
  Les deux absents sur une méthode non sûre : refus.
- **L'échéance passe par la bibliothèque standard** (`context.WithTimeout`,
  `http.ResponseController`). Pas de `http.TimeoutHandler`, qui met la réponse en mémoire tampon.
- **`make check` ne lance jamais le binaire** : une variable devenue obligatoire casse là où personne
  ne la cherche si elle n'est pas posée partout.
- **Une garde trop large finit retirée.** Confronter le contrôle d'origine au proxy Vite du poste de
  développement et aux scénarios avant de le livrer.

## Tests (écrits dans la même PR)
- **Scénarios rouges d'abord** : un `POST /api/auth/login` d'une autre origine est refusé ; le même en
  `text/plain` est refusé ; le même depuis l'origine configurée passe.
- **Mutation** : retirer chacune des deux vérifications → rouge, séparément.
- Les trois en-têtes sont présents sur la coquille, un asset et une réponse `/api`.
- Le démarrage sans `DASHBOARD_TRUSTED_PROXIES` échoue et nomme la variable ; `none` passe.
- Un corps envoyé trop lentement est coupé à l'échéance ; `/ws` ne l'est pas.
- Une URL avec identifiants, rejetée, n'apparaît dans aucune sortie.

## Hors périmètre
La CSP à nonce et HSTS → step-186. La WebSocket → step-043.

## Definition of Done
Elle vit dans `CLAUDE.md`.
