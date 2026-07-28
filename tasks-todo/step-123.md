# step-123 — Routage par numéro exact : CRUD, lookup, import MNP en masse

> **Jalon :** M6 (§6.7) · **Statut :** À FAIRE
> **Dépend de :** step-122 · **Bloque :** —

## But
Gérer le niveau de routage le plus prioritaire, y compris son alimentation en masse par la portabilité
des numéros.

## Périmètre (ce que fait CETTE PR)
- CRUD numéros exacts (`routes:read` / `routes:write`) : `list-exact-routes`, `create-exact-route`,
  `update-exact-route`, `delete-exact-route`.
- **Lookup** « où partirait ce numéro, et pourquoi ? » (`lookup-exact-route`), indiquant le **niveau
  qui a décidé**.
- **Import MNP en masse** (`import-exact-routes`, permission `routes:import`) : job, compte-rendu,
  reconstruction du filtre de Bloom côté passerelle.
- Volume d'entrées et **date du dernier import** affichés en permanence.
- Bandeau de priorité (step-122) rappelé sur l'écran.

## Points d'implémentation clés
- **La clé EST le MSISDN** : `PATCH`/`DELETE /exact-routes/{msisdn}`, et la lecture unitaire se fait
  par `lookup?msisdn=` — il n'existe **pas** de `GET /exact-routes/{msisdn}` (§5.1). Ne pas inventer
  d'identifiant de substitution.
- `routes:import` est une permission distincte de `routes:write` : l'import de masse est un acte à
  part.
- L'import est un job : suivi, compte-rendu ligne à ligne des rejets, et pas de « succès » affiché
  tant que la reconstruction n'est pas confirmée.
- Le lookup doit rester utilisable en incident : réponse rapide, résultat copiable.

## Tests (écrits dans la même PR)
- CRUD par MSISDN ; aucun identifiant de substitution utilisé.
- Lookup indique le niveau décideur pour les trois cas (exact, script, déclaratif).
- Import : compte-rendu des rejets, volume et date mis à jour ; refusé sans `routes:import`.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] clé MSISDN respectée · permission d'import distincte testée

## Hors périmètre
Les scripts de routage → step-124 et step-125.
