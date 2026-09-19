# step-037 — Élagage

> **Jalon :** M1 · **Statut :** FAITE
> **Dépend de :** step-034 · **Bloque :** — (aucune step ne l'attend)
>
> *Issue de l'audit du 16/09/2026. Après step-034, qui réécrit les délégations du verrou MFA.*

## But
Retirer ce qui ne sert à rien aujourd'hui **et** qu'aucune step planifiée ne réclame. Le reste de ce
que l'audit de sur-ingénierie a relevé est écarté ci-dessous, avec sa raison.

## Périmètre (ce que fait CETTE PR)
| Où | Ce qui part | Ce qui le remplace |
|---|---|---|
| `internal/bff/router.go:30-53`, `:74-80` | `Dependencies` redéclare les cinq champs de `API`, et `NewRouter` les recopie | `API` embarqué dans `Dependencies` |
| `internal/store/mfa.go:244-268` | `LockFor` et `RecordFailure`, sans appelant de production | rien. `ClearFailures` **reste** : `mfa.Manager` l'appelle |
| `internal/store/audit.go:36` | `Fields.Number`, appelé par un seul test | rien |
| `internal/bff/assets.go:25` | le `fs.Stat` + `IsDir` refait à la main | `isFile` |
| `web/package.json:43-45` | `@stoplight/prism-core`, `prism-http`, `prism-http-server`, jamais importés | rien : ce sont des dépendances de `prism-cli` |
| `web/pnpm-workspace.yaml:12-19` | les refus `cpu-features`, `protobufjs`, `ssh2`, dont la chaîne a quitté le lockfile | rien |

### Ajouts d'un second audit (19/09/2026)
Relevés par un passage ponytail sur l'arbre entier. Chacun vérifié à zéro appelant de production, et
confronté aux fiches en attente : ce que step-027, step-028, step-036 ou step-040 réclame est écarté
plus bas avec les autres.

| Où | Ce qui part | Ce qui le remplace |
|---|---|---|
| `internal/store/logins.go` | `LockFor` et `RecordFailure` couvraient les deux dimensions en une instruction ; aucun appelant de production | rien — le filet des onze tests bascule sur `Reserve`/`SourceLock`/`RecordSourceFailure`, qui n'en avaient aucun |
| `internal/bff/auth.go:261-273` | `itoa` écrit à la main pour éviter `fmt` | `strconv.Itoa`, qui ne prend qu'un `int` — l'argument contre `fmt` ne vaut pas contre lui |
| `internal/bff/respond.go:16` | l'alias `errorResponse = Error` et les neuf lignes qui l'expliquent | `Error`, que le paquet nomme déjà |
| `internal/store/first_operator.go:13-16` | `OwnerRole`, alias exporté d'une constante déjà exportée | `permissions.SuperAdminRole` |
| `internal/config/bootstrap.go:39-47` | `Complete()`, qui est `len(MissingNames()) == 0` écrit deux fois | la condition au seul site d'appel |
| `internal/auth/source.go:172-184` | la boucle explicite de `isTrusted` | `slices.ContainsFunc` |
| `docker-compose.yml:36-46` | le service `redis`, qu'aucune ligne de code ne joint | rien : step-044 le rétablira avec le Pub/Sub qui l'utilise |
| `web/src/components/page.tsx` | `Page` (un appelant) et `Toolbar` (aucun) | `<div className="page">` dans `pending-screen.tsx` |
| `web/src/components/ui/*` | `Field.badge`, `Icon.strokeWidth`, `Icon.style` et `ButtonSize.lg`, qu'aucun appelant ne passe | rien |

## Écartés, et pourquoi
- **`internal/gateway`** (578 lignes) : aucun code de production ne l'importe, mais step-060 en est le
  premier consommateur, et chaque bump du contrat l'exerce déjà. `DASHBOARD_GATEWAY_BASE_URL` reste
  obligatoire pour la même raison.
- **`@tanstack/react-query`, `openapi-fetch`, `openapi-typescript`** : step-040 les consomme.
  **`@simplewebauthn/browser`, `qrcode.react`** : step-027 et step-028.
- **`chi` → `ServeMux`** : aucune ligne gagnée, et le serveur engendré serait à régénérer.
- **`Audit.RecordTx`** : step-033 ne lui a **pas** donné d'appelants de production — les cinq
  écritures en transaction vivent dans `internal/store` et appellent `record` en direct. Elle reste le seul accès à
  l'écriture en transaction depuis le paquet de test externe, qui la garde.
- **Le token `--qr-paper`** : step-028 affiche le QR. Son commentaire dit pourtant qu'il est gardé par
  un test, ce qui est faux → step-038.
- **Les types réexportés par `components/ui/index.ts`** : step-040 est le premier écran à les
  importer ; les trier avant serait deviner.

Écartés du second audit (19/09/2026), pour la même raison — une step planifiée les réclame :
- **`PermissionGate` et `usePermission`** : step-027 les nomme dans sa ligne « Dépend de ».
- **`Passkeys.origin`, `WithRegistrationOrigin`, `WithLoginOrigin`** : les deux options ne font rien
  aujourd'hui — `RPOrigins` ne tient qu'une valeur, et l'option ne peut que rétrécir cet ensemble à
  lui-même (`go-webauthn` v0.18.0, `registration_opt.go:126`). Mais step-036 réécrit le contrôle
  d'origine et tranchera là, dans le même fichier.
- **`Tabs.keepMounted`, `Input.icon`, `Modal.wide`, `DataTable.dense`, `EmptyState.inline`,
  `DotTone.restricted/accent/info`** : les écrans de step-027, step-028 et step-029 sont les premiers
  à monter ces primitives. Les props mortes retirées ci-dessus sont celles qu'**aucune** fiche ne
  nomme.
- **`internal/gateway` en entier** (578 lignes écrites, 32 200 engendrées, zéro importeur de
  production) : arbitré une seconde fois le 19/09/2026, même conclusion qu'au 16/09. **Rien n'en
  part** : `APIError.Fields[].Message` a l'air mort, mais le type dit lui-même pourquoi il reste —
  « l'onglet qui affichera l'erreur en a besoin ; c'est la sérialisation et le log qui les excluent,
  pas la structure », c'est-à-dire l'invariant (a) tenu par les rendus et non par le champ.
- **`Counter.Admit`** : alias de `reserve`, mais la seule des quatre méthodes qui soit exportée, et
  c'est une garde — vérifié : `internal/mfa` détient deux `*store.Counter` (`manager.go:57`,
  `webauthn.go:273`) et les appelle depuis l'extérieur du paquet. Sans `Admit`, il compterait sans
  réserver.
