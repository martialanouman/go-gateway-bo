# step-060 — Groupes de clients : CRUD et écran

> **Jalon :** M3 (spec §6.15) · **Statut :** À FAIRE
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

## Critère 4 — ce qu'aucun test ne garde
À écrire à la clôture, là où il vit.

## Definition of Done
- [ ] `make check` vert, `make e2e` vert.
- [ ] Invariants (a…e) ; (c) : garde et audit sur chaque mutation.
- [ ] Copie conforme à la charte, relue contre le code serveur (critère 2) ; WCAG 2.1 AA sur l'écran.
- [ ] Critère 4 écrit.

## Hors périmètre
- Nombre de clients membres (contrat), porteur step-061.
- Liste des membres d'un groupe et filtre par groupe : step-061 (`/customers?groupId=`).
- Affectation d'un client à un groupe : step-062.
- Ventilation de trafic par groupe : M4.
