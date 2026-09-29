# step-060 — Groupes de clients : CRUD et écran

> **Jalon :** M3 (spec §6.15) · **Statut :** FAIT
> **Dépend de :** step-059 · **Bloque :** step-061

## But
Un opérateur `groups:write` crée, renomme, décrit, archive et supprime un groupe de clients depuis
l'écran Groupes, qui n'est aujourd'hui qu'un `PendingScreen`. Un opérateur `groups:read` le consulte.
Chaque mutation laisse sa trace d'audit par le mécanisme de step-059, et un refus de validation
s'affiche sous le champ fautif, depuis `errors[]`.

## Décisions (arbitrées, ne pas rouvrir)
- **Pas de colonne « nombre de clients membres ».** La spec §6.15 la demande, mais le contrat 6.9.0
  n'expose aucun compteur sur `CustomerGroup`, et `list-group-customers` est paginé sans total.
  Compter côté BFF coûterait N×pages appels par affichage, sans borne (invariant e). Le manque se
  corrige par une PR dans `go-gateway/api/` ouverte pendant cette step, et une dette nomme la colonne
  absente, avec step-061 pour porteur : elle relève le contrat en ouvrant. *Arbitré le 28/09/2026
  avec l'utilisateur.*
- **Le filtre par groupe naît avec son premier consommateur**, la liste des clients de step-061,
  puis avec chaque écran qui l'utilise. Un sélecteur sans appelant serait du code mort. *Arbitré le
  28/09/2026 avec l'utilisateur.* L'affectation d'un client à un groupe (`set-customer-group`, le
  « sélecteur unique » du §6.15) vit sur la fiche client, en step-062.
- **La description ne peut pas être vidée**, et l'écran le dit. La passerelle traite un
  `PATCH { "description": null }` comme « ne change pas » : dette `patch-null-ne-peut-pas-effacer-
  un-champ` de `go-gateway`, `update-customer-group` nommé. Un champ vidé qui rendrait 200 sans rien
  effacer serait un succès menteur. Le BFF refuse donc une description vide en 422 avec
  `errors[description]`, et l'éditeur explique pourquoi (contrôle interdit, désactivé et expliqué).
- **Archiver, c'est `PATCH status: archived`** ; désarchiver le rétablit. La liste montre les groupes
  actifs par défaut et les archivés sur filtre (`status`, déjà relayé par step-059).
- **Supprimer est non destructif, et la confirmation le dit** : les clients membres sont détachés et
  aucun n'est supprimé (contrat : « detaches customers, group_id -> null »). Sans compteur, la copie
  ne chiffre pas l'impact.
- **Permissions existantes** : `groups:read` pour lire, `groups:write` pour les trois mutations et
  l'archivage. Aucune clé nouvelle.
- **Audit** : `group.create`, `group.update`, `group.delete`, par `auditRelayed` (step-059). Un
  archivage est un `group.update` dont l'état après porte `status`.

## Périmètre (ce que fait CETTE PR)
- **Contrat Admin** : version relevée au premier commit, écart consigné dans la PR, relecture du diff
  YAML de `customer-groups`.
- **Contrat BFF** : `POST /customer-groups`, `GET|PATCH|DELETE /customer-groups/{groupId}`, avec DTO
  déclarés ; 404, 409 (nom déjà pris), 422 à `errors[]`, rédigés en français.
- **Serveur** : quatre handlers gardés et audités ; mapping des refus amont.
- **Client** : écran `/groups` avec liste (nom, description, statut, date de création), filtre
  actif/archivé, création et édition en formulaire (`errors[]` placés par `setError`, la couture de
  step-049), archivage, suppression confirmée, contrôles interdits désactivés et expliqués
  (`Button blockedReason`) ; les cinq états de contenu (§1.9).
- **Hors dépôt** : PR `member_count` dans `go-gateway/api/`, liée depuis la PR de cette step.
- **Dette** : « la liste des groupes n'affiche pas le nombre de membres », porteur step-061.

