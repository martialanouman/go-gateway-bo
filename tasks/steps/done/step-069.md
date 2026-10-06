# step-069 — Diagnostic d'échec de bind : les refus récents d'un compte

> **Jalon :** M3 (plan §8 ; spec §6.14) · **Statut :** FAIT
> **Dépend de :** step-066 (onglet « Identifiants »), **contrat 7.3.0** · **Bloque :** —

## But
Dans l'onglet « Identifiants » de la fiche compte, un opérateur `credentials:read` voit les binds
SMPP que la passerelle a refusés à ce compte ces dernières 24 heures : l'heure, l'IP source, le type
de bind, ce que l'ESME a lu (`command_status`) et la cause réelle. La cause départage ce que
`ESME_RINVPASWD` confond : un mot de passe faux, un identifiant révoqué et le verrouillage
anti-force brute. Quand la liste est vide, l'écran dit ce qu'elle ne peut pas montrer : un bind sous
un `system_id` inconnu n'est rattaché à aucun compte.

## Décisions (arbitrées sur le contexte, 06/10/2026)
- **Contrat : on reste en 7.3.0.** Relevé au début de la step (API GitHub Packages, 06/10/2026 à
  14:29 UTC) : 7.3.1, 7.4.0 et 7.5.0 sont publiées depuis ce matin, et la quarantaine pnpm les
  retient. Le diff de `openapi-admin.yaml` entre 7.3.0 et 7.5.0 a été relu. Il ne touche pas
  `list-account-bind-failures` ni `BindFailure` : il ajoute `traffic_category` et `priority` aux
  CDR, un filtre `traffic_category`, `priority_flag_default` aux connecteurs, et des `description`.
  L'écart est consigné dans la PR.
- **`GET /accounts/{accountId}/bind-failures`** relaie `list-account-bind-failures` sous
  `credentials:read`. La spec range le diagnostic dans l'écran des identifiants (§6.14,
  `credentials:*`). Le scope amont `admin:read` est déjà celui du jeton machine. La route est une
  lecture : pas d'audit (invariant c : mutations seulement).
- **Le DTO `BindFailure`** porte `at`, `remoteIp`, `bindType`, `commandStatus` et `reason`, les cinq
  champs du contrat, tous requis. Le contrat garantit qu'il ne porte jamais le secret présenté, et le
  DTO déclaré le garantit aussi côté BFF (invariant b). La réponse est un tableau nu, comme
  `listCredentials`.
- **`since` n'est pas relayé.** Sa valeur par défaut est la rétention entière (24 h). Aucun écran ne
  demande une fenêtre plus courte.
- **`reason` et `commandStatus` reprennent les `enum` du contrat.** Une valeur que la passerelle
  ajouterait traverserait le BFF sans être refusée (le type engendré est une chaîne), et le client
  l'afficherait telle quelle, en mono, faute de libellé.
- **L'écran** suit la maquette `AccountScreen.jsx` : une carte pleine largeur « Diagnostic d'échec
  de bind », et une table dense « Horodatage / IP source / Type /
  Lu par l'ESME / Cause ». Le code `command_status` reste verbatim en mono, et la cause s'affiche
  en français :
  `password_mismatch` « Mot de passe refusé » (le contrat y range aussi une empreinte stockée
  illisible : « erroné » mentirait), `credential_revoked` « Identifiant révoqué »,
  `credential_disabled` « Identifiant désactivé », `account_inactive` « Compte ou client
  inactif », `smpp_channel_disabled` « Canal SMPP désactivé », `bind_type_not_allowed` « Type de bind
  non admis », `max_sessions_exceeded` « Limite de binds atteinte », `throttled` « Verrouillage
  anti-force brute », `registry_unavailable` « Registre des sessions indisponible ».
- **État vide** : « Aucun bind refusé », et la description dit la frontière : seuls les binds sous un
  `system_id` de ce compte y figurent, et un bind sous un `system_id` inconnu n'apparaît nulle
  part. La rétention tient dans le sous-titre, « 24 dernières heures · 200 refus au plus » : une
  rafale peut évincer les plus anciens.
- **La carte a son propre état** de chargement et d'erreur : une passerelle qui refuse la lecture du
  diagnostic ne masque pas les deux cartes d'identifiants.
