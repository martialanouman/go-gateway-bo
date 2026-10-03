# step-064 — Fiche compte : canaux, bascules SMPP, webhooks

> **Jalon :** M3 (plan §8 ; spec §1.1, §6.19) · **Statut :** FAIT
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
- **Canaux** (`set-account-channels`, deux booléens obligatoires) : un bouton « Couper » ou « Ouvrir »
  par canal, sur le modèle des noms d'expéditeur (le kit n'a pas d'interrupteur). Il doit rester au
  moins un canal ouvert, donc le bouton du dernier canal ouvert est désactivé, et une infobulle dit
  pourquoi. Le 422 amont se rédige quand même en français : l'UI n'est pas la garde.
- **Bascules `query_sm` / `cancel_sm`** (`set-account-smpp-ops`) : tout changement coupe les binds
  vivants du compte (`account_smpp_ops_changed`). Une modale Material le confirme : titre-question,
  conséquences au futur (« Les binds ouverts de ce compte seront coupés : ses clients devront se
  reconnecter, et le nouveau réglage s'appliquera dès leur reconnexion »), et le verbe seul. Les binds ne sont **pas chiffrés** :
  `list-account-sessions` arrive avec step-065, qui pourra ajouter le chiffre.
- **Webhooks** (`list/create/update/delete-webhook`) : au plus un par type d'événement (`mo`, `dlr`).
  Le 409 se place sous `eventType`. Un type déjà pris retire l'option du formulaire de création, et la
  raison s'affiche. Le statut se bascule `active` ↔ `disabled`. La suppression passe par une modale de
  confirmation. **`retry_policy_json` n'est ni posé ni affiché** : les défauts de la passerelle
  s'appliquent. **Changer l'URL** n'a pas d'écran : la route BFF le permet, mais rien ne le demande
  encore. Supprimer puis recréer le webhook en tient lieu, avec un nouveau secret.
- **Secret de webhook : invariant (b).** Le contrat le déclare en écriture seule. **C'est le BFF qui
  l'engendre** (`crypto/rand`, 32 octets, base64url) à la création et à la rotation (`update-webhook`
  avec `secret` seul). Le BFF le rend une seule fois, dans un DTO dédié à ces deux réponses. Il ne le
  stocke pas, ne le journalise pas, et le DTO `Webhook` ne porte pas ce champ. La modale « montré une
  fois » naît ici, et step-066 pourra la reprendre. Côté client, les mutations qui reçoivent le secret
  ont un `gcTime` de 0 : sans ça, le secret resterait cinq minutes dans le cache des mutations après la
  fermeture de la modale. Pourquoi l'engendrer : l'invariant dit « montré
  exactement une fois à la création ou à la rotation », ce qui suppose que le système produit le
  secret. Un secret saisi par l'opérateur aurait déjà été vu ailleurs avant d'arriver ici. **La rotation coupe
  net** : le contrat ne prévoit aucune fenêtre de grâce, donc tant que le client n'a pas installé le
  nouveau secret, il rejette les MO/DLR signés. La modale de rotation le dit avant confirmation.
- **« Tout expéditeur doit être enregistré » n'est pas écrit** (arbitré par l'utilisateur le
  03/10/2026) : la règle va de soi pour les opérateurs, et le tableau de bord n'est pas encore en
  production, donc aucune habitude héritée de la politique de sender ID n'existe. La spec §6.19 et le
  tableau d'amendement du plan §4 sont corrigés dans la même PR.
- **Audit** : `account.channels`, `account.smpp_ops`, `webhook.create`, `webhook.update`,
  `webhook.rotate_secret`, `webhook.delete`. L'audit porte la valeur posée, jamais le secret.
  **Pas l'ancienne valeur** : il faudrait relire le compte avant chaque écriture, ce qui ajoute un
  appel et une course, alors qu'aucune autre écriture relayée ne le fait. La valeur précédente se lit
  dans l'issue précédente.
