# step-066 — Identifiants : deux cartes masquées, secret une fois, rotation, révocation

> **Jalon :** M3 (plan §8 ; spec §6.14) · **Statut :** À FAIRE
> **Dépend de :** step-064 (modale « montré une fois »), step-065 (binds ouverts du compte), **les correctifs
> d'identifiants de `go-gateway` et le contrat qui les publie** · **Bloque :** —
>
> ⚠️ **Le merge attend la passerelle** (option A, arbitrée par l'utilisateur le 04/10/2026) : la copie
> décrit le comportement **corrigé**. La step se code contre Prism dès maintenant ; le bump du contrat
> se fait **au début de la reprise**, une fois la version publiée sortie de quarantaine, et son diff
> YAML se relit avant le merge.

## But
Dans l'onglet « Identifiants » de la fiche compte, un opérateur `credentials:read` voit **exactement
deux cartes fixes**, « Identifiant SMPP » et « Clé API ». Chacune est masquée en permanence et
n'offre aucune action « révéler ». Un opérateur `credentials:write` crée l'identifiant qui manque, ou
révoque celui qui existe. Un opérateur `credentials:rotate` le fait tourner, avec une fenêtre de grâce.
Le secret engendré par la passerelle apparaît **une seule fois**, dans une modale qu'on ne peut pas
rouvrir. Après sa fermeture, on ne le retrouve ni dans le DOM, ni dans le cache Query, ni dans les
journaux. Chaque écriture laisse une trace d'audit, qui ne contient jamais le secret. La dette 028 est
payée.

## Décisions (arbitrées sur le contexte, 04/10/2026)
- **Contrat : on code contre la 6.10.1, on merge sur la version corrigée.** La version a été relevée au début de la step (API GitHub
  Packages, 04/10/2026 à 14:35 UTC). La 6.11.0 a été publiée le 03/10 à 19:55 UTC, la 6.12.0 le 04/10
  à 05:03 UTC, et la quarantaine pnpm (`minimumReleaseAge: 1440`) retient les deux. Le diff de
  `go-gateway/api/openapi-admin.yaml` depuis la 6.10.1 ne touche à aucune opération ni à aucun
  schéma d'identifiant. L'écart est consigné dans la PR. **Trois correctifs sont demandés à `go-gateway`**
  (prompt transmis le 04/10/2026) : la rotation sans grâce d'un `smpp_bind` coupe ses binds ouverts ;
  révoquer ou désactiver une `api_key` ne coupe plus aucun bind SMPP ; la rotation d'un identifiant
  révoqué le réactive, sans fenêtre de grâce (422 sinon), et répond 409 si son `system_id` a été repris.
- **Ce que la carte affiche** : le type, le `system_id` pour le bind SMPP, le statut, la dernière
  utilisation, la date de création et l'état de rotation (date de la dernière rotation, échéance de
  la grâce). **Aucun fragment du secret** : le contrat ne porte pas de « 4 derniers caractères », et
  la passerelle ne garde qu'une empreinte (argon2id pour le bind, empreinte pour la clé), dont rien
  ne se déduit. La spec §6.14 est amendée dans la même PR. Le `MaskedSecret` du kit est repris sans
  sa ligne `last4`, et sa ligne de points devient un fait « Secret : masqué » : la feuille d'entrée
  n'avait plus la place d'une règle propre (plafond de 36 864 octets bruts, ~70 de marge mesurés), et
  les faits tiennent en une rangée flexible. Le `system_id` n'est pas un secret : c'est l'identifiant de connexion, et le
  contrat le rend dans sa vue masquée.
- **Deux cartes, pas une liste** : la liste du contrat est rangée par `type`. Une carte dont le type
  manque affiche « Aucun identifiant SMPP » (ou « Aucune clé API ») et le bouton « Créer ».
  La passerelle ne rend jamais deux lignes du même type (`credentials_one_per_type_uq`) : l'écran
  prend la première, sans arbitrage qu'aucun test ne pourrait atteindre.