- **Instantané REST.** La liste n'est pas suivie en direct : elle se relit en rouvrant l'onglet,
  et une révocation, qui invalide déjà toutes les clés du compte, la relit aussi.
- **Clé de ligne par position** : deux refus d'une même rafale partagent souvent l'heure, l'IP et la
  cause, et le contrat ne leur donne pas d'identifiant.
- **Faux amont** (`internal/fakegateway`) : il sert un refus permanent `throttled` par compte, sur
  le modèle du bind ouvert permanent de step-065. Le parcours e2e lit sa cause sous l'onglet
  « Identifiants ».

## Fichiers
- `tasks/plan.md` §8, `docs/specification-technique-tableau-de-bord.md` §6.14 : « attend le
  contrat » retiré.
- `api/openapi-bff.yaml` : la route, `BindFailure`.
- `cmd/dashboard/credentials.feature` et ses steps : les scénarios rouges.
- `internal/bff/credentials.go`, `guard.go` : le handler et sa garde.
- `internal/fakegateway/customers.go` : le refus permanent.
- `web/src/components/account-credentials.tsx` et son test.
- `web/e2e/shell.spec.ts` : le parcours étendu.

## Ordre d'implémentation (un commit vert chacun)
1. Fiche ; plan et spec.
2. `api/openapi-bff.yaml` et `make generate`. Scénarios godog **rouges** :
   - le diagnostic se lit sous `credentials:read`, et la réponse est conforme ;
   - la cause et le code lu par l'ESME viennent de la passerelle (un refus `throttled` sous
     `ESME_RINVPASWD`) ;
   - sans `credentials:read`, la lecture répond 403 sans appel amont.
3. Handler et garde : les scénarios passent au vert.
4. Client : la carte, ses états, les libellés. Tests Vitest écrits rouges d'abord.
5. Faux amont et parcours e2e étendu.
6. Mutations, DoD, `git mv` de la fiche et case cochée.

## Tests (les risques, et la preuve de chacun)
- **Garde absente** → scénario 403 sans appel amont. Mutation : retirer l'entrée de `guard.go` (la
  garde est fermée par défaut, donc la lecture légitime rougit aussi), puis l'exempter de
  permission.
- **Mapping du DTO perdu** (la cause, le code lu, l'IP) → un scénario dont l'amont sert un refus
  connu, et dont l'`Alors` lit les valeurs rendues. Mutation : relayer une cause constante.
- **`throttled` confondu avec un mot de passe faux** → Vitest : la ligne porte « Verrouillage
  anti-force brute » à côté de `ESME_RINVPASWD`. Mutation : afficher le code seul.
- **Une liste vide lue comme « personne n'a essayé »** → Vitest : l'état vide nomme le `system_id`
  inconnu. Mutation : retirer la phrase.
- **Une cause inconnue** → Vitest : elle s'affiche telle quelle. Mutation : retirer le repli.
- **Une erreur du diagnostic masque les identifiants** → Vitest : les deux cartes restent, et
  « Réessayer » relit le diagnostic.

## Hors périmètre
- La fenêtre `since` et le suivi en direct.
- Les binds sous un `system_id` inconnu, que le contrat ne rattache à aucun compte.
- Le déverrouillage d'un compte verrouillé par l'anti-force brute : le contrat n'en offre pas.

## Tableau des mutations

Jouées le 06/10/2026 après commit, `-count=1`, dans un worktree jetable. Chaque motif a été vérifié
présent une fois avant d'être remplacé.

| Mutation | Ce qui tombe |
|---|---|
| `ListAccountBindFailures` retiré de la table de garde | les trois scénarios du diagnostic (fermée par défaut) |
| La même, exemptée | « sans credentials:read, la lecture des binds refusés est refusée… » |
| La même, gardée par `accounts:read` | le même scénario |
| Cause relayée constante | « un bind refusé garde la cause que le code lu par l'ESME confond » |
| IP source perdue | le même scénario |
| Code lu par l'ESME constant | le même scénario |
| Cause affichée en code seul | `tells a lockout apart from a wrong password…` |
| Repli d'une cause inconnue retiré | `shows a cause the dashboard has no label for…` |
| Phrase du `system_id` inconnu retirée | `says that a bind under an unknown system_id shows up nowhere` |
| « Réessayer » ne relit rien | `keeps both credential cards when the diagnosis cannot be read…` |
| Carte retirée | les quatre tests du diagnostic |

