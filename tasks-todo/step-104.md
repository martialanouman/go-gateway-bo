# step-104 — Export CSV asynchrone gouverné

> **Jalon :** M5 (§6.4) · **Statut :** À FAIRE
> **Dépend de :** step-100, step-025 · **Bloque :** —

## But
Permettre l'export de masse sans en faire une porte dérobée : la donnée qui sort du système est celle
qui échappe le plus vite à ses règles.

## Périmètre (ce que fait CETTE PR)
- `create-message-export` (asynchrone) + `get-message-export` (suivi de job, téléchargement).
- Permission dédiée **`cdr:export_bulk`**, hors de la lecture seule.
- **Plafond de lignes** appliqué et annoncé avant lancement, **masquage MSISDN selon le rôle**,
  **TTL de l'artefact**, audit de l'export.
- UI : modale de gouvernance récapitulant filtres, volume estimé, ce qui sera masqué et la durée de
  conservation ; suivi du job avec états et téléchargement.

## Points d'implémentation clés
- **Un export ne contient jamais le corps d'un message** (invariant a), quelle que soit la permission
  de l'opérateur — c'est une décision de la step, à tester explicitement.
- Le masquage MSISDN dépend du rôle : le décider **côté serveur** au moment de la génération, jamais
  au téléchargement.
- Le plafond de lignes est annoncé avant, appliqué pendant, et l'artefact tronqué le **dit** — pas de
  troncature silencieuse.
- Le lien de téléchargement expire (TTL) et est lié à l'opérateur demandeur.

## Tests (écrits dans la même PR)
- Sans `cdr:export_bulk`, l'action est indisponible et l'appel refusé côté serveur.
- Le plafond tronque et l'artefact porte la mention de troncature.
- Le masquage MSISDN s'applique selon le rôle ; aucun corps dans le CSV (invariant a).
- Le lien expire après le TTL.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] export audité · masquage et plafond testés · aucun corps exporté

## Hors périmètre
L'effacement RGPD → step-166.
