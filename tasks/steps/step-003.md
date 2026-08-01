# step-003 — Contrat Admin : client Go généré, OAuth2 + mTLS, mock Prism

> **Jalon :** M0 (§3.2, §5.1) · **Statut :** À FAIRE
> **Dépend de :** step-000 · **Bloque :** toute step appelant la passerelle

## But
Brancher le BFF sur `@martialanouman/gateway-api-contracts` et en tirer **un seul** client Go typé vers
l'API Admin, plus un mock local — pour que les écrans se développent sans la passerelle, ce qui est la
condition de faisabilité du projet (`plan.md` §16).

## Périmètre (ce que fait CETTE PR)
- `oapi-codegen` sur `openapi-admin.yaml` du package npm → client Go généré sous
  `internal/gateway/`. Le YAML **n'est jamais copié** dans le dépôt : la cible de génération le lit
  depuis `node_modules`, et un test vérifie qu'aucune copie ne traîne.
- Authentification sortante : **OAuth2 client_credentials** (jeton machine mis en cache, renouvelé
  avant expiration, renouvellement non concurrent) + **mTLS**. Base URL, identifiants et CA par
  configuration (§1.8).
- Traduction de l'enveloppe plate `{ code, message, errors[] }` vers une erreur typée du BFF (§1.4),
  réexposée dans la **même forme** au client. Le contrat 2.x **déclare les réponses d'erreur par
  opération** — 401, 403, 404, 409, 422 — plus `ServiceUnavailable` : le mapping les couvre toutes, et
  **distingue `ServiceUnavailable` d'un module désactivé** (§1.4), qui n'est pas une erreur.
- Timeouts courts, retry **seulement** sur les méthodes idempotentes.
- `make mock` : Prism sur le même YAML ; bascule réel/mock par configuration.

## Points d'implémentation clés
- **Le jeton machine porte `content:read` en permanence.** La restriction par opérateur est
  **entièrement** à la charge du BFF — c'est l'origine de l'invariant (c) et du test d'énumération de
  step-025. Le dire dans le code, une fois, à l'endroit qui compte.
- **Ne jamais faire pression sur l'API Admin** (invariant e) : le tableau de bord est un observateur.
  Un retry agressif sur un incident transformerait une panne de visualisation en amplification de
  charge sur le plan de données.
- Le renouvellement de jeton est un point de concurrence : deux requêtes simultanées sur un jeton
  expiré ne doivent en déclencher qu'un seul.
- Le client généré est du code produit par un outil : il n'est pas relu ligne à ligne, mais la
  **cible de génération est commitée** et la CI vérifie que le fichier est à jour.

## Tests (écrits dans la même PR)
- **Scénario** `passerelle.feature` : *Étant donné* le mock Prism, *Quand* le BFF liste les clients,
  *Alors* il obtient une réponse typée ; *Quand* la passerelle répond une erreur `{ code, message }`,
  *Alors* le BFF rend son erreur typée équivalente.
- Unitaire : le renouvellement se déclenche avant expiration et **une seule requête part** quand deux
  appels concurrents trouvent le jeton expiré.
- Unitaire : aucun retry sur `POST` non idempotent.
- Un test échoue si un YAML de contrat est copié dans le dépôt.

## Definition of Done
- [ ] `make check` vert · `make mock` sert les 133 opérations
- [ ] aucun secret dans le dépôt ; identifiants et CA par configuration
- [ ] le code généré est à jour, vérifié en CI
- [ ] la mutation « rendre le renouvellement concurrent » fait rougir le test de jeton

## Hors périmètre
Les trois flux `stream-*` → step-043. Les permissions par opérateur → step-025. Le contrat du BFF
lui-même → step-004.