- **Les bornes du verrou de migration** (`lock.WithLockTimeout(5, 60)`) : elles recopient bien les
  défauts de goose v3.27.3, et l'appel ne fait rien aujourd'hui. Mais leur commentaire argumente le
  figeage contre une dérive amont silencieuse, et rien ne prouve que l'argument soit faux.
- **La fusion des recettes `migrate` et `bootstrap`** : mesurée, pas supposée. Le motif de `help`
  (`^[a-z][a-z0-9-]*:.*?## `) ne matche pas une règle à deux cibles, donc `migrate bootstrap:` ferait
  **disparaître les deux de `make help`**, dont `CLAUDE.md` dit qu'il « fait foi ». Un `define` reste
  possible, mais le commentaire sur place argumente contre l'indirection sur la seule recette dont la
  précédence décide de *quelle base* on écrit. Les six lignes recopiées coûtent moins que les deux.
- **Les 74 propriétés CSS sans `var()`** : mesurées une par une, et écartées quand même. Ces tokens
  sont un **port de la charte** (`.claude/skills/sms-gateway-design/`), que `tasks/plan.md` nomme
  source de vérité visuelle : une échelle typographique ou une rampe de palette est un vocabulaire,
  pas du code mort. Les retirer ferait diverger le port de sa source, et le prochain écran les
  réécrirait à la main — avec d'autres valeurs. La mesure était juste, la conclusion ne l'était pas.

## Tests (écrits dans la même PR)
**Dix tests changent de porte d'entrée**, et ce n'est pas cosmétique : `Logins`/`MFA.LockFor` et
`RecordFailure` portaient à eux seuls le filet du verrouillage anti-force-brute, tandis que
`SourceLock` et `RecordSourceFailure` — le chemin que la production emprunte — n'avaient aucun test.
Le filet bascule donc sur l'API vivante avant que les méthodes partent.

**Trois mutations, chacune vue rouge** (`-count=1`, sur `internal/store/counters.go`) :

| Mutation | Ce qui rougit |
|---|---|
| `count` ne rend jamais de verrou | `TestLeVerrouDeSourceTombeAuSeuilEtPasAvant` |
| `lockFor` rend toujours le verrou nul | trois tests, dont l'accumulation inter-pools et concurrente |
| `reserve` ne refuse jamais | cinq tests, dont les trois du second facteur repointés |

Aucun test neuf pour le reste de l'élagage : il ne change aucun comportement. `make check` vert, et
`pnpm install --frozen-lockfile` passe sur le lockfile régénéré.

## Revue (19/09/2026)
Six constats, **tous conséquences de cet élagage**, tous corrigés dans la même PR. Chacun revérifié
ici plutôt que repris du rapport.

| # | Constat | Mesure refaite |
|---|---|---|
| 1 | `TestUnVerrouDeSecondFacteurEchuLaisseLeCompteurRepartirDeUn`, repointé de `count` vers `reserve`, ne prouvait plus son nom | Mutation confirmée : retirer la branche d'oubli de `reserve` laissait le test **vert**. `Locked()` seul ne distingue pas « reparti de 1 » de « collé au seuil », l'essai venant d'être admis. Corrigé par un second essai témoin — vert propre, **rouge sous la même mutation** |
| 2 | `internal/mfa/manager.go:14` affirmait qu'une connexion réussie n'incrémente aucun compteur d'adresse | Faux : `auth.Login` appelle `Reserve(emailKey)` à **chaque** essai (`authenticator.go:115`), succès compris. La conclusion tient, mais parce que `ClearFailures` efface ensuite |
| 3 | `internal/bff/auth.go:216` citait encore `LockFor`, supprimé par cette PR | Dernière référence pendante de l'arbre |
| 4 | `serialization_test.go` affirmait que `types.Unalias` empêche la porte de refuser huit sites | Mutation faite : `types.Unalias` retiré de `declarationFile` → **vert**. Il ne porte plus rien depuis le retrait de l'alias ; le commentaire le dit désormais |
| 5 | `README.md:39` et `plan.md:433` annonçaient Redis dans `docker compose up -d` | Vérifié absent du fichier depuis cette PR |
| 6 | `.toolbar` et `.toolbar__end` n'ont plus d'émetteur depuis la suppression de `page.tsx` | `classes-peintes.test.ts` ne juge que les sélecteurs `ui-*` : le défaut symétrique qu'il documente lui échappait |

## Hors périmètre
Les commentaires → step-038.

## Definition of Done
Elle vit dans `CLAUDE.md`.
