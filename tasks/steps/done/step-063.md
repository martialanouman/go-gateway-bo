# step-063 — Comptes SMPP : liste + création rattachée au client

> **Jalon :** M3 (plan §8 ; spec §1.1) · **Statut :** FAIT
> **Dépend de :** step-062 · **Bloque :** step-064

## But
Un opérateur `accounts:read` voit les comptes SMPP, tous ou ceux d'un client, page après page. Un
opérateur `accounts:write` crée un compte rattaché à un client, et l'action laisse sa trace.

## Décisions (arbitrées sur le contexte, 03/10/2026)
- **Contrat Admin : 6.10.0**, toujours la dernière publiée (relevé le 03/10/2026). Rien à relever.
- **Une liste, `/accounts`**, filtrée par l'URL sur un client, « Afficher les suivants »
  (plan §1.5). Pas de filtre par statut : rien ne le demande encore. La fiche client y mène par un lien : un seul écran de liste, pas deux.
- **Création depuis la liste filtrée sur un client** : c'est le client du filtre qui reçoit le compte,
  sans sélecteur de client (une liste paginée ne se choisit pas dans un `Select`). Hors filtre, le
  bouton est désactivé et dit par où passer.
- **Création au plus étroit : le nom.** La passerelle applique ses défauts (`smpp_enabled` et
  `rest_enabled` vrais, `allowed_bind_types: trx`, `max_sessions: 1`, relus dans son schéma) ; la
  modale les nomme. Canaux et bascules : step-064 ; `max_sessions` : step-065. La politique de
  sender ID n'est ni posée ni affichée (ADR-0020).
- **409** : nom déjà pris **chez ce client** (`UNIQUE (customer_id, name)`), placé sous `name`.
- **Nom du client dans la liste** : lu par la requête de la fiche client, partagée en cache — au plus
  une lecture par client distinct de la page (50), aucune composition côté BFF.
- **DTO `SmppAccount` au plus étroit** : `id`, `customerId`, `name`, `status`, `createdAt`.
- **Audit** : `account.create`. **Permissions existantes** : `accounts:read`, `accounts:write`.
- **Dette 063 payée** : `orRefusal` traduit une requête qui n'aboutit pas.
- **Copie de suspension à un compte** : « Ses 1 compte » devient « Son compte ».

## Tests
- **godog** : une page sous `accounts:read`, conforme ; la création laisse deux `account.create`
  dont l'issue désigne le compte ; sans `accounts:write`, 403 sans appel amont ; `customerId` atteint
  l'amont ; le 409 se place sous `name`.
- **Parcours e2e**, en étendant celui de step-062 : depuis la fiche, ouvrir les comptes du client, en
  créer un, puis la suspension chiffre ce compte.
- **Vitest** : création bloquée et expliquée hors filtre client ; `fetch` qui échoue s'annonce en
  français.

## Tableau des mutations

Jouées le 03/10/2026, après un commit, fichier restauré par `cp`, `-count=1`.

| Mutation | Ce qui tombe |
|---|---|
| `CreateAccount` gardée par `accounts:read` | « sans accounts:write, la création d'un compte est refusée… » |
| `customerId` non relayé | « le filtre par client atteint la passerelle » |
| Cible de l'audit non posée | « créer un compte laisse sa trace… » |
| 409 relayé sans le placer sous `name` | « un nom de compte déjà pris chez ce client… » |
| `orRefusal` sans traduction de l'échec réseau | `names a request that never reached the dashboard in French` |

## Critère 4
- **Contre la vraie passerelle, rien n'est joué** : même obstacle que step-061.
- **« Son compte est suspendu avec lui »** n'est gardé que par le parcours e2e.

## Definition of Done
- [x] `make check` vert hors `vuln-web`, rouge sur un avis publié ailleurs (braces) : PR #136.
- [x] `make e2e` vert ; invariants (c) et DTO tenus, mutations à l'appui.
- [x] Dette 063 payée, fichier supprimé.

## Hors périmètre
- Fiche compte, canaux, bascules, webhooks : step-064. Quotas et `max_sessions` : step-065.
- Identifiants : step-066. Filtre par groupe : le contrat le porte, aucun écran ne le demande encore.
