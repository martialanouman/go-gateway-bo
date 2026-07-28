# step-084 — Connecteurs : santé par bind — `link_status` vs `breaker_state` — et rebind

> **Jalon :** M4 (§6.5) · **Statut :** À FAIRE
> **Dépend de :** step-083, step-045 · **Bloque :** —

## But
Montrer l'état réel d'un connecteur sans le simplifier abusivement : la liaison et le disjoncteur sont
deux choses différentes, et un pool peut être à moitié debout.

## Périmètre (ce que fait CETTE PR)
- `get-connector-status` : rendu **par bind du pool**, pas un état unique par connecteur.
- **`link_status`** (`up` | `reconnecting` | `down`) rendu en **point**, et **`breaker_state`**
  (`closed` | `open` | `half_open`) rendu en **pilule**, affichés **séparément** (charte).
- Badge d'avertissement pour un connecteur qui s'appuie sur le disjoncteur **sans** auto-reconnexion.
- Action `rebind-connector` avec confirmation et conséquence énoncée.
- Mise à jour en direct via le sujet `metrics.connectors`.

## Points d'implémentation clés
- Le piège du §6.5 : la réponse détaille l'état **par bind**. Une vue qui agrège en un seul badge
  ment pendant un incident — c'est précisément le moment où elle est lue.
- Les valeurs conservent leur `snake_case` d'API (`half_open`, `reconnecting`) : c'est ce que dit le
  payload et ce que l'opérateur grep.
- `link_status: up` avec `breaker_state: open` est un état parfaitement normal — l'UI ne doit pas le
  présenter comme une contradiction.
- Un rebind coupe le trafic en cours sur ce bind : la confirmation le dit.

## Tests (écrits dans la même PR)
- Un connecteur dont certains binds sont `up` et d'autres `down` s'affiche correctement, sans état
  unique inventé.
- `link_status` et `breaker_state` ne sont jamais fusionnés dans un seul indicateur.
- Le badge « disjoncteur sans auto-reconnexion » apparaît dans le bon cas.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] rendu par bind testé · deux indicateurs distincts

## Hors périmètre
Les sessions utilisateurs → step-085 et step-086.
