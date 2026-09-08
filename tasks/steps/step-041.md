# step-041 — Primitives lot 1 : bouton, champ, select, pilule de statut, tabs, table

> **Jalon :** M2 (§4.2, `plan.md` §7) · **Statut :** À FAIRE
> **Dépend de :** step-008 · **Bloque :** step-042, step-040, step-027
>
> *Elle ouvre M2 dans l'ordre d'exécution — `041 → 042 → 040` —, et c'est à ce titre qu'elle porte une
> dette qui n'a rien à voir avec les primitives : relever le décompte du contrat.*

## But
La couche que tous les écrans consomment. step-008 a porté les tokens ; rien ne les habille encore —
`web/src/components/` ne contient que la coquille inerte et l'adresse inconnue. Cette step livre les
six primitives que `todo.md` nomme, et le jeu de glyphes sans lequel chacune des six redessinerait
celui de sa voisine.

## Périmètre (ce que fait CETTE PR)
- `Button`, `Field` + `Input`, `Select`, `StatusPill`, `Tabs`, `DataTable`, habillés par les tokens
  déjà portés dans `web/src/styles/tokens/`.
- `Icon` et `Dot` : le jeu de glyphes de la charte, **dessiné une seule fois**. Elle n'admet ni
  bibliothèque d'icônes, ni police d'icônes, ni CDN, et *« A name outside the set renders nothing »*.
- La couche `components.css`, importée par `app.css` et **inscrite dans `STYLED_FILES`**
  (`web/test/charte.test.ts:45`) : cette liste est écrite à la main, pas construite par motif, donc
  une feuille qui n'y figure pas n'est gardée par rien.
- Les primitives **rendues sur `/_design`**, qui n'affiche aujourd'hui que des tokens et l'écrit :
  « les primitives habillées (boutons, tables, pilules) […] arrivent en step-041 et step-042 ».

**Portées veut dire réécrites.** `plan.md` §7 dit « Primitives Base UI portées » et `todo.md` répond
« Aucune step ne "porte" quoi que ce soit », en date du 01/08/2026. Ce qui est porté, c'est le
**comportement** de `@base-ui/react` 1.6.0 — posé par le commit de remise à neuf, avant même
step-001, et importé nulle part depuis — habillé par les tokens. Les `.jsx` du kit de la charte ne
sont pas du code de production : ils s'enregistrent sur `window` dans une IIFE et n'ont ni imports ES
ni typage.

### Trois dettes que cette step hérite

*Écrites ici et non seulement dans `steps/done/`, parce qu'une fiche archivée n'est ouverte par
personne. Les trois figurent au registre de `todo.md`.*

- **Le décompte du contrat n'a pas été revérifié depuis le 27/07/2026, et c'est cette step qui ouvre
  le jalon.** `plan.md` §16 : « Le ratio 71/133 date du 27/07 et n'a toujours pas été revérifié. […]
  Le relever à l'ouverture de chaque jalon, et corriger le tableau ci-dessous plutôt que de le
  croire. » Le dénominateur, lui, est vérifié — 133 opérations en 4.0.2 comme en 2.5.0, step-009. Le
  **numérateur** est périmé, et il ne se lit pas dans le contrat : il se lit dans `go-gateway`. Aucune
  primitive de cette step ne touche une opération du contrat ; la tâche est documentaire et lui échoit
  par sa position. Elle tranche du même coup la contradiction de la source : §16 compte 62 opérations
  manquantes, `plan.md:877` en écrit 63.

- **Le raccourci `font:` défait `font-variant-numeric`, et cette step livre la table.** step-008 :
  « les `tabular-nums` que `base.css` pose sur `body` sont défaits partout où un rôle typographique
  s'applique. Le kit de la charte a le même trou ; le portage est fidèle. Sans effet aujourd'hui (les
  chiffres visibles sont en mono), **réel pour les KPI de step-041**. » Une colonne numérique dont les
  chiffres perdent leur chasse commune danse à chaque rafraîchissement — dans un cockpit où les
  compteurs défilent, c'est le défaut qu'on remarque sans savoir le nommer.

- **Deux dettes de forme de step-008, sans effet mesuré à ce jour.** Le plugin de tokens « accepte un
  token déclaré dans une portée où il ne s'applique pas » — `@media print { :root { --x } }`, build
  vert ; et `design-reference.css` « atterrit dans la feuille d'entrée, pas dans un chunk : 1 912
  octets servis sur `/` pour une page que seul un développeur visite ». La seconde grossit avec cette
  step, parce que `components.css` prend le même chemin.

