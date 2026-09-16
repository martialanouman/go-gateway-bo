# step-033 — Audit atomique des actions locales

> **Jalon :** M1 (§6.10, §3.1) · **Statut :** À FAIRE
> **Dépend de :** step-025, step-031 · **Bloque :** step-029
>
> *Issue de l'audit du 16/09/2026. Elle se lit **avant** step-029, qui ajoute une dizaine de
> mutations d'opérateurs et de rôles : chacune hériterait sinon du défaut ci-dessous.*

## But
Une action locale et sa ligne d'audit réussissent ensemble ou échouent ensemble. Aujourd'hui, c'est
faux : l'action est validée dans sa propre transaction, puis `API.audited` écrit par `Audit.Record`
sur le pool. Si cette seconde écriture échoue, la route rend 500, l'action reste faite et aucune trace
n'existe. C'est la moitié « audit » de l'invariant (c).

## Constats de l'audit
| Où | Ce qui se passe |
|---|---|
| `internal/bff/mfa.go:141` puis `:155` | `SecondFactor.Enroll` valide le facteur, puis l'audit `mfa.enroll` est tenté. Avec `replace=true`, un audit en échec a détruit l'ancien TOTP et ses dix codes, et le nouveau secret n'est jamais montré. |
| `internal/bff/webauthn.go:105` puis `:123` | Une passkey est enregistrée sans trace si l'audit `passkey.register` échoue. Le client lit un échec ; un nouvel essai rend 401 « déjà enregistrée ». |
| `internal/bff/webauthn.go:216` puis `:229` | Une passkey est retirée sans trace si l'audit `passkey.remove` échoue. |
| `mfa.go:269-286`, `me.go:76-80`, `auth.go:117-124` | Même forme, conséquence moindre : élévation, déconnexion et connexion. |
| `internal/store/audit.go:105-116` | `RecordTx` existe et n'a **aucun appelant en production**. |
| `internal/store/audit_test.go` | `TestUnAuditAnnuleAvecSaTransactionNeLaissePasDeTrace` n'a pas de témoin : `RecordTx` remplacé par `return nil` le laisse vert. |
| `internal/bff/audit.go:51` et `:57` | Deux commentaires démentis : « si un journal est branché » (un `Audit` nil panique) et « une action qui ne peut pas être tracée n'a pas eu lieu ». |
| `me.go:80`, `webauthn.go:123` | Placer l'appel d'audit dans un `if false {}` laisse toute la suite verte : la porte d'énumération est textuelle, et aucun scénario ne compte `operator.logout` ni `passkey.register`. |
| `cmd/dashboard/audit_test.go:71` | Le pas « l'événement porte l'adresse de l'appelant » ne vérifie que `ip_address IS NOT NULL` : une adresse forgée constante passe. |

## Périmètre (ce que fait CETTE PR)
- Les écritures de `store` appelées par ces six handlers reçoivent l'événement d'audit et l'écrivent
  par `RecordTx`, **dans leur transaction**. L'échec de l'audit annule l'action.
- `audited` sur le pool disparaît des chemins locaux ; il ne reste que pour ce qui n'a pas de
  transaction propre, s'il en reste, et c'est écrit.
- Le témoin de `TestUnAuditAnnuleAvecSaTransactionNeLaissePasDeTrace` : la ligne est lue **avant** le
  rollback.
- Les scénarios comptent `operator.logout` et `passkey.register` après l'action, pas seulement leur
  absence après l'ouverture d'une cérémonie.
- Le pas d'adresse compare l'adresse écrite à celle que le décor a présentée.
- Les deux commentaires de `audit.go` disent ce que le code fait.

## Points d'implémentation clés
- **Qui ouvre la transaction.** `store.MFA.Enroll` et `store.Passkeys.Remove` ouvrent déjà la leur :
  l'événement y entre en paramètre. Ne pas remonter la transaction jusqu'au handler — `internal/bff`
  ne manipule pas `pgx.Tx` aujourd'hui, et ce n'est pas le moment de commencer.
- **La déconnexion est la seule exception, et elle s'écrit.** Recommandation retenue le 16/09/2026 :
  la session est supprimée même si l'audit échoue, et la route rend 500. Un opérateur qui croit être
  parti et reste connecté court un risque plus grave qu'une déconnexion absente du journal. Si la PR
  trouve un argument contraire, consulter Fable plutôt que trancher seul.
- **L'enrôlement WebAuthn passe par la bibliothèque** : vérifier que l'écriture de la passkey et son
  audit peuvent partager une transaction sans déplacer la vérification de la cérémonie.
- **Hors transaction et assumé** : le trou d'audit du proxy (step-060), dont l'action vit chez la
  passerelle. Ce n'est pas le même défaut, ne pas les fusionner.

## Tests (écrits dans la même PR)
- **Scénario rouge d'abord** : la partition d'audit du mois courant est détachée, un remplacement de
  TOTP est tenté → refus, l'ancien facteur est toujours en place, aucune ligne n'est écrite. Idem pour
  l'enregistrement et le retrait d'une passkey.
- **Mutation** : rétablir `Record` sur le pool dans chacun des trois handlers principaux → rouge,
  chacun séparément.
- **Mutation** : `if false {}` autour de l'audit de `Logout` et de `FinishWebauthnRegistration` →
  rouge.
- **Mutation** : `RecordTx` rend `nil` → rouge. **Mutation** : adresse forgée constante → rouge.

## Hors périmètre
Le trou d'audit du proxy → step-060. La trace des refus 403 → step-029. Le journal serveur →
step-060.

## Definition of Done
Elle vit dans `CLAUDE.md`.