## Tests (écrits dans la même PR)
- **godog (`internal/bff`, contre Prism)** : création → ligne d'audit `group.create` ; opérateur sans
  `groups:write` → 403 sur chaque mutation, sans appel amont ; description vide refusée en 422
  `errors[description]` sans appel amont ; suppression → 204 et audit `group.delete`.
- **Parcours e2e (critère 1)**, en étendant un parcours existant : un opérateur crée un groupe,
  l'archive, le retrouve sous le filtre « archivés », le supprime.
- **Client (Vitest)** : un 422 à `errors[]` place le message sous le champ nommé, pas en bandeau ;
  bouton désactivé et raison lisible pour un opérateur `groups:read`.
- **Mutations** (tableau à la clôture) : garde `groups:write` retirée d'une route ; refus de la
  description vide retiré ; `setError` débranché (message global) ; audit retiré d'une mutation.

## Écarts à la rédaction, arbitrés pendant l'implémentation
- **Contrat Admin : 6.9.0**, dernière version publiée au 29/09/2026 ; aucun écart, aucun bump. Diff
  YAML de `customer-groups` relu : `CustomerGroupCreate` et `CustomerGroupUpdate` sont en
  `additionalProperties: false`, `name` en `minLength: 1`, et `delete-customer-group` ne déclare
  aucun 409.
- **Une description vide à la création est omise, pas refusée** : il n'y a rien à effacer. Le 422
  `errors[description]` ne vaut que pour `PATCH`.
- **Le 409 place son refus sous `name`** (`errors[]`), rédigé en français ; le `code` reste celui de
  la passerelle. Le 404 aussi est rédigé ici.
- **Un `groupId` qui n'est pas un UUID est un groupe inconnu (404), sans appel amont** : la passerelle
  le refuserait en 422 sur le format.
- **`auditRelayed` passe l'événement à l'appel**, pour que l'issue d'une création porte l'identifiant
  que seule la réponse connaît. L'intention part sans cible.
- **`orRefusal` transmet `errors[]`** avec l'erreur (`fieldRefusalsOf`) : c'est l'appel à `setError`
  que step-049 avait laissé à brancher. Le bandeau ne s'affiche que si aucun refus n'a trouvé son
  champ.
- **Le faux amont des parcours sert le CRUD des groupes en mémoire** (`internal/fakegateway/groups.go`)
  : Prism, sans état, ne retrouverait pas sous « Archivés » le groupe que le parcours vient
  d'archiver. Le parcours ne simule rien du produit ; le faux amont est la frontière, comme Prism.
- **« Module désactivé » ne s'applique pas** : les groupes ne sont pas un module de la passerelle. Un
  503 est une erreur à réessayer, jamais une dégradation.
- **La PR `member_count` dans `go-gateway` n'est pas ouverte par cette step.** Dans ce dépôt,
  contrat et handler arrivent dans la même PR, avec bump du paquet de contrats : c'est une step de
  `go-gateway`, dont le prompt a été remis à l'utilisateur le 29/09/2026. La dette 062 en garde le
  déclencheur.

## Tableau des mutations

Jouées le 29/09/2026, après un commit, fichier restauré par `cp`, `go test -count=1`.

