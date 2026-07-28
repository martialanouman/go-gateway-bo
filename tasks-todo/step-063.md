# step-063 — Comptes SMPP : liste + création rattachée au client

> **Jalon :** M3 (§1.1) · **Statut :** À FAIRE
> **Dépend de :** step-062 · **Bloque :** step-064, step-065, step-066, step-086

## But
Ouvrir le second niveau du domaine : le compte SMPP, l'objet technique qui se connecte réellement.

## Périmètre (ce que fait CETTE PR)
- Écran Comptes SMPP (`accounts:read` / `accounts:write`) : liste globale et liste par client,
  filtres `?customerId=` / `?groupId=`, recherche.
- Création (`create-smpp-account`, **`customerId` requis**), suppression (`delete-smpp-account`).
- Colonnes : compte, client, groupe, statut, canaux, sessions vivantes / `max_sessions`.
- Navigation vers la fiche compte.

## Points d'implémentation clés
- ⚠️ **Écart connu** : `suspend-smpp-account` figure au contrat mais **n'est pas implémentée** côté
  passerelle. La suspension passe par `update-smpp-account` (PATCH `status`). Ne pas câbler l'opération
  absente ; le noter dans le code et dans `INDEX.md`.
- Un compte appartient toujours à un client : pas de création orpheline, la relation n'est pas
  modifiable après coup sans procédure explicite.
- Le badge « sessions vivantes / limite » apparaît dès la liste : c'est l'information que l'opérateur
  cherche en premier pendant un incident.

## Tests (écrits dans la même PR)
- Création rattachée à un client ; création sans `customerId` refusée.
- Filtres par client et par groupe.
- Suspension effectuée via `update-smpp-account`, pas via l'opération non implémentée.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] écart `suspend-smpp-account` documenté dans le code

## Hors périmètre
Les réglages du compte → step-064 et step-065. Les identifiants → step-066.
