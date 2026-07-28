# step-062 — Fiche client : identité, statut, suspension en cascade, sender IDs

> **Jalon :** M3 (§1.1, §6.15) · **Statut :** À FAIRE
> **Dépend de :** step-061 · **Bloque :** step-063, step-160

## But
Donner au client sa page : ce qu'il est, s'il est actif, ce qu'il a le droit d'écrire comme expéditeur,
et à quel groupe il appartient.

## Périmètre (ce que fait CETTE PR)
- Fiche client : identité éditable, statut, groupe (sélecteur unique, `set-customer-group`), onglets.
- **Suspension** (`suspend-customer`) avec conséquence énoncée : suspendre un client **suspend tous
  ses comptes SMPP**.
- **Sender IDs** du client : `list-sender-ids`, `create-sender-id`, `update-sender-id`,
  `delete-sender-id`.
- Renvoi vers la liste de ses comptes SMPP (`list-customer-accounts`).

## Points d'implémentation clés
- La cascade est le piège de l'écran : la confirmation doit chiffrer l'impact (« *N* comptes seront
  suspendus, *M* binds vivants seront coupés »), pas se contenter d'un « Confirmer ? ».
- Un sender ID est une **autorisation**, pas une décoration : le lien avec l'opt-out est réel
  (un compte n'émettant que depuis des alphanumériques ne peut pas recevoir de STOP — voir step-142).
- L'affectation de groupe est un sélecteur **unique** (un client, un groupe au plus).
- Toute mutation ici est auditée avec `before_json`/`after_json`.

## Tests (écrits dans la même PR)
- Suspension : confirmation chiffrée, puis statut propagé à l'affichage des comptes.
- CRUD sender IDs sous permission.
- Changement de groupe reflété dans la liste des clients et dans le filtre.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] conséquence de la cascade affichée avant confirmation · actions auditées

## Hors périmètre
La facturation du client → M8. La politique de contenu → step-164.