- **Défaut trouvé en route, corrigé à la racine** : `auditRelayed` écrivait le statut HTTP sous la clé
  `status`, et écrasait le statut métier posé par `sender_id.update`, `group.update` et
  `webhook.update`. Il s'écrit désormais `http_status`.
- **Permissions existantes** : `accounts:read` et `accounts:write`. Le catalogue nomme déjà les
  webhooks dans `accounts:write`, donc aucune permission n'est ajoutée.

## Tests
- **godog** (`cmd/dashboard/`, à côté des scénarios comptes) :
  - la fiche sous `accounts:read` est conforme et ne contient aucun `senderIdPolicy` ;
  - les canaux atteignent l'amont, avec un 422 rédigé quand les deux sont coupés ;
  - chaque geste laisse deux événements, et l'issue porte la valeur posée ;
  - un webhook créé ou tourné rend un secret que la passerelle a reçu, et que le journal ne porte pas ;
  - le 409 se place sous `eventType` ;
  - sans `accounts:write`, chaque mutation répond 403 sans appel amont. Une ligne par route : la garde
    parcourt une table, et une ligne retirée ne ferait rougir aucun scénario de famille.
- **Unitaire Go** : le secret engendré a 32 octets d'entropie et deux appels ne donnent pas le même ;
  le DTO `Webhook` sérialisé ne contient pas `secret`.
- **Parcours e2e**, en étendant celui de step-063 : ouvrir le compte créé, couper REST, créer un
  webhook DLR, voir son secret une seule fois, fermer la modale et constater que le secret a disparu
  du DOM.
- **Vitest** : le dernier canal ouvert ne se coupe pas, et l'infobulle explique pourquoi ; la modale
  d'une bascule SMPP nomme la coupure des binds ; celle de la rotation nomme le rejet des MO/DLR
  jusqu'à l'installation du nouveau secret ; après création comme après rotation, le secret quitte le
  DOM et le cache des mutations ; un type de webhook déjà pris ne se propose pas.
- **zodgen** rend les booléens (`TestABooleanBecomesAZodBoolean`) : les corps des canaux et des
  bascules en ont besoin.

## Tableau des mutations

Jouées le 03/10/2026 après un commit, `-count=1`, dans un worktree pour le serveur, avec le fichier
restauré par `cp` pour le client.

| Mutation | Ce qui tombe |
|---|---|
| `CreateWebhook` gardée par `accounts:read` | « sans accounts:write, la création d'un webhook est refusé… » |
| Drapeau `cancel_sm_enabled` absent de l'audit | « régler les opérations laisse sa trace » |
| 409 relayé sans le placer sous `eventType` | « un type d'événement qui a déjà son webhook est refusé sous son champ » |
| Secret versé dans l'audit de création | « créer un webhook rend un secret que la passerelle a reçu, et que le journal ignore » |
| Un autre secret relayé que celui rendu | le même scénario |
| Statut HTTP de nouveau sous `status` | « désactiver un webhook laisse sa trace » |
| Refus du dernier canal relayé tel quel | « couper le dernier canal est refusé en des termes qui disent quoi faire » |
| Secret constant | `TestAWebhookSecretCarriesThirtyTwoRandomBytes` |
| `secret` déclaré dans le DTO `Webhook` | `TestTheListedWebhookDeclaresNoSecret`. La première version du test lisait la sortie, et restait verte : un champ facultatif est `omitempty`. |
| Dernier canal ouvert laissé coupable | `keeps the last open channel open, and says why` |
| `gcTime: 0` retiré à la création | `shows a new webhook secret once, and never again once the dialog is closed` |
| `gcTime: 0` retiré à la rotation | `warns that a rotated secret breaks deliveries, then shows the new one once` (ajouté après la mutation, qui restait verte) |
| Types déjà pris proposés à la création | `offers only the event types that have no webhook yet` |
| Raison métier affichée avant la permission manquante (l'ordre d'avant la revue) | `names the missing permission before the business rule`, rouge sur cet ordre avant le correctif |

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
