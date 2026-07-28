# step-060 — Groupes de clients : CRUD + filtre transverse

> **Jalon :** M3 (§6.15) · **Statut :** À FAIRE
> **Dépend de :** step-040, step-041, step-042, step-025 · **Bloque :** step-061, step-082, step-100

## But
Livrer la brique organisationnelle la plus simple du domaine — et la première surface complète du
produit, de bout en bout.

> ⚠️ **Développement contre le mock.** Les six opérations `*-customer-group` et `set-customer-group`
> **ne sont pas encore implémentées** côté passerelle (§15 du plan d'exécution). Cette step se termine
> verte contre Prism ; la tranche verticale est prouvée **en réel** en step-061 (clients), dont les
> opérations sont livrées. Prévoir une passe d'intégration quand la passerelle rattrape.

## Périmètre (ce que fait CETTE PR)
- Écran Groupes (`groups:read` / `groups:write`) : liste (nom, nombre de clients membres, statut),
  création, édition, suppression.
- Opérations : `list-customer-groups`, `get-customer-group`, `create-customer-group`,
  `update-customer-group`, `delete-customer-group`, `list-group-customers`.
- Vue des clients membres d'un groupe.
- Composant `GroupFilter` réutilisable, destiné aux listes clients, comptes, CDR et trafic.

## Points d'implémentation clés
- Un groupe est **purement organisationnel** : ni solde, ni quota, ni règle de configuration (§6.15).
  L'écran doit le dire, pour couper court à l'attente inverse.
- **Suppression non destructive** : elle détache les clients, elle n'en supprime aucun. La
  confirmation énonce exactement ça.
- Le filtre par groupe se résout vers les **clients membres courants** (§6.4) : c'est une résolution,
  pas un attribut figé du CDR.
- Les cinq états de contenu sont câblés ici et servent de modèle aux écrans suivants.

## Tests (écrits dans la même PR)
- CRUD complet sous permission ; refusé sans `groups:write`.
- La suppression détache et ne supprime aucun client.
- Le filtre par groupe renvoie les membres courants.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] copie explicite « un groupe ne porte aucune configuration » · actions auditées

## Hors périmètre
L'affectation depuis la fiche client → step-062.
