# step-085 — Moniteur de sessions : table virtualisée + deltas WS

> **Jalon :** M4 (§6.5, §2) · **Statut :** À FAIRE
> **Dépend de :** step-045, step-063 · **Bloque :** step-086

## But
Afficher jusqu'à des dizaines de milliers de binds vivants sans faire fondre le navigateur, et les
tenir à jour par deltas plutôt qu'en rechargeant tout.

## Périmètre (ce que fait CETTE PR)
- Écran Sessions (`sessions:read`) : onglets **binds utilisateurs** et **binds SMSC**.
- `list-sessions` (paginée) + table virtualisée (`@tanstack/react-virtual`).
- Mise à jour par **deltas** via le sujet `sessions.events` (`connected` / `disconnected`), sans
  refetch global.
- Filtres : compte, client, groupe, type de bind ; recherche.

## Points d'implémentation clés
- §2 : jusqu'à des dizaines de milliers de sessions → **pagination et virtualisation obligatoires**,
  et mises à jour en deltas. Un refetch complet à chaque événement est le défaut à éviter.
- Un delta arrivant pour une ligne hors de la page courante ne doit pas la faire apparaître : ajuster
  les compteurs, pas la liste.
- Réconciliation périodique légère pour corriger une dérive de deltas (le Pub/Sub est au mieux une
  fois, step-044).
- Le tri reste côté serveur ; la virtualisation ne trie jamais une page partielle.

## Tests (écrits dans la même PR)
- Rendu d'une grande liste sans dégradation notable (test de performance borné).
- Un événement `connected`/`disconnected` met à jour la table sans refetch global.
- La réconciliation corrige un delta manqué (simulé).

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] aucun refetch global sur événement · virtualisation effective

## Hors périmètre
La déconnexion forcée → step-086.