- **Création** (`credentials:write`) : `POST /accounts/{accountId}/credentials` relaie
  `create-credential`. Pour le bind SMPP, une modale demande le `system_id`, de 1 à 15 caractères :
  la borne est engendrée depuis le contrat. La clé API se crée sans saisie, après une modale de
  confirmation. **Le 409 a deux causes que la passerelle ne distingue pas** : le type déjà présent
  sur ce compte (actif ou révoqué), ou, pour un bind SMPP, le `system_id` déjà pris par un autre
  compte (index `credentials_system_id_uq`). Le BFF place donc le refus sous `type` pour une clé API
  (« faites-la tourner ») et sous `systemId` pour un bind SMPP, en nommant les deux causes.
- **Le secret vient de la passerelle**, contrairement au webhook, où c'est le BFF qui l'engendre. Le
  BFF le relaie une seule fois, dans le DTO `CredentialSecret` (`{ credential, secret }`), qui ne sert
  qu'aux réponses de création et de rotation. Le DTO `Credential` n'a pas ce champ. Le BFF ne
  stocke pas le secret, ne le journalise pas et ne le met pas dans l'audit.
- **Le DTO du secret est le seul à porter le champ, et un test le vérifie** (plan §8). On énumère
  tous les types de réponse du paquet `bff` par le type-checker, avec `loadBFF` et
  `responseInterfaces` de `dto_test.go`. Les réponses qui atteignent un champ JSON `secret` doivent
  être exactement les cinq affichages uniques : création et rotation d'un identifiant, création et
  rotation d'un secret de webhook, enrôlement TOTP (`TestOnlyTheOneTimeDisplaysCarryASecret`). Le
  test nomme les types de réponse et non les schémas, parce qu'oapi-codegen redéclare chaque schéma
  sous le nom de sa réponse. Une **liste d'égalité**, et non une liste d'interdits : ajouter un
  `secret` à n'importe quel autre DTO fait rougir le test.
  C'est ce qui paie la **dette 028**, dont le fichier est supprimé.
- **Rotation** (`credentials:rotate`) : `POST /accounts/{accountId}/credentials/{credentialId}/rotate`
  relaie `rotate-credential` avec `grace_period_sec`. Dans la modale, la fenêtre de grâce se choisit
  parmi quatre valeurs : « Aucune », « 1 heure », « 24 heures » (le défaut) et « 7 jours », qui est le
  maximum du contrat (604 800 s). « Aucune » s'envoie `0`, que la passerelle corrigée traite comme
  l'absence de grâce. Le BFF accepte toute valeur de 0 à 604 800, avec la borne du
  contrat.
  **La copie suit la passerelle corrigée.** Bind SMPP sans grâce : l'ancien secret sera refusé
  aussitôt et **les binds ouverts seront coupés** — la modale les chiffre par
  `GET /accounts/{accountId}/sessions`, comme la révocation. Bind SMPP avec grâce : aucun bind n'est
  coupé, l'ancien secret restera accepté jusqu'à l'échéance, qui s'affiche ensuite sur la carte. Clé
  API : aucun bind n'est jamais coupé ; sans grâce, l'ancienne clé sera refusée au prochain appel
  REST. La spec §6.14 dit déjà « une rotation sans grâce coupe les binds vivants » ; seul l'amendement
  écrit au premier commit, qui décrivait la passerelle d'avant les correctifs, est retiré.
  Modale Material : titre « Faire tourner l'identifiant SMPP ? », conséquences au futur, bouton
  « Faire tourner ».
- **Un identifiant révoqué se réactive par rotation, sans grâce.** La carte révoquée propose « Faire
  tourner » ; la modale masque le choix de grâce et dit que l'identifiant redeviendra actif avec un
  nouveau secret, l'ancien restant refusé. Le BFF n'envoie aucune grâce pour ce cas ; le 422 et le 409
  de la passerelle se rédigent en français (« ce system_id est désormais pris par un autre compte »).
