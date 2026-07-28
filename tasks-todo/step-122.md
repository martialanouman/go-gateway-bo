# step-122 — Simulateur de route + bandeau de précédence

> **Jalon :** M6 (§6.1, §6.7) · **Statut :** À FAIRE
> **Dépend de :** step-121 · **Bloque :** step-123

## But
Répondre à « où partirait ce message, et pourquoi » — et empêcher le malentendu le plus coûteux du
produit : croire qu'une route directe contourne la conformité.

## Périmètre (ce que fait CETTE PR)
- Action « Simuler » : soumettre un message d'exemple, afficher la **route et le connecteur résolus**
  par le matching déclaratif.
- **Bannière de précédence** : signale si le compte a un **script actif** (qui prévaudrait) et si un
  **numéro exact** s'applique (prioritaire).
- Copie explicite du §6.7 : ces règles ne court-circuitent **que la résolution de route** — opt-out,
  autorisation d'expéditeur, anti-spam et facturation continuent de s'appliquer.

## Points d'implémentation clés
- C'est le compromis nommé au §7 : « empêcher de croire qu'une route directe contourne la
  conformité ». La bannière n'est pas décorative, c'est la fonctionnalité.
- Le message d'exemple est saisi par l'opérateur : il n'est **jamais** issu d'un CDR réel et n'est
  jamais journalisé (invariant a).
- Afficher les trois niveaux dans l'ordre de précédence — numéro exact > script > déclaratif — même
  quand un seul s'applique, pour que le modèle mental se construise.
- Une simulation ne modifie rien et n'est pas facturée : le dire.

## Tests (écrits dans la même PR)
- Simulation renvoyant la route attendue ; compte avec script actif → bannière affichée.
- Numéro exact applicable → bannière de priorité avec la mention de conformité maintenue.
- Le contenu d'exemple n'apparaît dans aucun log.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] bandeau de précédence présent et testé dans les trois cas

## Hors périmètre
Le CRUD des numéros exacts → step-123.
