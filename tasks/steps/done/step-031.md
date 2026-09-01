# step-031 — Durcissement M1 : ce que la revue garde seule

> **Jalon :** M1 (§6.9) · **Statut :** LIVRÉE
> **Dépend de :** step-026 · **Bloque :** — (aucune step ne l'attend)
>
> *Elle se lit **avant** step-027, dont le numéro la précède : celle-là attend les primitives de M2,
> celle-ci ne dépend d'aucun écran. L'ordre de `todo.md` fait foi, pas le numéro.*

## But
Payer les dettes de M1 que **rien ne garde et qu'aucune step ne rencontrera**. Le dépôt a construit un
filet de mutation dense ; ce qui rend dangereux les quelques endroits où ce filet n'existe pas, c'est
justement qu'on a pris l'habitude de lui faire confiance. Un refactor bien intentionné les défera sans
un seul test rouge.

Elle n'existe que parce que la doctrine du dépôt — *« les défauts sont inscrits dans les steps qui les
rencontrent »* (`plan.md` §2.1) — suppose qu'une step les rencontre. Aucune ne rencontre celles-ci.

## Périmètre (ce que fait CETTE PR)
- **Les trois comparaisons à temps constant** : `hmac.Equal` du sceau de cookie
  (`internal/session/cookie.go`), la boucle non court-circuitée de `MatchRecoveryCode`
  (`internal/mfa/recovery.go`), `subtle.ConstantTimeCompare` (step-021). Une porte, ou trois constats
  déplacés vers une forme qui rougit.
- **Trois valeurs codées en dur qui appartiennent à la configuration validée** : l'entropie de la clé
  de chiffrement TOTP, l'`issuer` de l'URI `otpauth://`, le `displayName` WebAuthn.
- **Les trois branches de course non exercées** : `!consumed` et `!elevated` de `VerifyMfa`, `!found`
  de l'enrôlement.
- **La cible de durée d'argon2id**, qu'aucune porte n'exige : le plancher exécuté porte sur les
  nombres, pas sur le temps, et il est très en dessous du profil retenu.

### Trois affirmations de cette fiche que la mesure a corrigées

*Relues le 01/09/2026, avant d'écrire une ligne de code. Une step qui code contre un énoncé faux paie
deux fois.*

| Ce que la fiche écrivait | Ce que la mesure rend |
|---|---|
| l'appel à `VerifyDummy` n'est exigé par aucune porte | **la porte existe** — `internal/auth/oracle_test.go:31`, livrée par step-021 ; seule la cible de durée reste sans garde |
| la variable nouvelle se pose « dans le compose de développement » | `docker-compose.yml` ne déclare aucun `DASHBOARD_*` ; le pendant réel est `.env.example`, gardé par `dotenv_test.go` |
| « les trois branches de course » | la famille est plus large : `bff/webauthn.go` et `mfa/webauthn.go` en portent la forme à **huit sites**, livrés par step-024, que step-023 ne pouvait pas nommer — non audités un à un, un décompte au grep se trompant |

### Sept dettes que cette step hérite

*Écrites ici et non seulement dans `steps/done/`, parce qu'une fiche archivée n'est ouverte par
personne. Les sept figurent au registre de `todo.md`.*

- **Les trois comparaisons à temps constant ne sont gardées que par la revue, et c'est mesuré deux
  fois.** `cookie.go` l'écrit depuis le 10/08/2026 ; `recovery.go` depuis le 12/08. **Remesuré le
  30/08/2026, après step-025 et step-026, puis complété le 31/08 sur la troisième** : remplacer
  `hmac.Equal` par `string(a) != string(b)` laisse les **quatorze paquets verts** ; remplacer
  `matched = index` par `return index` aussi ; remplacer `subtle.ConstantTimeCompare` par `==` aussi.
  Les quatre portes statiques neuves n'y changent rien.

  *La première rédaction de cette fiche annonçait « les trois mutations sont vertes, et c'est
  mesuré » alors que deux l'avaient été. La troisième l'a été le 31/08 — et son premier essai ne
  compilait pas, `crypto/subtle` devenant un import inutilisé : le `rc=1` disait « le paquet ne
  compile pas », pas « la garde tient ».*

  **La voie était nommée par le code lui-même** — `internal/auth/authenticator.go` annonçait « une
  porte structurelle est possible […] elle appartient à la step qui reprendra ce chemin », et aucune
  ne le reprenait. C'est celle-ci. *(Cette phrase a disparu du commentaire avec sa correction : elle
  y côtoyait une affirmation sur `VerifyDummy` que la mesure a démentie.)*

