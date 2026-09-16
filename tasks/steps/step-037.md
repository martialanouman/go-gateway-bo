# step-037 — Élagage

> **Jalon :** M1 · **Statut :** À FAIRE
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
| `internal/store/mfa.go:240-275` | `LockFor`, `RecordFailure`, `ClearFailures`, qui ne font que déléguer à `Counter` | un `*store.Counter` dans `mfa.Manager` — si step-034 ne l'a pas déjà fait |
| `internal/store/audit.go:36` | `Fields.Number`, appelé par un seul test | rien |
| `internal/bff/assets.go:25` | le `fs.Stat` + `IsDir` refait à la main | `isFile` |
| `Makefile:425`, `:445` | deux recettes identiques pour `migrate` et `bootstrap`, et le commentaire qui justifie de ne pas les fusionner | une règle `migrate bootstrap:` |
| `web/package.json:43-45` | `@stoplight/prism-core`, `prism-http`, `prism-http-server`, jamais importés | rien : ce sont des dépendances de `prism-cli` |
| `web/pnpm-workspace.yaml:12-19` | les refus `cpu-features`, `protobufjs`, `ssh2`, dont la chaîne a quitté le lockfile | rien |

## Écartés, et pourquoi
- **`internal/gateway`** (578 lignes) : aucun code de production ne l'importe, mais step-060 en est le
  premier consommateur, et chaque bump du contrat l'exerce déjà. `DASHBOARD_GATEWAY_BASE_URL` reste
  obligatoire pour la même raison.
- **`@tanstack/react-query`, `openapi-fetch`, `openapi-typescript`** : step-040 les consomme.
  **`@simplewebauthn/browser`, `qrcode.react`** : step-027 et step-028.
- **`chi` → `ServeMux`** : aucune ligne gagnée, et le serveur engendré serait à régénérer.
- **`Audit.RecordTx`** : step-033 lui donne ses appelants.
- **Le token `--qr-paper`** : step-028 affiche le QR. Son commentaire dit pourtant qu'il est gardé par
  un test, ce qui est faux → step-038.
- **Les types réexportés par `components/ui/index.ts`** : step-040 est le premier écran à les
  importer ; les trier avant serait deviner.

## Tests (écrits dans la même PR)
Pas de test neuf : l'élagage ne change aucun comportement. `make check` vert, et `pnpm install
--frozen-lockfile` passe sur le lockfile régénéré.

## Hors périmètre
Les commentaires → step-038.

## Definition of Done
Elle vit dans `CLAUDE.md`.
