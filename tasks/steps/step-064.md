# step-064 — Fiche compte : canaux, bascules SMPP, webhooks

> **Jalon :** M3 (plan §8 ; spec §1.1, §6.19) · **Statut :** À FAIRE
> **Dépend de :** step-063 · **Bloque :** step-065, step-066

## But
Depuis la liste des comptes, un opérateur `accounts:read` ouvre la fiche d'un compte SMPP : son
identité, son statut, ses canaux, ses bascules `query_sm`/`cancel_sm` et ses webhooks MO/DLR. Un
opérateur `accounts:write` active ou coupe un canal, bascule une opération SMPP (ce qui coupe les binds
vivants du compte) et gère les webhooks du compte. Chaque geste laisse une trace d'audit.

## Décisions (arbitrées sur le contexte, 03/10/2026)
- **Contrat Admin : 6.10.0 installé, 6.10.1 publié** le 03/10/2026 à 02:25 UTC et retenu par la
  quarantaine pnpm (`minimumReleaseAge: 1440`). Son diff ne touche que des `description` : un compte
  ou un client `closed` le reste, toute sortie est refusée en 422. Aucun type ne change : pas de bump
  dans la step. L'écart est consigné dans la PR.
- **La fiche : `/accounts/$accountId`**, ouverte depuis le nom dans la liste, sur le modèle de la fiche
  client. Le client se lit par la requête de la fiche client, partagée en cache (comme en step-063),
  et il est lié à sa fiche.
- **Le DTO `SmppAccount` s'élargit** à `smppEnabled`, `restEnabled`, `querySmEnabled` et
  `cancelSmEnabled`. `allowedBindTypes` et `maxSessions` restent pour step-065. `sender_id_policy` n'est
  **jamais** exposé : ADR-0020, la politique disparaît. Aucune route BFF ne relaie
  `set-account-sender-id-policy`.
- **Canaux** (`set-account-channels`, deux booléens obligatoires) : un interrupteur par canal. Il doit
  rester au moins un canal actif, donc le dernier canal actif a son interrupteur désactivé, et une
  infobulle dit pourquoi. Le 422 amont se rédige quand même : l'UI n'est pas la garde.
- **Bascules `query_sm` / `cancel_sm`** (`set-account-smpp-ops`) : tout changement coupe les binds
  vivants du compte (`account_smpp_ops_changed`). Une modale Material le confirme : titre-question,
  conséquences au futur (« Les binds vivants de ce compte seront coupés ; ses clients se reconnecteront
  avec le nouveau réglage »), et le verbe seul. Les binds ne sont **pas chiffrés** :
  `list-account-sessions` arrive avec step-065, qui pourra ajouter le chiffre.
- **Webhooks** (`list/create/update/delete-webhook`) : au plus un par type d'événement (`mo`, `dlr`).
  Le 409 se place sous `eventType`. Un type déjà pris retire l'option du formulaire de création, et la
  raison s'affiche. Le statut se bascule `active` ↔ `disabled`. La suppression passe par une modale de
  confirmation. **`retry_policy_json` n'est ni posé ni affiché** : les défauts de la passerelle
  s'appliquent.
- **Secret de webhook : invariant (b).** Le contrat le déclare en écriture seule. **C'est le BFF qui
  l'engendre** (`crypto/rand`, 32 octets, base64url) à la création et à la rotation (`update-webhook`
  avec `secret` seul). Le BFF le rend une seule fois, dans un DTO dédié à ces deux réponses. Il ne le
  stocke pas, ne le journalise pas, et le DTO `Webhook` ne porte pas ce champ. La modale « montré une
  fois » naît ici, et step-066 la réutilisera. Pourquoi l'engendrer : l'invariant dit « montré
  exactement une fois à la création ou à la rotation », ce qui suppose que le système produit le
  secret. Un secret saisi par l'opérateur aurait déjà été vu ailleurs avant d'arriver ici. **La rotation coupe
  net** : le contrat ne prévoit aucune fenêtre de grâce, donc tant que le client n'a pas installé le
  nouveau secret, il rejette les MO/DLR signés. La modale de rotation le dit avant confirmation.