| Mutation (le défaut réel qu'elle rejoue) | Ce qui tombe |
|---|---|
| `DeleteCustomerGroup` gardée par `groups:read` au lieu de `groups:write` | « sans groups:write… » exemple DELETE |
| Refus de la description vide retiré de `PATCH` | « une description vidée est refusée sous son champ… » |
| `setError` débranché, le refus servi en bandeau | `places a field refusal from errors[] under the field it names, not in a banner` |
| La création relayée sans écrire au journal (enregistreur muet) | « créer un groupe laisse sa trace… » — **`TestEveryMutationLeavesATrace` reste vert** : il reconnaît l'appel qui porte un `store.Event`, pas l'écriture |
| L'identifiant du groupe créé non posé sur l'issue | « créer un groupe… » par « l'issue "group.create" désigne le groupe que la réponse rend » |
| Focus non rendu au titre après archivage | `archives a group, which moves under Archivés, and gives focus back to the title` |
| Contrôles non bloqués sans `groups:write` | `disables and explains every change for an operator who only reads groups` |
| Journal en panne relu comme une passerelle injoignable (503) | « une création dont l'intention ne peut pas s'écrire… » — scénario écrit après le correctif, rouge sous la mutation |
| Liste rendue hors du panneau d'onglet | `creates a group from the archived tab…` (lit la cellule dans le `tabpanel`) — la première rédaction, qui retirait tout le contenu, faisait tomber les dix tests et ne rejouait pas le défaut |
| Création sans retour sur « Actifs » | `creates a group from the archived tab…` |
| Édition sans changement envoyée (`PATCH {}`) | `sends nothing when an edit changes nothing` |

## Revue (sous-agent lecture seule, 29/09/2026)

Traités : un journal en panne rendait 503 « la passerelle… » au lieu de 500 ; onglets sans panneau ;
focus et silence après une création (et création invisible depuis « Archivés ») ; cible d'audit non
canonique (`uuid.Parse` accepte majuscules et `urn:uuid:`) ; `PATCH {}` sur une édition sans
changement ; 409 muet sur un nom pris par un groupe archivé ; description de `RefusDeLaPasserelle`
fausse pour le refus rédigé par le BFF ; « il reste sous Archivés » devenu « il passe » ; porteur de
la PR amont absent de la dette 062.

Écartés, avec leur raison :
- **Un nom fait d'espaces passe** : `minLength: 1` au contrat Admin comme au BFF ; le refuser serait
  une règle que la passerelle ne tient pas. Hors périmètre.
- **201 amont au corps illisible audité `failed`** : `Parse…Response` échoue avant qu'on lise le
  statut ; cas d'un amont hors contrat, l'issue `attempted` + `failed` reste lisible « à vérifier ».
- **Point coloré à côté du statut** : `StatusPill` ne connaît pas `archived` (dimension
  `EntityStatus` du contrat Customer) ; l'étendre est un choix de charte, pas de cette step.
- **Un refus non placé perdu quand un autre l'est** : aucune réponse du contrat ne mêle les deux.
- **Fiche « godog (`internal/bff`) »** : les scénarios vivent dans `cmd/dashboard`, comme ceux de
  step-059 — ils exigent le binaire et le mock. Consigné ici.

## Critère 4 — ce qu'aucun test ne garde
- **Le journal du `Warn` d'un 5xx sur les quatre nouvelles opérations** : seul
  `list-customer-groups` a son scénario de panne ; les autres passent par le même `relayedRefusal`.
- **Un 422 amont relayé sur une mutation** : le mapping est celui de `relayError`, gardé par
  `TestAnUpstreamValidationErrorKeepsItsFields` ; aucun scénario ne le rejoue sur `POST`/`PATCH`.
- **Le libellé du statut reste l'identifiant du contrat** (`active`, `archived`), en mono : aucun
  libellé français ne le remplace, choix de la charte, non testé.

## Definition of Done
- [x] `make check` vert, `make e2e` vert (29/09/2026).
- [x] Invariants : (a) aucune donnée de message ; (b) aucun secret ; (c) garde `groups:read` /
      `groups:write` et `auditRelayed` sur chaque mutation, mutations à l'appui ; (d) le navigateur
      ne parle qu'au BFF ; (e) aucun appel par groupe, la colonne de membres est écartée (dette 062).
- [x] Critère 2 : la copie relue contre `go-gateway` — l'archivage ne touche que `status` (les
      clients gardent `group_id`), la suppression détache par `ON DELETE SET NULL`, un nom pris est
      `ErrConflict` (`internal/storage/postgres/customer_groups.go`).
- [x] Critère 4 écrit ci-dessus.

## Hors périmètre
- Nombre de clients membres (contrat), porteur step-061.
- Liste des membres d'un groupe et filtre par groupe : step-061 (`/customers?groupId=`).
- Affectation d'un client à un groupe : step-062.
- Ventilation de trafic par groupe : M4.
