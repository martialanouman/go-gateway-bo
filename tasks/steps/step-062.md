# step-062 — Fiche client : identité, statut, suspension en cascade, sender IDs

> **Jalon :** M3 (plan §8 ; spec §1.1, §6.15, §6.19) · **Statut :** EN COURS
> **Dépend de :** step-061 · **Bloque :** step-063, step-067

## But
Depuis la liste des clients, un opérateur `customers:read` ouvre la fiche d'un client : identité,
statut, groupe, sender IDs. Un opérateur `customers:write` le renomme, l'affecte à un groupe, le
suspend — l'impact chiffré s'affiche **avant** la confirmation (plan §8) —, le réactive, et gère ses
sender IDs. Chaque geste laisse sa trace.

## Décisions (arbitrées sur le contexte, 30/09/2026)
- **Contrat Admin : 6.9.0 → 6.10.0**, relevé en ouvrant, dès la fin de la quarantaine pnpm (30/09,
  22:35 UTC). Diff du YAML relu : le seul écart est `member_count` (int64, `minimum: 0`, **requis**)
  sur `CustomerGroup`. Il paie la **dette 062** : colonne « Clients » de l'écran Groupes, et la
  confirmation de suppression chiffre les clients détachés.
- **Suspension par `suspend-customer`**, pas par un PATCH du statut : c'est l'opération qui porte la
  cascade. Relu dans `go-gateway` (`internal/storage/postgres/customers.go`, `Suspend`) : le client et
  **tous** ses comptes passent `suspended` dans une transaction, puis les binds vivants sont coupés
  (`disconnectCustomer`, au mieux : un échec est journalisé, la suspension tient).
- **Impact chiffré** : `GET /customers/{id}/suspension-impact`, lu à l'ouverture de la confirmation
  seulement, depuis `list-customer-accounts` (500 comptes au plus, non paginé — invariant e borné).
  DTO au plus étroit : nombre de comptes, nombre de comptes actifs. Aucun nombre de sessions : il
  exige le registre de sessions (M4), et la copie ne chiffre que ce qu'elle sait.
- **Réactivation** : `update-customer` avec `status: active`. Relu : elle **ne réactive pas les
  comptes** (leur statut stocké reste `suspended`). La confirmation le dit ; la réactivation d'un
  compte vient avec la fiche compte (step-064).
- **Fermeture (`closed`) et suppression** : hors périmètre, aucune n'est demandée par la spec pour la
  fiche, et `closed` est terminal.
- **Identité = le nom** (`update-customer`, `name` seul). Facturation et contenu : M8 et step-164.
- **Affectation à un groupe depuis la fiche** (spec §6.15, « sélecteur unique ») par
  `set-customer-group`, sous `customers:write` : c'est le client qui change. La liste des groupes
  exige `groups:read`, comme à la création.
- **Sender IDs, liste nue** : adresse, statut, date. Enregistrement (naît
  `pending_carrier_approval`), approbation (`active`), désactivation (`disabled`), suppression ; la
  route BFF de changement de statut n'accepte que `active` et `disabled`. Catégorie et limite de
  débit : **step-067**, que le contrat n'autorise pas encore. La phrase « tout expéditeur doit être
  enregistré » appartient à step-064 (plan §4) : le contrat 6.10.0 garde la politique par compte, la
  dire ici serait faux.
- **Audit** par `auditRelayed` : `customer.update`, `customer.group`, `customer.suspend`,
  `customer.reactivate`, `sender_id.create`, `sender_id.update`, `sender_id.delete`.
  **Permissions existantes** : `customers:read`, `customers:write` (spec §6.19).
- **Refus rédigés** : un 404 nomme le client ou le sender ID ; le 409 de `create-sender-id`
  (unicité `(customer_id, address)`, relue dans le schéma de la passerelle) se place sous le champ.

## Périmètre (ce que fait CETTE PR)
- **Contrat BFF** : `GET`/`PATCH /customers/{customerId}`, `PUT /customers/{customerId}/group`,
  `POST …/suspend`, `POST …/reactivate`, `GET …/suspension-impact`, `GET`/`POST …/sender-ids`,
  `PATCH`/`DELETE …/sender-ids/{senderId}` ; `memberCount` sur `CustomerGroup`.
- **Serveur** : handlers gardés, mutations auditées, DTO déclarés.
- **Client** : écran `/customers/$customerId`, cinq états ; lien depuis chaque ligne de la liste ;
  colonne « Clients » et chiffre de la suppression sur `/groups`.
- **Faux amont des parcours** : fiche, suspension, sender IDs.

## Tests (écrits dans la même PR)
- **godog (`cmd/dashboard/customers.feature`, contre Prism)** : suspendre laisse deux lignes
  `customer.suspend` sur le client ; sans `customers:write`, suspension et enregistrement d'un sender
  ID sont refusés en 403 sans appel amont ; l'impact compte les comptes actifs de la réponse amont.
- **Parcours e2e (critère 1)**, en étendant celui de step-061 : l'opérateur ouvre le client créé,
  enregistre un sender ID, suspend le client après avoir lu l'impact, le retrouve suspendu.
- **Client (Vitest)** : l'impact s'affiche avant que la suspension parte ; contrôles désactivés et
  expliqués sans `customers:write` ; un 409 de sender ID se place sous le champ.
- **Unitaires Go** : le DTO d'impact ne compte actifs que les `active`.
- **Mutations** (tableau à la clôture).

## Hors périmètre
- Catégorie et limite de débit des sender IDs, filtre, signalements : step-067.
- Liste et création des comptes SMPP : step-063. Réactivation d'un compte : step-064.
- Nombre de sessions coupées : M4. Fermeture et suppression d'un client.
- Facturation (M8), politique de contenu (step-164).
