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
| `internal/session/cookie.go:67` | `Strict()` retiré | `TestUnSceauNonCanoniqueEstRefuse` ne rougit qu'une fois sur douze : l'alphabet `A…P` ne produit une variante que si le dernier caractère est A, E, I ou M |

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

## Hors périmètre
La réécriture de l'audit → step-033. Les verrous d'essais → step-034.

## Definition of Done
Elle vit dans `CLAUDE.md`.
