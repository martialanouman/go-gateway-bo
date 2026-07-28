# step-001 — Contrat API : package, client Admin typé, mock Prism

> **Jalon :** M0 (§3.2, §5.1) · **Statut :** À FAIRE
> **Dépend de :** step-000 · **Bloque :** toute step appelant la passerelle

## But
Brancher le dépôt sur `@martialanouman/gateway-api-contracts@1.0.0` et en tirer **un seul** client
typé vers l'API Admin, plus un mock local — pour que les écrans se développent sans la passerelle.

## Périmètre (ce que fait CETTE PR)
- Dépendance `@martialanouman/gateway-api-contracts` (registre **GitHub Packages**) + `.npmrc`
  documentant l'authentification ; jeton en variable d'environnement, jamais commité.
- `src/server/gateway/client.ts` : client `openapi-fetch` typé par
  `import type { paths } from "@martialanouman/gateway-api-contracts/admin"`.
- Authentification sortante : **OAuth2 client_credentials** (jeton machine mis en cache, renouvelé
  avant expiration) + mTLS ; base URL, identifiants et CA par configuration.
- Traduction de l'enveloppe d'erreur plate `{ code, message, errors[] }` vers une erreur typée du BFF.
- Mock : script `pnpm mock` lançant Prism sur `openapi-admin.yaml` du package ; variable
  d'environnement basculant client réel / mock.

## Points d'implémentation clés
- **Invariant (d)** : ce client vit uniquement sous `src/server/` — aucun import depuis un composant
  client. Ajouter une règle de lint qui l'interdit.
- Le contrat **n'est jamais copié** dans ce dépôt : tout manque se corrige par une PR dans
  `go-gateway/api/` (voir « Écarts connus » de `INDEX.md`).
- Le jeton machine porte des scopes fixes, dont `content:read` : la restriction par opérateur est
  **entièrement** à la charge du BFF (invariant c). Le documenter dans le code.
- Délais et retries : timeout court, retry seulement sur les méthodes idempotentes. Le tableau de
  bord ne doit jamais faire pression sur l'Admin API (invariant e).

## Tests (écrits dans la même PR)
- Un appel typé (`list-customers`) réussit contre Prism ; un champ inconnu ne compile pas.
- Une réponse d'erreur `{ code, message, errors[] }` produit l'erreur typée attendue.
- Le renouvellement de jeton se déclenche avant expiration et n'est pas concurrent (une seule requête).

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] `pnpm mock` sert les 134 opérations · aucun secret dans le dépôt
- [ ] lint interdisant l'import du client depuis un composant client (invariant d)

## Hors périmètre
Le hub WebSocket (les trois `stream-*`) → step-043. Les permissions par opérateur → step-025.
