# step-048 — Filet des primitives

> **Jalon :** M2 (§4.1) · **Statut :** FAIT
> **Dépend de :** step-042 · **Bloque :** step-040
>
> *Issue de l'audit du 16/09/2026. Elle se lit **avant** step-040, qui monte la pile de toasts dans la
> coquille et doit hériter de primitives dont les tests gardent quelque chose.*

## But
Les tests des primitives livrées par step-041 et step-042 rougissent quand le comportement qu'ils
nomment disparaît. Aujourd'hui, plusieurs restent verts quoi qu'il arrive.

## Constats de l'audit
| Où | Ce qui passe inaperçu |
|---|---|
| `web/src/components/ui/toast.tsx:70`, `toast.test.tsx:194` | La durée d'un toast critique est appliquée, mais rien ne le vérifie : le test ne lit que la constante `TOAST_TIMEOUT`. Mutation lancée (durée critique non transmise) : la suite reste verte. |
| `toast.tsx:98`, `toast.test.tsx:75` | `aria-label="Notifications"` est déjà la valeur par défaut de Base UI : le retirer laisse le test vert. |
| `toast.tsx:67` | `useToast` ne passe jamais `priority: 'high'` : une alerte critique serait annoncée poliment par le lecteur d'écran. *(Plausible : à confirmer contre la documentation de Base UI par `ctx7`.)* |
| `web/test/classes-peintes.test.ts:53`, `:98` | Une famille de classes calculées est jugée couverte par `startsWith` : supprimer `.ui-dot--degraded` ou `.ui-toast--critical` du CSS laisse le test vert, et une règle morte passe aussi. |
| `web/src/components/ui/content-state.test.tsx:114-120` | La phrase « vos données locales restent affichées » est fournie par le test, pas par `ErrorState`. |
| `web/src/components/ui/select.test.tsx:36` | Intitulé « entièrement au clavier », l'option est choisie par `user.click`. |
| `web/vite-plugin-tokens.test.ts:83`, `web/test/charte.test.ts:180` | Deux gardes de câblage cherchent une chaîne dans le texte source, commentaires compris : `// declaredTokens(),` les laisse vertes. |
| `web/src/components/ui/button.tsx:57-58`, `:69`, `:95` | `blocked` n'impose pas d'explication : `<Button blocked>` sans raison compile, alors qu'un contrôle interdit doit être « désactivé et expliqué ». *(Plausible.)* |

## Périmètre (ce que fait CETTE PR)
- Chaque ligne du tableau reçoit un test qui rougit par sa mutation, ou un correctif du composant
  quand c'est le composant qui est faux (priorité).
- `blocked` exige son explication **par le type** : une union discriminée plutôt qu'une consigne de
  JSDoc.
- Les deux gardes de câblage passent par les imports réels, pas par le texte.

## Points d'implémentation clés
- **Un détecteur par recherche de texte ne garde rien** : commentaires et homonymes le rendent vrai.
  Passer par l'AST ou par l'exécution.
- **La priorité d'un toast** se vérifie sur le rôle ou l'attribut que Base UI pose réellement, pas
  sur l'option passée.
- **`blocked` rend `disabled` nu illégal ?** Non : un `disabled` sans raison reste légitime pour un
  contrôle en cours d'envoi. Seul `blocked` exige l'explication.

## Tests (écrits dans la même PR)
Le tableau ci-dessus, rejoué mutation par mutation. Chaque ligne doit rougir ; le résultat est
consigné dans la fiche.

## Résultat des mutations (16/09/2026)
Chaque mutation est appliquée sur un arbre commité, puis retirée par `git checkout`.

| Ligne de l'audit | Mutation | Résultat |
|---|---|---|
| Durée critique | `timeout: TOAST_TIMEOUT.default` pour toute sévérité | rouge — « laisse une alerte critique trois secondes de plus » |
| Priorité | ligne `priority` retirée de `useToast` | rouge — « annonce une alerte critique d’urgence » (le rôle `alertdialog` manque) |
| `aria-label` | *prop retirée : elle valait le défaut de Base UI 1.6.0* | aucun test ne peut rougir sur son retrait (mutation équivalente) ; `aria-label="Alertes"` fait rougir le test de la région, qui tient le nom quelle que soit sa source |
| Classes peintes | `.ui-dot--degraded` retirée | rouge — « sont toutes peintes » |
| | les deux règles `.ui-toast--critical` retirées | rouge — « sont toutes peintes » |
| | règle morte `.ui-dot--bidon` ajoutée | rouge — « aucune règle sans émetteur » |
| | `ui-toast--info` retiré des crochets | rouge — « sont toutes peintes » |
| | famille `ui-breaker--` retirée de `FAMILIES` | rouge — « énumèrent chaque famille » et « aucune règle sans émetteur » |
| | `half_open` retiré de sa famille | rouge — `tsc` (TS2741) |
| `ErrorState` | phrase retirée du composant | rouge — le test ne la fournit plus |
| Select | `{ArrowDown}` retiré de la séquence du test | rouge — la sélection dépend des touches ; aucun clic ne subsiste |
| Câblage du plugin | `// declaredTokens(),` dans `vite.config.ts` | rouge |
| Feuilles servies | `// import '~/styles/app.css'` dans `main.tsx` | rouge (par le plancher : une seule feuille trouvée) |
| | `/* @import "./feedback.css"; */` dans `app.css` | rouge — `feedback.css` nommée |
| | `// import '~/styles/design-reference.css'` dans la route | rouge — `design-reference.css` nommée |
| `blocked` | `'aria-describedby'` rendu facultatif dans l'union | rouge — `tsc` (TS2578, directive inutile) |

**Ce qui reste non gardé (critère 4).**
- Le type de `blocked` exige un identifiant, pas qu'un élément de la page le porte : `aria-describedby=""` compile.
- `FAMILIES` associe chaque préfixe à une union **à la main** : si un composant calculait sa classe
  depuis une autre variable, la table mentirait sans que `tsc` le voie.
- Le parcours clavier du select est celui de Base UI : aucune mutation du composant ne le retire sans
  le réécrire. Le test rougit si la sélection n'emprunte plus les touches qu'il envoie.

## Hors périmètre
Le montage de la pile dans la coquille → step-040. Les commentaires faux de `toast.tsx` → step-038.

## Definition of Done
Elle vit dans `CLAUDE.md`.