- **Révocation** (`credentials:write`) : `DELETE /accounts/{accountId}/credentials/{credentialId}`
  relaie `revoke-credential`. Avant confirmation, la modale relit les binds ouverts par
  `GET /accounts/{accountId}/sessions` (step-065) et chiffre l'impact : « Les 3 binds ouverts de ce
  compte seront coupés » — pour le bind SMPP seulement. **Révoquer la clé API ne coupe aucun bind** :
  la modale dit que tout appel REST avec cette clé sera refusé. Si le chiffre ne peut pas être lu, la
  modale dit que tous les binds ouverts seront coupés, sans chiffre, et la révocation reste possible.
  La ligne est conservée : on ne recrée pas l'identifiant, on le fait tourner pour le réactiver, et la
  modale le dit. Bouton : « Révoquer ».
- **Désactivation** (`update-credential-status`) : aucun écran ne la demande au §6.14. Elle n'est pas
  construite. La carte affiche simplement le statut « Désactivé » s'il arrive.
- **La modale « montré une fois »** de step-064 devient un composant partagé, `SecretShown` (titre et
  consigne en paramètres), que reprennent le webhook et les deux identifiants. Les mutations qui
  reçoivent un secret ont `gcTime: 0`. Le secret ne vit que dans l'état local du composant de page
  (`pending`), et cet état est remis à `null` à la fermeture.
- **Garde** : `ListCredentials` exige `credentials:read`, `CreateCredential` et `RevokeCredential`
  exigent `credentials:write`, et `RotateCredential` exige `credentials:rotate`. Aucune permission
  n'est ajoutée. Seuls `Clientèle` et `Propriétaire` détiennent `credentials:*`, et les deux
  détiennent `accounts:read`, dont la relecture des binds a besoin.
- **Audit** : `credential.create` (`account_id`, `type`, `system_id`), `credential.rotate`
  (`account_id`, `grace_period_sec`) et `credential.revoke` (`account_id`). Le secret n'y figure
  jamais.
- **Le code du client** sort de la route, déjà longue de 1 040 lignes : l'onglet vit dans
  `web/src/components/account-credentials.tsx`.
- **Défaut trouvé en route, corrigé à la racine** : un `Button` bloqué ne transmettait pas ses
  autres props, si bien qu'un `aria-label` disparaissait dès que l'action était interdite. Les
  boutons de webhook d'un opérateur sans `accounts:write` étaient déjà touchés.
- **Le faux amont** (`internal/fakegateway`) sert les quatre opérations comme la passerelle corrigée,
  avec un secret aléatoire par appel. Son motif de route à trois segments `{webhookId}` devient
  `{itemId}`, partagé avec les identifiants. Le parcours e2e peut ainsi créer, faire tourner et révoquer.
- **Le diagnostic d'échec de bind n'est pas construit** : aucune opération du contrat 6.10.1 ne rend
  les échecs d'authentification. Il est reporté à une nouvelle ligne, **step-069**, dans
  `tasks/todo.md`, ⚠️ en attente du contrat. Le plan §8 et la spec §6.14 le disent.

