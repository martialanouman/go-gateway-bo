# step-065 — `max_sessions`, type de bind et binds ouverts (avertissement d'écart)

> **Jalon :** M3 (plan §8 ; spec §1.1, §6.5) · **Statut :** FAIT
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
  modale Material s'ouvre. Titre : « Limiter ce compte à 2 binds ? ». « Abaisser » serait faux
  quand la limite est déjà sous les binds ouverts et que l'opérateur la remonte un peu. Corps, au
  futur : aucun bind ouvert ne sera coupé, le compte restera au-dessus de sa limite tant que des
  binds ne se fermeront pas, et aucun nouveau bind ne sera admis d'ici là (le registre refuse dès
  que le plafond est atteint, `session/registry.go`). Bouton : « Limiter ». Une limite égale ou
  supérieure s'enregistre sans modale.
- **Badge d'écart** : un `Banner` au-dessus des cartes, sur le modèle de la maquette, titré « 8 binds
  ouverts / limite 4 ». Le client n'avait pas de `Banner` : il est porté du kit
  (`feedback/Banner`), réduit au seul ton dont il a l'usage, le rouge, avec `role="alert"`. Il dit que baisser la limite ne coupe aucun bind, et que pour converger il
  faut déconnecter des binds depuis le moniteur de sessions (jalon M4). La maquette montre aussi un
  bouton « Forcer la convergence », qui relève de step-086 et n'est pas construit ici.
- **Les binds ouverts sont un instantané REST** : ils sont relus après une sauvegarde, mais il n'y a
  ni abonnement `sessions.events` ni déconnexion (step-085, step-086). La copie ne promet pas de
  temps réel.
- **Dette 065 payée** : la modale de suspension d'un client ne promet plus qu'un compte fermé
  repassera suspendu. Elle compte les comptes que la cascade suspendra réellement (le total moins
  les comptes fermés), et dit que les comptes fermés le restent.
- **Refus de saisie numériques** : `zodgen` rend désormais un entier (`z.number().int()` avec ses
  bornes), et `refusalInFrench` rédige ses refus en nombre (« Saisissez un nombre au moins égal à
  0. », « Saisissez un nombre entier. ») et non plus en caractères.
- **Le faux amont du parcours** (`internal/fakegateway`) sert les deux opérations, avec un bind
  ouvert permanent par compte : sans lui, le parcours ne traverserait jamais l'écart.
- **Permissions existantes** : `accounts:read` et `accounts:write`. Aucune n'est ajoutée.

## Tests
- **godog** (`cmd/dashboard/accounts.feature`) :
  - les binds ouverts se lisent sous `accounts:read`, et la réponse est conforme ;
  - `active` vient de la passerelle et non de la longueur de la liste (8 comptés, aucun listé) ;
  - le réglage atteint l'amont avec les deux champs ;
  - le réglage laisse deux événements, et l'issue porte les deux valeurs posées ;
  - sans `accounts:write`, le réglage répond 403 sans appel amont ;
  - sans `accounts:read`, la fiche, les webhooks et les binds répondent 403 sans appel amont.
- **Vitest** :
  - le badge d'écart apparaît quand `active > maxSessions`, nomme les deux chiffres et dit
    qu'aucun bind n'est coupé ; il disparaît à égalité ;
  - des binds comptés mais pas encore listés sont nommés, sans état vide ;
  - abaisser sous les binds ouverts ouvre la modale, qui dit qu'aucun bind ne sera coupé, puis
    enregistre ; « Annuler » et Échap n'enregistrent rien ;
  - une limite égale aux binds ouverts s'enregistre sans modale, et changer le seul type de bind
    aussi ;
  - « Réessayer » relit les binds ;
  - sans `accounts:write`, « Enregistrer » est désactivé et l'infobulle nomme la permission ;
  - les refus numériques sont rédigés en nombre ;
  - la suspension d'un client compte les comptes fermés à part et ne promet aucune réouverture.
- **zodgen** : un entier porte ses bornes (`TestAnIntegerCarriesItsBoundsAndRefusesFractions`).
- **Parcours e2e**, en étendant celui de step-064 : l'onglet « Quotas & sessions », la limite lue
  sur la fiche, puis une limite posée sous le bind ouvert, la modale, et le bandeau d'écart.

## Tableau des mutations

Jouées le 04/10/2026 après commit, `-count=1`, dans un worktree, fichiers restaurés par `cp`. Chaque
motif a été vérifié avant d'être remplacé.

