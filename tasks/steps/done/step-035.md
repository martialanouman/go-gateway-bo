# step-035 — Filet de mutation M1, refus qui nomment ce qui manque

> **Jalon :** M1 (§6.9, §6.10) · **Statut :** À FAIRE
> **Dépend de :** step-032, step-034 · **Bloque :** — (aucune step ne l'attend)
>
> *Issue de l'audit du 16/09/2026. Après step-034, parce que les deux touchent les mêmes fonctions de
> `internal/bff/mfa.go`.*

## But
Chaque garde, refus ou échéance de M1 que l'audit a pu retirer **sans qu'aucun test ne rougisse**
retrouve un test qui la tient, ou un constat écrit qui dit pourquoi aucun test n'est possible. Les
refus qui disent autre chose que ce qui s'est passé sont réécrits.

## Constats de l'audit — mutations survivantes
Chacune a été lancée le 16/09/2026 et a laissé la suite verte.

| Où | Mutation | Pourquoi rien ne rougit |
|---|---|---|
| `internal/bff/webauthn.go:227` | `PasskeyUnknown` rend 204 | le scénario de `mfa-webauthn.feature:234` n'affirme aucun statut |
| `internal/bff/mfa.go:430`, `:463` | quatre contrôles de forme retirés : `presentedFactorIsWellFormed`, exclusion `code`/`assertion` dans les deux sens, `maximumChallengeLength` | seuls « code démesuré » et « méthode inconnue » de la vérification sont testés |
| `internal/bff/guard.go:122` | la panne de résolution de session rend 401 | `withResolvedSession` (`guard_test.go:94`) ne pose jamais d'erreur, et aucune route n'est encore gardée par une clé |
| `internal/store/partitions.go:59` | `return` après le premier passage | le test ne prouve qu'un passage ; « un échec n'arrête pas la boucle » n'est testé par rien |
| `internal/store/mfa.go:323` | `AND now() < expires_at` retiré | son jumeau `ConsumeCeremony` est testé, pas lui |
| `internal/session/cookie.go:67` | `Strict()` retiré | `TestUnSceauNonCanoniqueEstRefuse` ne rougit qu'une fois sur quatre : l'alphabet `A…P` ne produit une variante que si le dernier caractère est A, E, I ou M — **le « une fois sur douze » de l'audit était faux**, refait sur cent mille tirages le 19/09/2026 (24 827 rouges) |

## Constats de l'audit — tests et affirmations
- `internal/session/session_test.go:76` et `cmd/dashboard/session_test.go:88` : « deux bits
  significatifs sur six » est faux. Le dernier caractère en porte quatre ; ce sont les deux autres qui
  ne comptent pas.
- `internal/config/auth_test.go:173` (`TestLesTroisSecretsNeSeConfondentPas`) teste un mapping : `Load`
  n'empêche jamais trois secrets identiques.
- `internal/mfa/manager_test.go:52` est toujours vrai : HKDF n'échoue pour aucune phrase secrète.
- `internal/store/base.feature:10` parle de « huit migrations » ; il y en a neuf.
- `internal/bddtest/postgres.go:218` : `processAlive` lit un processus vivant mais non signalable
  (EPERM) comme mort, et le nettoyage supprime alors une base encore utilisée.

## Constats de l'audit — refus
| Où | Ce que dit le refus | Ce qui s'est passé |
|---|---|---|
| `webauthn.go:227` | « Cette session n'est plus ouverte : reconnectez-vous » | la session est vivante et élevée ; la passkey est inconnue ou appartient à un autre. L'opérateur obéit et perd son élévation. |
| `mfa.go:483-489` (`refusedSecondFactor`) | « Vérifier l'heure de l'application d'authentification » | vaut aussi pour `method=webauthn`, où il n'y a pas d'application TOTP |
| `mfa.go:136-137`, `:383` | 409 « le remplacer demande de franchir d'abord celui qui est en place » | l'opérateur a présenté un code, et c'est ce code qui a été refusé |
| `webauthn.go:108`, `:117` | 401 sur une cérémonie refusée | la session est vivante. Seul le `code` distingue ce cas d'une session fermée : un intercepteur client câblé sur le statut déconnecterait l'opérateur. |

## Périmètre (ce que fait CETTE PR)
- Un test par mutation survivante, chacun **vu rouge** par sa mutation.
- Le test de `Strict()` construit lui-même une variante non canonique, à coup sûr.
- Les affirmations fausses ci-dessus sont corrigées, ou le test qui les porte supprimé s'il ne
  garde rien.
- `processAlive` traite EPERM comme « vivant ».
- Les quatre refus sont réécrits. Le statut du dernier est tranché dans `api/openapi-bff.yaml` et le
  handler dans la même PR.

## Points d'implémentation clés
- **La branche de `guard.go:122`** n'est atteignable qu'avec une route gardée par une clé. Si aucune
  couture honnête ne l'atteint avant step-029, écrire le constat au-dessus de la ligne plutôt qu'un
  test qui ferait semblant.
- **Le 401 d'une cérémonie refusée** : 400, 403 ou 401 avec un `code` distinct. À confronter à ce que
  step-027 attendra de son intercepteur. Un changement de statut se fait dans le contrat du BFF, qui
  vit dans ce dépôt.
- **La copie** : conséquence d'abord, troisième personne, et le geste qui débloque.

## Tests (écrits dans la même PR)
Le tableau des mutations ci-dessus, rejoué : chaque ligne doit rougir. Le résultat est consigné dans
la fiche, avec le test qui a mordu.

## Mesures — chaque mutation rejouée le 19/09/2026

**Les quinze vues rouges**, chacune avec `-count=1`.

**Ce drapeau n'est pas décoratif.** Quatre mutations de `cmd/dashboard` lancées sans lui se sont lues
« vertes » d'affilée ; relancée seule, la première a imprimé `ok … (cached)`, et la même commande avec
`-count=1` l'a fait rougir aussitôt. Le mécanisme exact n'a pas été creusé — ce qui compte est que le
faux vert se lit **exactement comme un succès**, et qu'aucune relecture ne l'aurait attrapé. La règle
retenue : `-count=1` sur toute mesure de mutation, sans exception.

| Mutation | Le test qui a mordu |
|---|---|
| `PasskeyUnknown` rend 204 | `retirer une clé d'accès qui n'est pas la sienne ne parle pas de la session` |
| `PasskeyUnknown` rend 401 `notAuthenticated()` | le même |
| `maximumChallengeLength` retiré | `TestChaqueControleDeFormeDuSecondFacteurRefuseAvantToutEtat/un challenge plus long que la borne` |
| exclusion `code` sur `webauthn` retirée | `…/une assertion accompagnée d'un code` |
| exclusion `assertion` sur `totp` retirée | `…/un code accompagné d'une assertion` |
| `presentedFactorIsWellFormed` rend `true` | `TestLaPreuveDEnrolementExigeSesDeuxChampsOuAucun`, 2 sous-cas |
| `guard.go` : la panne de résolution rend 401 | `TestUnePanneDeResolutionDeSessionNestPasUnRefus` |
| `KeepAuditPartitions` : `return` après le rapport | `TestUnEchecNArretePasLeRenouvellementDesPartitions` |
| `ConsumeChallenge` : `now() < expires_at` retiré | `TestUnChallengeQuiNestPlusUtilisableNeSeRetrouvePas/il est échu` |
| `Strict()` retiré du sceau | `TestUnSceauNonCanoniqueEstRefuse`, les 3 sous-cas |
| `processAlive` : `EPERM` relu comme la mort | `TestUneBaseDUnProcessusVivantMaisNonSignalableEstGardee` |
| cérémonie refusée : retour au 401 | 3 scénarios de `mfa-webauthn.feature` |
| les deux corps du 409 d'enrôlement reconfondus | `remplacer son authentificateur avec un code faux…` |
| `refusedSecondFactor` : retour à l'horloge TOTP | `le second facteur est refusé`, sur le chemin de la clé d'accès — 3 scénarios |
| `withSession` cesse de porter l'erreur (`err:` retiré) | `TestUneBaseInjoignableNeFermePasLaSessionDeLOperateur` |

**Les deux chiffres de l'audit ont été refaits, et les deux étaient faux.**
`TestUnSceauNonCanoniqueEstRefuse` ne rougissait pas « une fois sur douze » mais **une fois sur
quatre** — 24 827 rouges sur cent mille tirages, contre un `Unseal` privé de `Strict()`. Et le dernier
caractère d'un base64 de trente-deux octets ne porte pas « deux bits significatifs sur six » mais
**quatre** ; ce sont les deux de poids faible qui n'en portent pas. Les deux ont été mesurés ici
plutôt que recopiés — un correctif appuyé sur le chiffre du relecteur en écrit souvent un second.

**Une quinzième mutation s'est ajoutée en cours de route, et c'est la step qui l'a produite.** Le test
de `guard.go` **pose lui-même** l'erreur dans le contexte : il prouve que la garde la propage, jamais
que quelqu'un la pose. Or `withSession` est le seul à le faire en production, en trois lignes que rien
n'exerçait — retirer `err:` y laissait les deux suites vertes. C'est le harnais qui masque, en plus
petit. Un second cas traverse donc le routeur réel, le vrai `withSession` et un vrai
`session.Manager` ; seule la base est morte. Chacune des deux mutations rougit **son** cas et pas
l'autre.

## Ce qui n'est pas tenu par un test, et pourquoi
- **La copie de `refusedSecondFactor` ne peut pas être tenue méthode par méthode** : le constructeur
  est unique, donc aucun test ne distingue « la phrase convient au TOTP » de « la phrase convient à
  une clé d'accès ». Ce qui est tenu est le négatif, sur le chemin où ça se voit — le refus d'une
  assertion ne nomme ni l'application d'authentification, ni l'horloge, ni l'heure.
- **`refusedReplacementProof` et `unknownPasskey` sont tenus par leur `code`, pas par leur phrase.**
  Une rédaction qui garderait le code et dirait n'importe quoi passerait. C'est la limite ordinaire
  d'une assertion sur une copie ; le fragment « n'a pas été accepté » et « n'est pas sur ce compte »
  en attrape le cœur, pas la rédaction entière.

## Hors périmètre
La réécriture de l'audit → step-033. Les verrous d'essais → step-034.

## Definition of Done
Elle vit dans `CLAUDE.md`.
