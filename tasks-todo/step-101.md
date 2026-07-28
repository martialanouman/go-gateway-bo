# step-101 — Fiche message composée côté BFF

> **Jalon :** M5 (§3.2, §5.1) · **Statut :** À FAIRE
> **Dépend de :** step-100 · **Bloque :** step-102, step-103

## But
Offrir une page de message alors que la passerelle n'expose **aucune** lecture unitaire de CDR : le
BFF compose la fiche à partir de ce qui existe.

## Périmètre (ce que fait CETTE PR)
- `GET /messages/{id}` du BFF : composition de `search-messages` filtré sur l'identifiant +
  `get-message-trace`.
- Panneau de détail : chronologie (soumis → routé → SMSC → DLR → remis), route/script/connecteur
  retenus, décision de facturation, codes d'erreur.
- Ouverture par lien direct (partage dans un ticket) et en panneau depuis la table.
- Gestion propre du cas « introuvable » et du cas « trace disponible mais CDR pas encore visible »
  (fenêtre de fraîcheur de 10–30 s).

## Points d'implémentation clés
- **Écart connu assumé** : il n'existe pas de `get-message` côté passerelle (§3.2). La composition et
  son cache sont à la charge du BFF — le documenter dans le code pour que personne ne « cherche
  l'endpoint manquant ».
- Les deux sources peuvent être désynchronisées : afficher ce qu'on a, indiquer ce qui manque, ne
  jamais bloquer la fiche entière sur la partie absente.
- Le **corps n'apparaît pas ici** : il est derrière `content:read`, en step-103.
- Mise en cache courte côté BFF pour éviter de rejouer deux requêtes lourdes à chaque ouverture.

## Tests (écrits dans la même PR)
- La fiche compose bien les deux sources ; l'une manquante donne un rendu partiel explicite.
- Identifiant inconnu → état « introuvable », pas une erreur générique.
- Aucun corps de message dans la réponse composée (invariant a).

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] composition documentée · rendu partiel testé

## Hors périmètre
La cascade de trace détaillée → step-102.
