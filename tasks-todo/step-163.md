# step-163 — Plans tarifaires & fournisseurs de facturation (test de connexion)

> **Jalon :** M8 (§6.11) · **Statut :** À FAIRE
> **Dépend de :** step-160 · **Bloque :** —

## But
Administrer la tarification et le lien vers le fournisseur externe, avec un moyen de vérifier que la
connexion fonctionne avant d'en dépendre.

## Périmètre (ce que fait CETTE PR)
- CRUD **plans tarifaires** : `list-rate-plans`, `create-rate-plan`, `update-rate-plan`,
  `delete-rate-plan`.
- CRUD **fournisseurs** (`billing:provider:write`) : `list-billing-providers`,
  `create-billing-provider`, `update-billing-provider`, `delete-billing-provider`.
- **Test de connexion** (`test-billing-provider`) avec résultat lisible (succès, échec, cause).
- Affectation d'un plan tarifaire à un client depuis sa fiche.

## Points d'implémentation clés
- Les identifiants d'authentification du fournisseur sont des **secrets** : masqués, jamais renvoyés
  ni réaffichés (invariant b).
- Un test de connexion échoué doit dire **pourquoi** de façon exploitable, sans divulguer le secret ni
  l'URL interne complète dans un message d'erreur copié dans un ticket.
- Supprimer un plan tarifaire utilisé par des clients est une action à conséquence : lister les
  clients concernés.
- `billing:provider:write` est une permission distincte de `billing:write` : la respecter.

## Tests (écrits dans la même PR)
- CRUD plans et fournisseurs sous les bonnes permissions.
- Test de connexion : succès et échec rendus distinctement, aucun secret dans la réponse.
- Suppression d'un plan utilisé : avertissement listant les clients.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] invariant (b) tenu sur les identifiants fournisseur

## Hors périmètre
La politique de contenu → step-164.