- **`minimumTOTPEncryptionKeyLength` compte des caractères, pas de l'entropie.** « Trente-deux `a` de
  suite passent. Le README recommande un CSPRNG ; rien ne l'applique. » C'est la clé qui chiffre les
  secrets TOTP au repos, et c'est **la dette la moins chère du lot** — une dizaine de lignes dans la
  validation de configuration au démarrage, qui existe déjà.

- **L'`issuer` de l'URI `otpauth://` est codé en dur.** « Deux déploiements du même produit
  apparaissent sous le même nom dans le téléphone d'un opérateur qui enrôle les deux. »

- **Le `displayName` WebAuthn est codé en dur.** step-024 tranche déjà la forme pour les deux : « la
  sortie est une variable de plus, le jour où il y a une préproduction — aucune step planifiée n'en a
  une ». Avec l'entropie de la clé, cela fait trois valeurs et un seul geste, au même endroit.

- **Trois branches de course ne sont exercées par rien**, et la famille est plus large qu'elles.
  `done/step-023.md` : « elles ne sont atteignables que par deux requêtes en vol ou une désactivation
  entre le middleware et le handler. Aucun test ne les exerce, et c'est écrit ici plutôt que couvert
  par un test qui ferait semblant. » `bff/webauthn.go` et `mfa/webauthn.go` en portent la forme à huit
  sites de plus, livrés par step-024 : step-023 lui est antérieure et ne pouvait pas les nommer.

- **Une constante `Key` déclarée sans entrée au catalogue ne fait rougir aucune porte.** step-006 :
  « compile, deux suites vertes, absente du TS engendré. Go ne signale pas une constante exportée
  inutilisée. » Le catalogue est gardé **contre les rôles** — `TestAucuneCleOrphelineHorsDesTrois
  Deliberees` — mais pas contre ses propres constantes, et l'audit des dettes l'avait manqué aussi.

- **La cible de durée d'argon2id n'est exigée par aucune porte.** ~~L'appel à `VerifyDummy` non
  plus~~ — `oracle_test.go` le garde depuis step-021, et le registre l'ignorait. Ce qui reste ouvert
  est le coût : le plancher exécuté est celui d'OWASP, 19 MiB et deux passes, quand le profil retenu
  est 64 MiB et trois passes. Descendre à l'un depuis l'autre divise le temps par 1,6 et laisse tout
  vert.

## Points d'implémentation clés
- **Ce qui manque à la garde des comparaisons n'est pas un test de durée.** Les trois fiches d'origine
  l'écartent pour la même raison — instable en CI, et un écart de l'ordre de la nanoseconde ne prouve
  rien. Ce qui reste est une **porte structurelle** : le type-checker sait dire qu'une comparaison de
  `[]byte` dans un chemin de vérification passe par `hmac.Equal` ou `subtle.ConstantTimeCompare`. Le
  patron existe et il est éprouvé — c'est celui de step-026.
- **Une porte qui refuse du légitime finit retirée** : le périmètre de la règle doit être le **chemin
  de vérification**, pas toute comparaison du dépôt. Le confronter à l'inventaire réel avant de
  l'écrire, comme la règle de `writeJSON` l'a été.
- **Les branches de course admettent trois issues, et la DoD les accepte toutes les trois** : un test
  qui les atteint, leur suppression si elles sont mortes, ou un constat écrit vérifié plutôt que
  supposé. Ce qu'elle n'accepte pas est le silence. Aucune n'est morte, et aucune n'est atteignable
  sans couture : `API.SecondFactor` et `API.Sessions` sont des types concrets.
- **Sortir des valeurs vers la configuration touche le démarrage du binaire.** `make check` ne lance
  jamais le binaire : la variable nouvelle se pose aussi dans `.env.example`, dans les décors des
  scénarios, dans la CI et dans Playwright, sans quoi elle échoue là où personne ne la cherche. Les
  deux derniers sont hors de `make check`.

## Tests (écrits dans la même PR)
- **Mutation, sur les trois comparaisons** : remplacer chacune par sa version naïve doit faire rougir.
  C'est le cœur de la step — les trois sont **vertes** aujourd'hui, chacune mesurée séparément.
