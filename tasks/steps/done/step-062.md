# step-062 — Fiche client : identité, statut, suspension en cascade, sender IDs

> **Jalon :** M3 (plan §8 ; spec §1.1, §6.15, §6.19) · **Statut :** FAIT
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
  DTO au plus étroit : nombre de comptes, dont actifs, dont fermés. Aucun nombre de sessions : il
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
- **Sender IDs, liste nue** : adresse, statut, date d'enregistrement. Enregistrement (naît
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
- **Mutations** (tableau à la clôture).

## Écarts à la rédaction, arbitrés pendant l'implémentation
- **Le contrat est relevé après le code, en commit propre**, et non en ouvrant : la quarantaine pnpm
  refusait 6.10.0 jusqu'à 22:35 UTC. Le diff du YAML, relu d'avance, ne touche que `CustomerGroup` ;
  aucune route de la fiche n'en dépend.
- **Pas d'unitaire Go pour l'impact** : le scénario « l'impact ne compte actifs que les comptes
  actifs » traverse `suspensionImpact` depuis une réponse amont réelle, et la mutation le fait rougir.
- **Un plan de scénario confronte au contrat les cinq opérations restantes** (renommer, affecter,
  réactiver, approuver, supprimer) : la porte de `TestScenarios` exige qu'aucune opération ne reste
  sans validation de sa réponse. Chaque exemple est une opération distincte, pas une valeur d'un
  mapping.
- **Le rail écarte les routes à paramètre** (`navigation.ts`, `ShellScreen`) : sans quoi `NavPath`
  exigeait une entrée de navigation pour `/customers/$customerId`, qu'aucun rail ne peut ouvrir.
- **Un sender ID refusé au changement de statut s'annonce en toast `warning`**, comme l'archivage
  d'un groupe ; `critical` est la sévérité des alertes.

## Hors périmètre
- Catégorie et limite de débit des sender IDs, filtre, signalements : step-067.
- Liste et création des comptes SMPP : step-063. Réactivation d'un compte : step-064.
- Nombre de sessions coupées : M4. Fermeture et suppression d'un client.
- Facturation (M8), politique de contenu (step-164).

## Constats de revue (sous-agent en lecture seule, 30/09/2026)
- **Traités** :
  - la cascade repasse aussi les comptes **fermés** en `suspended` (`queries/customers.sql:66`, sans
    filtre de statut) : l'impact les compte, la copie dit qu'ils redeviennent réactivables ;
  - la coupure des sessions est au mieux (`adminapi/disconnector.go:66`) : la copie promet le refus
    de tout nouveau bind et une *tentative* de coupure ;
  - `approved_at` n'est jamais écrit par la passerelle : la colonne « Approuvé le » serait restée vide
    pour toujours, elle devient « Enregistré le » et le champ quitte le DTO ;
  - réactiver un sender ID désactivé ne s'appelle plus « approuver » ;
  - boutons de ligne nommés par l'adresse ; bouton d'enregistrement plus doublé à l'état vide ;
  - un scénario fixe le `group_id: null` du détachement.
- **Écarté** : le statut d'un sender ID reste la valeur du contrat, en mono, comme celui d'un groupe :
  la charte garde les statuts en `snake_case`, grep-ables dans les journaux (`status-pill.tsx`).
- **À remonter côté `go-gateway`** : la cascade qui rouvre un compte fermé est probablement un défaut
  de la passerelle ; l'écran le dit en attendant.

## Tableau des mutations

Jouées le 30/09/2026, après un commit, fichier restauré par `cp`, `-count=1`.

| Mutation (le défaut réel qu'elle rejoue) | Ce qui tombe |
|---|---|
| `SuspendCustomer` gardée par `customers:read` | « sans customers:write, la suspension est refusée… » (503 au lieu de 403) |
| `CreateSenderId` gardée par `customers:read` | « sans customers:write, l'enregistrement d'un sender ID est refusé… » |
| Tout compte compté actif | « l'impact d'une suspension ne compte actifs que les comptes actifs » |
| Comptes fermés non comptés | le même scénario, sur les fermés |
| Cible de l'audit du client retirée | « suspendre un client laisse sa trace sur ce client » |
| 409 relayé sans le placer sous `address` | « une adresse déjà enregistrée par ce client est refusée sous son champ » |
| `omitempty` sur `group_id` (régénération) | « détacher un client de son groupe envoie un groupe nul… » |
| Suspension permise avant la lecture de l'impact | `refuses to suspend while the impact cannot be read` |
| Focus non rendu au titre après suspension | `counts the accounts a suspension takes down before it leaves…` |
| `member_count` non recopié dans le DTO du groupe | le parcours e2e, sur la confirmation de suppression (« rien n'est détaché ») |

## Critère 4 — ce qu'aucun test ne garde
- **Contre la vraie passerelle, rien n'est joué** : même obstacle que step-061 (ports partagés des
  deux Compose, sections Kafka et ClickHouse au démarrage d'`admin-api-svc`).
- **Le faux amont ne rejoue pas la cascade** : il ne sert aucun compte (step-063), si bien que le
  parcours ne voit l'impact qu'à zéro. Le comptage est gardé par le scénario contre une liste amont.

## Definition of Done
- [x] `make check` vert en local (30/09/2026), `make e2e` vert.
- [x] Invariants : (c) dix opérations dans la table de `requirePermission`, chaque mutation par
      `auditRelayed`, mutations à l'appui ; DTO déclarés, au plus étroit ; (d) le navigateur ne parle
      qu'au BFF ; (e) l'impact est un appel borné à 500 comptes, lu à la demande.
- [x] Critère 2 : chaque phrase de la fiche relue contre `go-gateway` (constats de revue ci-dessus).
- [x] Critère 4 écrit ci-dessus.
- [ ] Contre la **vraie** passerelle : non joué, voir critère 4.
