# step-065 — `max_sessions`, type de bind et binds ouverts (avertissement d'écart)

> **Jalon :** M3 (plan §8 ; spec §1.1, §6.5) · **Statut :** EN COURS
> **Dépend de :** step-064 · **Bloque :** step-086

## But
Dans l'onglet « Quotas & sessions » de la fiche compte, un opérateur `accounts:read` voit les binds
ouverts du compte et le rapport « N ouverts / limite M ». Si le compte dépasse sa limite, un badge
d'écart le signale. Un opérateur `accounts:write` règle `max_sessions` et le type de bind admis.
Baisser la limite sous le nombre de binds ouverts déclenche un avertissement, mais le réglage n'est
pas bloqué : la copie dit qu'aucun bind ouvert n'est coupé. Chaque réglage laisse une trace d'audit.

## Décisions (arbitrées sur le contexte, 04/10/2026)
- **Contrat : bump 6.10.0 → 6.10.1 au début de la step.** Le diff du YAML ne touche que des
  `description` : un compte ou un client `closed` le reste, et toute sortie de `closed` est refusée
  en 422. C'est cette version qui porte la règle de la dette 065. Les versions **6.11.0** (publiée le
  03/10 à 19:55 UTC : `first_used_at` des noms d'expéditeur, 409 à leur suppression) et **6.12.0**
  (04/10 à 05:03 UTC : description du jeton opérateur, scope `cdr:export_bulk`) sont encore retenues
  par la quarantaine pnpm, et aucune ne touche aux comptes. L'écart est consigné dans la PR.
- **« Quotas et limites de débit » se réduisent ici à `max_sessions`.** Le contrat appelle lui-même
  `max_sessions` « the max_sessions quota ». Au niveau du compte, il ne porte ni débit ni quota
  journalier. L'ADR-0020 met l'engagement de débit sur le nom d'expéditeur, parce que « le compte est
  un canal technique » : c'est step-067, qui attend le contrat. Les champs « Débit maximum (TPS) »
  et « Quota journalier MT » de la maquette `AccountScreen.jsx` ne sont donc pas construits. La
  spec §1.1 est corrigée dans la même PR.
- **`allowed_bind_types` est une valeur unique**, malgré son nom au pluriel : `tx`, `rx` ou `trx`, et
  la passerelle exige une égalité stricte avec le mode du bind (`smppserver/bind.go`). Le DTO garde
  le nom du contrat (`allowedBindTypes`), pour qu'on puisse le retrouver par grep. L'écran affiche
  la valeur verbatim en mono, à côté de son libellé français.
- **Le DTO `SmppAccount` s'élargit** à `maxSessions` et `allowedBindTypes`.
- **`GET /accounts/{id}/sessions`** relaie `list-account-sessions` sous `accounts:read`. Le DTO
  `AccountSessions` porte `maxSessions`, `active` et une liste `{ id, bindType, remoteAddr,
  connectedAt }`. `pod_id`, `window_size`, `last_enquire_link`, `connector_id` et `direction` (qui
  vaut toujours `user` ici) ne sortent pas : rien ne les affiche. L'écart se calcule sur `active`
  et non sur la longueur de la liste : le contrat prévient qu'un bind admis par un registre plus
  ancien compte dans `active` avant d'apparaître dans la liste.
- **`PUT /accounts/{id}/session-limits`** relaie `set-account-session-limits` sous `accounts:write`.
  Les deux champs sont obligatoires, comme dans le contrat, et `maxSessions` vaut au moins 0. Le
  BFF ne lit **pas** les sessions avant d'écrire, et ne refuse **jamais** une limite basse : la
  baisse est un geste légitime (spec §6.5), et l'avertissement relève du confort, pas d'une garde.
  L'audit `account.session_limits` porte les deux valeurs posées.
- **Avertissement avant sauvegarde** : si la nouvelle limite est inférieure aux binds ouverts, une
  modale Material s'ouvre. Titre : « Abaisser max_sessions à 2 ? ». Corps, au futur : aucun bind
  ouvert ne sera coupé, le compte restera au-dessus de sa limite tant que des binds ne se fermeront
  pas, et aucun nouveau bind ne sera admis d'ici là. Bouton : « Abaisser ». Une limite égale ou
  supérieure s'enregistre sans modale.
- **Badge d'écart** : un `Banner` au-dessus des cartes, sur le modèle de la maquette, titré « 8 binds
  ouverts / limite 4 ». Il dit que baisser la limite ne coupe aucun bind, et que pour converger il
  faut déconnecter des binds depuis le moniteur de sessions (jalon M4). La maquette montre aussi un
  bouton « Forcer la convergence », qui relève de step-086 et n'est pas construit ici.
- **Les binds ouverts sont un instantané REST** : ils sont relus après une sauvegarde, mais il n'y a
  ni abonnement `sessions.events` ni déconnexion (step-085, step-086). La copie ne promet pas de
  temps réel.
- **Dette 065 payée** : la modale de suspension d'un client ne promet plus qu'un compte fermé
  repassera suspendu. Elle compte les comptes que la cascade suspendra réellement (le total moins
  les comptes fermés), et dit que les comptes fermés le restent.
- **Permissions existantes** : `accounts:read` et `accounts:write`. Aucune n'est ajoutée.

## Tests
- **godog** (`cmd/dashboard/accounts.feature`) :
  - les binds ouverts se lisent sous `accounts:read`, et la réponse est conforme ;
  - le réglage atteint l'amont avec les deux champs ;
  - le réglage laisse deux événements, et l'issue porte la limite posée ;
  - sans `accounts:write`, le réglage répond 403 sans appel amont (une ligne de plus dans le plan
    existant).
- **Vitest** :
  - le badge d'écart apparaît quand `active > maxSessions`, nomme les deux chiffres et dit
    qu'aucun bind n'est coupé ; il disparaît à égalité ;
  - abaisser sous les binds ouverts ouvre la modale, qui dit qu'aucun bind ne sera coupé, puis
    enregistre ;
  - une limite égale aux binds ouverts s'enregistre sans modale ;
  - sans `accounts:write`, « Enregistrer » est désactivé et l'infobulle nomme la permission ;
  - la suspension d'un client compte les comptes fermés à part et ne promet aucune réouverture.
- **Parcours e2e**, en étendant celui de step-064 : l'onglet « Quotas & sessions », une nouvelle
  limite enregistrée, et le toast qui la confirme.

## Tableau des mutations
À remplir après implémentation (`-count=1`, worktree pour le serveur, restauration par `cp` côté
client).

## Critère 4
- **Contre la vraie passerelle, rien n'est joué** : c'est le même obstacle que pour step-061.
- **« Aucun bind ouvert n'est coupé »** est un comportement de la passerelle (`setSessionLimits`
  n'appelle aucune déconnexion, relu le 04/10/2026). Contre Prism, seule la copie est tenue.

## Definition of Done
- [ ] `make check` vert ; `make e2e` vert.
- [ ] Invariants (c) et DTO tenus, mutations à l'appui.
- [ ] Spec §1.1 corrigée ; dette 065 supprimée.
- [ ] Revue en sous-agent sans blocage.

## Hors périmètre
- Déconnexion forcée, « Forcer la convergence », mises à jour en deltas : step-085, step-086.
- Limite de débit et catégorie par nom d'expéditeur : step-067.
- Le chiffre des binds dans la modale des opérations SMPP (step-064 le laissait ouvert) : rien ne
  le demande au plan §8.
- Identifiants de bind et clés API : step-066.