## Ordre d'implémentation (un commit vert chacun)
1. Fiche, todo (step-069), spec §6.14 amendée.
2. `api/openapi-bff.yaml` : quatre routes, `Credential`, `CredentialSecret`, `CredentialCreation`,
   `CredentialRotation`, et les réponses 404 « identifiant inconnu », 409 « type pris » et 409
   « system_id repris » (rotation d'un révoqué). Puis
   `make generate`.
3. Scénarios godog **rouges** dans `cmd/dashboard/credentials.feature`.
4. `internal/bff/credentials.go` : handlers, DTO, garde, audit. Les scénarios passent au vert.
5. Test d'égalité des DTO à secret dans `internal/bff/dto_test.go`, et suppression de la dette 028.
6. Client : `SecretShown` extrait, `account-credentials.tsx` et ses tests Vitest, écrits rouges
   d'abord.
7. Faux amont et parcours e2e étendu.
8. Mutations, DoD, `git mv` de la fiche et case cochée.

## Tests
- **godog** (`cmd/dashboard/credentials.feature`) :
  - la liste se lit sous `credentials:read`, et aucun identifiant de la réponse ne porte de secret ;
  - la création atteint l'amont avec le type et le `system_id`, et rend le secret une seule fois ;
  - la rotation atteint l'amont avec `grace_period_sec` ;
  - chaque écriture laisse sa trace d'audit, et aucune ne contient le secret rendu ;
  - sans `credentials:write`, la création et la révocation répondent 403 sans appel amont ;
  - sans `credentials:rotate`, la rotation répond 403 sans appel amont, même avec
    `credentials:write` ;
  - sans `credentials:read`, la liste répond 403 sans appel amont.
- **Go unitaire** : seuls `CredentialSecret`, `WebhookSecret` et l'inscription TOTP portent un
  champ `secret`.
- **Vitest** (`account-credentials.test.tsx`) :
  - deux cartes, même quand la passerelle n'en rend qu'une ou aucune ; une carte absente propose
    « Créer » ;
  - aucune carte n'expose de bouton « révéler » ni de fragment de secret ;
  - après la création ou la rotation, le secret s'affiche une fois. Après « J'ai copié le secret »,
    il n'est plus dans le DOM ni dans le cache des mutations ;
  - la modale de rotation propose la grâce, avec 24 heures par défaut, et envoie la valeur choisie ;
    pour le bind SMPP, « Aucune » chiffre les binds qui seront coupés, une grâce dit qu'aucun ne l'est ;
    pour la clé API, aucune copie ne parle de binds ;
  - la modale de révocation du bind SMPP chiffre les binds coupés, et reste utilisable quand le
    chiffre ne peut pas être lu ; celle de la clé API ne parle d'aucun bind ;
  - une carte révoquée propose la rotation sans choix de grâce, n'envoie aucune grâce, et dit que
    l'identifiant redeviendra actif ;
  - sans `credentials:write` ou `credentials:rotate`, chaque bouton est désactivé et nomme la
    permission qui manque.
- **Parcours e2e**, en étendant celui de step-065 : l'onglet « Identifiants », la création du bind
  SMPP, le secret affiché puis introuvable, la rotation avec grâce, l'échéance sur la carte, la
  révocation.

## Tableau des mutations
*(À remplir après commit, `-count=1`, dans un worktree, restauration par `cp`.)*

## Critère 4
- Contre la vraie passerelle, rien n'est joué : c'est le même obstacle que pour step-061.
- Les coupures de binds (rotation sans grâce, révocation du bind SMPP), leur absence pour la clé API
  et la réactivation par rotation sont des comportements de la passerelle **corrigée** : à relire dans
  son code au moment du bump, avant le merge. Contre Prism, seule la copie est tenue.
- « Introuvable dans les journaux » : le secret ne traverse aucun appel au logger du BFF, ce qui se
  vérifie par lecture du handler. Aucun test ne capture la sortie du journal pour ce champ.

## Definition of Done
- [ ] `make check` vert ; `make e2e` vert.
- [ ] Invariants (b) et (c), et DTO tenus, mutations à l'appui.
- [ ] Correctifs `go-gateway` mergés, contrat bumpé, diff YAML relu.
- [ ] Spec §6.14 amendée ; dette 028 supprimée ; step-069 inscrite.
- [ ] Revue en sous-agent : aucun blocage.

## Hors périmètre
- Diagnostic d'échec de bind : step-069, en attente du contrat.
- Désactivation et réactivation d'un identifiant (`update-credential-status`).
- Rotation automatique : la spec n'en prévoit aucune.
- Déconnexion forcée d'un bind : step-086.