- **« Tout expéditeur doit être enregistré » n'est pas écrit** (arbitré par l'utilisateur le
  03/10/2026) : la règle va de soi pour les opérateurs, et le tableau de bord n'est pas encore en
  production, donc aucune habitude héritée de la politique de sender ID n'existe. La spec §6.19 et le
  tableau d'amendement du plan §4 sont corrigés dans la même PR.
- **Audit** : `account.channels`, `account.smpp_ops`, `webhook.create`, `webhook.update`,
  `webhook.rotate_secret`, `webhook.delete`. L'audit porte l'ancienne et la nouvelle valeur des
  booléens, et jamais le secret.
- **Permissions existantes** : `accounts:read` et `accounts:write`. Le catalogue nomme déjà les
  webhooks dans `accounts:write`, donc aucune permission n'est ajoutée.

## Tests
- **godog** (`cmd/dashboard/`, à côté des scénarios comptes) :
  - la fiche sous `accounts:read` est conforme et ne contient aucun `senderIdPolicy` ;
  - les canaux atteignent l'amont, avec un 422 rédigé quand les deux sont coupés ;
  - une bascule SMPP laisse sa trace avec l'ancienne et la nouvelle valeur ;
  - un webhook créé rend son secret une seule fois, puis la liste ne le porte pas ;
  - le 409 se place sous `eventType` ;
  - sans `accounts:write`, chaque mutation répond 403 sans appel amont (un scénario par famille, pas
    un par route).
- **Unitaire Go** : le secret engendré a 32 octets d'entropie et deux appels ne donnent pas le même ;
  le DTO `Webhook` sérialisé ne contient pas `secret`.
- **Parcours e2e**, en étendant celui de step-063 : ouvrir le compte créé, couper REST, créer un
  webhook DLR, voir son secret une seule fois, fermer la modale et constater que le secret a disparu
  du DOM.
- **Vitest** : le dernier canal actif ne se coupe pas, et l'infobulle explique pourquoi ; la modale
  d'une bascule SMPP nomme la coupure des binds ; celle de la rotation nomme le rejet des MO/DLR
  jusqu'à l'installation du nouveau secret ; un type de webhook déjà pris ne se propose pas.

## Tableau des mutations
À jouer après un commit, fichier restauré par `cp`, avec `-count=1`.

| Mutation | Ce qui doit tomber |
|---|---|
| Une mutation de webhook gardée par `accounts:read` | le scénario 403 des webhooks |
| `secret` ajouté au DTO `Webhook` | l'unitaire de sérialisation, et le scénario « liste sans secret » |
| Secret constant au lieu de `crypto/rand` | l'unitaire « deux appels diffèrent » |
| Ancienne valeur absente de l'audit SMPP | le scénario de trace des bascules |
| 409 relayé sans le placer sous `eventType` | le scénario du type déjà pris |
| Dernier canal actif laissé coupable côté UI | le test Vitest des canaux |
| Secret laissé dans l'état après fermeture de la modale | le parcours e2e |

## Critère 4
- **Contre la vraie passerelle, rien n'est joué** : c'est le même obstacle que pour step-061.
- **La coupure des binds par une bascule SMPP** relève de la passerelle et ne s'observe pas contre
  Prism. Seule la copie est tenue.

## Definition of Done
- [ ] `make check` vert ; `make e2e` vert.
- [ ] Invariants (b), (c) et DTO tenus, mutations à l'appui.
- [ ] Spec §6.19 et plan §4 ne réclament plus la phrase « tout expéditeur doit être enregistré ».

## Hors périmètre
- `max_sessions`, `allowed_bind_types`, quotas, binds vivants : step-065. Identifiants de bind et clés
  API : step-066.
- Suspension, réactivation et fermeture d'un compte : rien ne le demande au plan §8 pour cette step.
- `retry_policy_json` des webhooks ; suppression d'un compte.
