# step-061 — Clients : liste, filtres, création

> **Jalon :** M3 (§1.1, §5.1) · **Statut :** À FAIRE
> **Dépend de :** step-060 · **Bloque :** step-062, step-063

## But
Ouvrir le premier niveau de la navigation à deux niveaux du domaine : le client, propriétaire d'un ou
plusieurs comptes SMPP.

## Périmètre (ce que fait CETTE PR)
- Écran Clients (`customers:read` / `customers:write`) : table paginée, recherche, filtre par groupe
  et par statut, colonnes utiles (nom, statut, groupe, nombre de comptes).
- Création d'un client (`create-customer`) avec validation alignée sur le schéma du contrat.
- Opérations : `list-customers` (`?groupId=`), `create-customer`.
- Navigation vers la fiche client.

## Points d'implémentation clés
- **Les clients n'ont aucun accès à la plateforme** (§1.1) : cet écran ne crée jamais un accès
  utilisateur, seulement une entité de facturation et de conformité. La copie l'énonce.
- Créer un client et provisionner un compte technique sont **deux actes distincts** (§7) : ne pas
  fusionner les formulaires par confort.
- Validation dérivée des types du contrat, jamais réécrite à la main.
- Pagination et tri côté serveur ; jamais de tri sur une page partielle.

## Tests (écrits dans la même PR)
- Liste filtrée par groupe et par statut ; pagination stable.
- Création valide ; création invalide affiche les erreurs champ par champ depuis `errors[]`.
- Sans `customers:write`, le bouton de création est désactivé et expliqué.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] validation alignée sur le contrat · création auditée

## Hors périmètre
La fiche client → step-062. Les comptes SMPP → step-063.