| Mutation | Ce qui tombe |
|---|---|
| `SetAccountSessionLimits` gardé par `accounts:read` | « sans accounts:write, le réglage des sessions est refusé… » |
| `SetAccountSessionLimits` retiré de la table de garde | ce scénario, plus « abaisser la limite atteint la passerelle » et « régler les sessions laisse sa trace » (fermée par défaut) |
| `ListAccountSessions` exempté de permission | « sans accounts:read, la lecture de ses binds ouverts est refusée… ». Ce plan a été **ajouté après la mutation**, qui restait verte, et il couvre aussi la fiche et les webhooks, que rien ne tenait. |
| `allowed_bind_types` absent de l'audit | « régler les sessions laisse sa trace ». Avant la revue, seule `max_sessions` y était affirmée, et la mutation restait verte. |
| `max_sessions` absent de l'audit | le même scénario |
| Limite relayée constante | « abaisser la limite atteint la passerelle » |
| `active` compté sur la liste (BFF) | « les binds ouverts se comptent comme la passerelle les compte… » |
| `maxSessions` absent du DTO de la fiche | parcours e2e, `toHaveValue('1')` : le champ est un `int` toujours sérialisé, et Prism rend 0, donc aucun scénario ne le voit |
| Écart levé à égalité (`>=`) | `raises no flag when the account sits exactly at its limit` |
| Écart jugé sur la longueur de la liste (client) | `counts the binds the gateway counts…`. La doublure rendait `active` égal à la liste, si bien que la mutation restait verte avant la revue. |
| État vide jugé sur la liste | le même test, une fois passé à « 3 comptés, aucun listé » (la première version listait un bind et restait verte) |
| Binds non listés passés sous silence | le même test |
| Modale retirée | `warns before lowering…`, `leaves the limit as it was…` |
| Modale aussi à égalité (`<=`) | `saves a limit equal to the open binds without asking` |
| Modale même sans changement de limite | `saves the bind type the operator picks, without warning…` |
| Type de bind non réglable | le même test |
| « Annuler » enregistre | `leaves the limit as it was when the operator backs out of lowering it` |
| « Réessayer » ne relit rien | `reads the open binds again when the operator retries` |
| « Enregistrer » non gardé | `names the missing permission on the save button` |
| Binds non relus après enregistrement | `warns before lowering…`, `saves a limit equal…` |
| Le bandeau ne dit plus qu'aucun bind n'est coupé | `flags an account above its limit, and says that no bind is cut` |
| La modale ne le dit plus | `warns before lowering…` |
| Refus numériques rédigés en caractères (bas, haut), fraction en refus générique | les trois tests de `a number refused` |
| `integerExpression` sans ses bornes | `TestAnIntegerCarriesItsBoundsAndRefusesFractions` |
| `Select` sans son conteneur `.ui-field` | parcours e2e : écart libellé–déclencheur de 16 px contre 8 pour le champ voisin |
| Identifiant `max_sessions` rendu en capitales | parcours e2e : `text-transform` vaut `uppercase` |
| Suspension : comptes fermés comptés, cas « tous fermés » retiré, comptes fermés tus | `counts the accounts a suspension takes down…`, `says a suspension takes nothing down when every account is closed` |

## Critère 4
- **Contre la vraie passerelle, rien n'est joué** : c'est le même obstacle que pour step-061.
- **« Aucun bind ouvert n'est coupé »** est un comportement de la passerelle (`setSessionLimits`
  n'appelle aucune déconnexion, relu le 04/10/2026). Contre Prism, seule la copie est tenue.

## Definition of Done
- [x] `make check` vert ; `make e2e` vert.
- [x] Invariants (c) et DTO tenus, mutations à l'appui.
- [x] Spec §1.1 et §6.5 amendées ; dette 065 supprimée ; plan et todo annoncent 6.10.1.
- [x] Revue en sous-agent : aucun blocage. Les quatre constats « à corriger » et les cinq mineurs
  sont traités :
  - l'état vide se jugeait sur la liste, alors que la passerelle compte des binds qu'elle ne liste
    pas encore ;
  - la doublure ne distinguait pas `active` de la longueur de la liste ;
  - aucun test ne changeait le type de bind ;
  - la modale s'ouvrait même sans changement de limite, et le toast ne nommait que `max_sessions` ;
  - la copie de suspension avait des fautes d'accord et un présent ;
  - l'audit du type n'était pas affirmé ;
  - `too_big` numérique manquait ;
  - le bloc CSS était mal rangé.

- **Après le test de l'utilisateur dans un navigateur (04/10/2026)**, deux défauts visuels :
  - le libellé `max_sessions` sortait en capitales (« MAX_SESSIONS »), contre la règle de la charte
    qui garde un identifiant verbatim. Il devient « Binds simultanés », suivi de `max_sessions` en mono,
    hors capitales ;
  - le `Select` posait son libellé et son déclencheur comme deux enfants de la grille du formulaire,
    à 24 px l'un de l'autre au lieu de 8. Il les groupe désormais dans un `.ui-field`, ce qui corrige
    aussi le formulaire de création de webhook. La règle de la sous-barre vise ce conteneur.
    Une classe propre aurait fait dépasser à la feuille d'entrée son plafond de 31 octets,
    alors que la réutilisation tient dessous.

## Hors périmètre
- Déconnexion forcée, « Forcer la convergence », mises à jour en deltas : step-085, step-086.
- Limite de débit et catégorie par nom d'expéditeur : step-067.
- Le chiffre des binds dans la modale des opérations SMPP (step-064 le laissait ouvert) : rien ne
  le demande au plan §8.
- Identifiants de bind et clés API : step-066.
