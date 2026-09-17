# step-038 — Commentaires : corriger les faux, ramener les blocs

> **Jalon :** M1 · **Statut :** À FAIRE
> **Dépend de :** step-033, step-034, step-035, step-036, step-037, step-048 · **Bloque :** — (aucune
> step ne l'attend)
>
> *Issue de l'audit du 16/09/2026. En dernier, parce que les six autres réécrivent les fichiers
> qu'elle touche.*

## But
Appliquer la règle de `CLAUDE.md` au code déjà livré : un commentaire ne subsiste que là où le code ne
peut pas parler. Mesuré le 16/09/2026 (fichiers engendrés exclus) : 9 583 lignes de commentaire sur
32 143 lignes non vides, soit **29,8 %**, et **38,5 %** dans le code de production. 292 blocs de plus
de huit lignes en totalisent 4 238 ; 307 lignes racontent l'historique des rédactions.

## Constats de l'audit — commentaires faux
Relire chacun contre le code **tel qu'il est au moment de la PR** : les six steps précédentes en
auront corrigé ou déplacé certains.

| Où | Ce qu'il affirme | Ce que dit le code |
|---|---|---|
| `internal/bff/api.go:12-60` | la porte laisse passer un type de réponse écrit à la main ; il avoue lui-même ne plus être vrai | 45 lignes à ramener à environ 5 ; les lignes 58-60 racontent des steps, pas le champ |
| `internal/permissions/catalog.go:91` | constantes « déclarées ci-dessous » | elles sont au-dessus ; le bloc 83-96 est de l'historique |
| ~~`web/src/components/ui/toast.tsx:79-81`~~ | step-040 monte la pile au niveau de la coquille | **Devenu vrai** : step-040 monte `ToastStack` dans `shell.tsx`. |
| `toast.tsx:53-54` | « six lignes plutôt qu'une abstraction » | `useToast` en fait vingt |
| `toast.tsx:21-22` | chaque toast a `role="dialog"` | `alertdialog` en priorité haute |
| `web/vite-plugin-tokens.ts:23-30` | step-041 devra déclarer trois variables | step-041 est livrée et les déclare dans `components.css` |
| `web/src/components/ui/field.tsx:103-105` | « le seul appelant qui existe » passe `icon` | aucun code de production ne le fait |
| `Makefile:5-7` | `bootstrap` ne crée pas encore le premier opérateur | il le crée |
| `internal/store/pool.go:56-57`, `:100-104` | renvoient à « la step qui écrira la première route » | la base est lue au démarrage et des routes existent |
| `internal/bff/mfa.go:203` | trois tests `…NEleveJamais…` | un seul porte ce nom ; les deux autres s'appellent `…NeSEleveJamais` |
| `web/src/styles/tokens/colors.css:17` | les trois tokens ajoutés sont gardés par un test | aucun test ne nomme `--qr-paper`, et aucune règle ne le consomme |

## Constats de l'audit — volume
- **Les dix fichiers les plus commentés en proportion** : `internal/bff/api.go` (77,5 %), `Makefile`
  (68 %), `internal/store/pool.go` et `internal/bff/respond.go` (65 %), `web/vitest.config.ts`,
  `web/playwright.config.ts`, `web/vite-plugin-tokens.ts`, `web/src/lib/api.test-d.ts`,
  `web/src/components/ui/field.tsx`, `internal/store/lock.go`.
- **Les plus gros blocs** : `Makefile:320-369` (50 lignes) et `:86-117` (32),
  `internal/auth/argon2.go:55-87` (33 lignes de benchmark, à déplacer dans `mesure_test.go`),
  `cmd/dashboard/main_test.go:443-470`, `cmd/dashboard/performance_test.go:13-42`,
  `web/chargement-a-froid.test.ts:183-212`, `web/src/components/ui/status-pill.tsx:3-35`.
- **Des numéros de ligne de fichiers engendrés**, qui périront à la prochaine régénération :
  `internal/bff/router.go:120-162`, `internal/gateway/errors.go:149-170`, `internal/gateway/doc.go:17-22`.

## Périmètre (ce que fait CETTE PR)
- Les commentaires faux sont corrigés ou supprimés.
- Les blocs de plus de huit lignes sont ramenés à leur *pourquoi*. L'historique des rédactions
  (« step-NNN », « v1.0 », « une version précédente », « un relecteur ») quitte le code : il vit dans
  git et dans les fiches.
- Les numéros de ligne de fichiers engendrés disparaissent.
- **Objectif chiffré** : environ −2 450 lignes, soit un ratio global d'environ 24 %. L'arithmétique est
  refaite sur le livré, pas reprise de cette fiche.

## Points d'implémentation clés
- **Ne rien réécrire au jugé.** Chaque commentaire conservé est relu contre le code qu'il surplombe
  (critère 2). Un commentaire déplacé se relit comme s'il était neuf.
- **Un commentaire cité par une porte** (`oracle_test.go`, les portes structurelles de step-031) peut
  être raccourci, pas retiré sans vérifier ce que la porte lit.
- **Aucun remplacement scripté** sans relire la sortie : un motif qui ne trouve rien ne le dit pas.
- **Aucun changement de code** dans cette PR, en dehors du déplacement du tableau d'argon2id.

## Tests (écrits dans la même PR)
`make check` vert. La mesure avant et après est consignée dans la fiche, avec la commande qui la
produit.

## Hors périmètre
Tout changement de comportement.

## Definition of Done
Elle vit dans `CLAUDE.md`.
