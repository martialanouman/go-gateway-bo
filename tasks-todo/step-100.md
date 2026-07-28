# step-100 — Recherche CDR : filtres, curseur, table virtualisée + vues sauvegardées

> **Jalon :** M5 (§6.4, §3.1) · **Statut :** À FAIRE
> **Dépend de :** step-060, step-082, step-002 · **Bloque :** step-101, step-104

## But
Livrer l'outil d'investigation principal : retrouver les messages qui comptent, sur des plages larges,
sans casser la pagination ni le magasin CDR.

## Périmètre (ce que fait CETTE PR)
- Écran CDR Explorer : barre de filtres (client, compte SMPP, **groupe**, date, statut, source/dest,
  connecteur, route).
- `search-messages` avec **pagination par curseur** (`cursor`, `limit`) — **jamais** par numéro de page.
- Table de résultats **virtualisée**, pagination côté serveur.
- **Vues sauvegardées** (`saved_views`, §3.1) : enregistrer, renommer, supprimer un jeu de filtres
  (`view_type = cdr_search`), par opérateur.
- URL portant les filtres, partageable dans un ticket.

## Points d'implémentation clés
- **Curseur, pas page** : le contrat l'impose (§5.1) et c'est ce qui rend la pagination stable sur un
  magasin qui reçoit en continu. Toute UI de type « page 4 sur 120 » est hors contrat.
- Le filtre par groupe se résout vers les **clients membres courants** (§6.4).
- Fraîcheur attendue : un message est cherchable ~10–30 s après traitement (§1.2). L'écran le dit
  plutôt que de laisser croire à un trou.
- Aucun corps de message dans les filtres, l'URL ou la table (invariant a) : la table ne montre que
  des métadonnées.

## Tests (écrits dans la même PR)
- Pagination par curseur : pages successives sans doublon ni saut, sur un jeu qui s'enrichit.
- Chaque filtre restreint le résultat ; « aucun résultat » est distinct de « vide » et de « erreur ».
- Une vue sauvegardée restaure exactement ses filtres, et reste privée à son opérateur.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] aucune pagination par numéro de page · aucun corps dans l'URL (invariant a)

## Hors périmètre
Le panneau de détail → step-101. Le corps → step-103. L'export → step-104.