## Points d'implémentation clés
- **Le plugin de tokens nomme cette step, et il fera échouer le build.** `web/vite-plugin-tokens.ts`
  refuse tout `var(--…)` non déclaré, y compris ce qu'un `style.setProperty()` pose à l'exécution —
  `--active-tab-left`, `--active-tab-width`, `--anchor-width` en v1.0. Il donne lui-même la sortie :
  « soit avec une valeur de repli dans `:root`, ce qui est préférable […], soit par une liste
  d'exemptions nommées ici ». **Le repli**, parce qu'il donne en plus une valeur au premier rendu,
  avant que le JavaScript ne mesure.
- **La règle de contraste, pas le chiffre.** step-008, DN-5 : « sur une surface interactive, le texte
  discret remonte d'un cran — `--text-muted` (4,55 en carte), jamais `--text-faint` […] step-041, qui
  livrera les tables, hérite de la règle plutôt que du chiffre ». La mesure qui l'a établie vaut pour
  `--surface-card`, où vivent les tables du produit, et non pour la porteuse la plus clémente.
- **La pilule de statut est la règle la plus stricte du système.** `link_status` rend un point coloré
  et un libellé mono ; `breaker_state` rend une pilule teintée. Jamais fusionnés, jamais dérivés d'un
  seul champ : « Un disjoncteur ouvert sur un lien vivant (attendre la reprise) et un bind mort
  (rebind manuel) demandent des actions opposées. » La casse de l'API survit — `half_open`,
  `reconnecting` s'affichent tels quels, parce que c'est ce que dit la charge utile.
- **Contour et teinte, jamais un aplat**, y compris pour le bouton principal. Focus : 2 px de repli
  couleur page puis anneau teal, sur **tout** élément interactif. Au press, ni `scale` ni translation
  — *« a mis-click here disconnects a live bind »*.
- **Un contrôle interdit est désactivé et expliqué**, jamais masqué. La primitive porte le *pourquoi*,
  sinon chaque écran le réinvente ; elle ne décide rien pour autant, la garde est serveur —
  invariant (c).
- **`functions: 100`, par fichier.** La couverture Vitest est `perFile: true`, et ces planchers sont
  « la mesure du jour, et aucune n'a de marge ». Une branche de rendu jamais exercée fait rougir la
  porte, pas la revue.

## Tests (écrits dans la même PR)
- **Composants (Vitest)** : pour chaque primitive, ses états, sa navigation clavier, sa copie, et le
  contrôle désactivé avec son explication.
- **Charte** : le contrôle de contraste s'étend aux paires que les primitives introduisent, par la
  table de `design-tokens.ts` que `/_design` rend déjà — une seule liste, deux lecteurs, DN-5 de
  step-008.
- **Mutation, sur l'anneau de focus** : le retirer d'une primitive fait rougir. C'est WCAG 2.4.7, et
  step-008 a mesuré que sa disparition pouvait laisser 137 tests verts.
- **Mutation, sur la pilule** : dériver `breaker_state` de `link_status` fait rougir. Les deux
  dimensions ne se déduisent pas l'une de l'autre, et c'est tout l'objet de la règle.
- Pour les deux dettes de forme : ce que la mesure rend, et le constat écrit là où elle ne rend rien.

## Definition of Done
- [ ] `make check` vert
- [ ] clavier et libellés accessibles (WCAG 2.1 AA) sur chaque primitive livrée
- [ ] le décompte du contrat est relevé **dans `go-gateway`**, le tableau de `plan.md` §16 corrigé, et
      l'écart 62/63 avec `plan.md:877` tranché — mesuré, pas recopié
- [ ] la mutation « retirer l'anneau de focus d'une primitive » fait rougir
- [ ] la mutation « dériver `breaker_state` de `link_status` » fait rougir
- [ ] `vite build` passe **sans** liste d'exemptions ajoutée au plugin de tokens
- [ ] `components.css` figure dans `STYLED_FILES`, vérifié en l'en retirant — ce qui doit faire rougir

## Hors périmètre
`Modal`, `Toast` et les cinq états de contenu → step-042. Le `Tooltip` → step-084 et le `Menu` → la
step qui le consomme ; step-042 écrit pourquoi aucun des deux n'est de ce jalon. `Badge`, `Tag`,
`Segmented`, `Card`, `IconButton`, `Checkbox`, `Switch`, `RadioGroup`, `Textarea`, `MetricTile`,
`KeyValueList`, `SpanBar`, `Pagination`, `Banner`, `BalanceCard`, `MaskedSecret` → la step qui les
consomme, chacune arrivant avec son écran plutôt qu'avec une bibliothèque devinée d'avance. La
virtualisation des grandes listes → M5. Tout appel réseau, et donc toute donnée réelle dans la
table → step-040.