- **Une clé de trente-deux caractères identiques est refusée** au démarrage ; une clé tirée d'un CSPRNG
  passe. La borne se teste par ses deux côtés, sans quoi elle refuse tout ou n'importe quoi.
- **Scénario** : l'URI `otpauth://` porte l'`issuer` configuré, pas une constante — un seul scénario,
  parce que la valeur traverse jusqu'au corps servi.
- Pour les branches de course : ce que la forme retenue permet, et le constat écrit là où elle ne
  permet rien.

## Definition of Done
- [x] `make check` vert après chaque commit
- [x] la mutation « `hmac.Equal` → comparaison naïve » fait rougir — elle était **verte** avant
- [x] la mutation « `matched = index` → `return index` » fait rougir — **verte** avant
- [x] la mutation « `subtle.ConstantTimeCompare` → `==` » fait rougir — **verte** avant
- [x] la mutation « constante `Key` hors catalogue » fait rougir
- [x] une clé de trente-deux caractères identiques est refusée au démarrage ; une clé tirée d'un
      CSPRNG passe
- [x] la mutation « profil argon2id ramené au plancher d'OWASP » fait rougir
- [x] la variable nouvelle est posée dans `.env.example`, les décors, la CI et Playwright, pas
      seulement en local
- [x] ce qui reste sans garde est écrit là où il vit, avec la mesure qui l'établit

### Les mutations, et où chacune a mordu

Chacune sur **sa propre** frontière, `-count=1`, lue au code de sortie. Une mutation qui rougit sur
l'assertion d'une autre porte ne prouve rien.

| Mutation | Rouge rendu par | Verte avant |
|---|---|---|
| `hmac.Equal` → `string(a) != string(b)` | `TestLeSceauNeSeCompareQuEnTempsConstant`, seul | oui |
| `subtle.ConstantTimeCompare` → `==` | `TestUnHachageNeSeCompareQuEnTempsConstant`, seul | oui |
| `matched = index` → `return index` | `TestLaBoucleDesCodesDeRecuperationNeCourtCircuitePas`, seul | oui |
| `Inventee Key = "inventee:cle"` hors catalogue | `TestAucuneConstanteNeManqueAuCatalogue`, seul | oui |
| borne de variété retirée de `requiredSecret` | `TestUnSecretSansVarieteEstRefuseSansEtreCite`, seul | oui |
| profil argon2id → 19 MiB / t=2 | `TestLesParametresNeDescendentPasSousLePlancher`, seul | oui |
| `issuer` recodé en dur | le scénario d'enrôlement **et** l'unitaire de l'URI | oui |
| `RPDisplayName` recodé en dur | le scénario d'enregistrement de passkey | **oui — mesuré vert dans cette PR** |

Et les témoins, sans lesquels un renommage rendrait ces portes vertes pour la mauvaise raison : rendre
introuvable la fonction gardée dit « la porte n'a plus de sujet » ; pointer `loopBody` vers une
fonction sans boucle dit « la forme a changé » ; changer `keyTypeName` fait tomber le plancher à zéro.
Les deux gardes de la porte de `mfa` ont été mutées **séparément** — en retirer une seule est vert.

### Ce que la livraison a élargi

- **La borne d'entropie porte les trois secrets**, pas seulement la clé TOTP : elle s'écrit dans
  `requiredSecret`, que les trois traversent, et le README leur promettait déjà la même recette.
- **Le `displayName` WebAuthn est gardé par un scénario**, là où la fiche n'attendait qu'un constat.
  Il n'était gardé par rien — mesuré dans cette PR : le recoder en dur laissait les scénarios verts,
  le nom de partie de confiance ne faisant pas partie des données signées d'une cérémonie. Il atteint
  pourtant le corps servi, donc il se lit.

## Hors périmètre
**La fenêtre d'oubli du compteur glissant, écrite deux fois** — non-attribution rendue le 30/08/2026
avec sa mesure : replier la requête bi-dimension remanierait le chemin consulté avant tout argon2id,
pour un gain de forme. La rouvrir demande une mesure neuve, pas une intuition.

**`request.Body == nil` dans `API.Login`** — garde inatteignable par le routeur, décision consignée.

Le harnais de test → step-032. Le scan transversal de l'invariant (a) → step-103. Les secrets
d'identifiants de bind → step-066. Le journal serveur → step-060.
