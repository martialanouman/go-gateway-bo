# step-043 — Hub WebSocket BFF : trois flux passerelle agrégés en une socket client

> **Jalon :** M2 (§4.2, §5.2) · **Statut :** À FAIRE
> **Dépend de :** step-001, step-022 · **Bloque :** step-044, step-045

## But
Consommer les trois flux de la passerelle une seule fois et n'exposer au navigateur qu'**une** socket
multiplexée par sujet — le sens du travail est l'inverse d'un fan-out.

## Périmètre (ce que fait CETTE PR)
- Consommateurs des trois flux Admin : `stream-metrics`, `stream-sessions`, `stream-billing-alerts`,
  avec reconnexion et repli exponentiel.
- Endpoint `WS /stream` du BFF : sujets `metrics.traffic`, `metrics.connectors`, `sessions.events`,
  `notifications`, `billing.alerts`.
- Protocole client : `{"action":"subscribe","topics":[...]}` au montage, `unsubscribe` au démontage.
- Enveloppe exacte du §5.2 : `{ topic, ts, data }`.
- Authentification et **filtrage par permission** de l'abonnement : un opérateur sans `billing:read`
  ne reçoit pas `billing.alerts`.

## Points d'implémentation clés
- **Invariant (d)** : le navigateur ne se connecte jamais aux flux de la passerelle.
- **Invariant (e)** : la panne d'un flux amont dégrade l'affichage, jamais la détection — l'UI le dit
  (données périmées, horodatage du dernier message) plutôt que d'afficher des valeurs figées.
- Un client lent ne doit pas retenir la mémoire du serveur : borner la file par socket et **jeter les
  instantanés obsolètes** plutôt que de les empiler (ce sont des compteurs agrégés, pas des événements).
- Aucun corps de message ne transite sur ce flux (invariant a).

## Tests (écrits dans la même PR)
- `subscribe`/`unsubscribe` : le client ne reçoit que ses sujets.
- Un sujet non autorisé par les permissions est refusé à l'abonnement.
- Chute d'un flux amont : reconnexion et signalement de fraîcheur, sans effondrement des autres sujets.
- Un client lent voit ses messages jetés, la mémoire du serveur reste bornée.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] enveloppe conforme au §5.2 · filtrage par permission testé

## Hors périmètre
La diffusion inter-instances → step-044. Le client React → step-045.
