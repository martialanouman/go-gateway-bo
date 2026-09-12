# step-041 — Primitives lot 1 : bouton, champ, select, pilule de statut, tabs, table

> **Jalon :** M2 (§4.2, `plan.md` §7) · **Statut :** FAIT
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
  (`web/test/charte.test.ts`) : cette liste est écrite à la main, pas construite par motif, donc
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
  manquantes, §18 en écrit 63. *(La fiche renvoyait à `plan.md:877`. Le renvoi par numéro est retiré
  plutôt que corrigé : la première rédaction l'avait « corrigé » en `:879` — juste avant que la
  réécriture de §16 n'insère vingt lignes et ne le périme à son tour, dans le paragraphe même qui
  expliquait qu'un numéro se périme.)*

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
- [x] `make check` vert
- [x] clavier et libellés accessibles (WCAG 2.1 AA) sur chaque primitive livrée
- [x] le décompte du contrat est relevé **dans `go-gateway`**, le tableau de `plan.md` §16 corrigé, et
      l'écart 62/63 tranché — mesuré, pas recopié
- [x] la mutation « retirer l'anneau de focus d'une primitive » fait rougir
- [x] la mutation « dériver `breaker_state` de `link_status` » fait rougir
- [x] `vite build` passe **sans** liste d'exemptions ajoutée au plugin de tokens
- [x] `components.css` figure dans `STYLED_FILES`, vérifié en l'en retirant — ce qui doit faire rougir

## Ce que la step a mesuré, et ce que la mesure a changé

### Le décompte : 71/133 → **103/133**, et quatre lignes du tableau §16 étaient fausses

L'amont avait avancé de **32 opérations** depuis le 27/07. Il en reste **30** non implémentées, pas
62 ni 63 : les deux chiffres de la source étaient faux, et leur contradiction s'éteint avec eux.

La mesure est refaisable : le routage de `go-gateway` est déclaratif — huma v2 sur chi, une opération
= un `huma.Operation{OperationID}` dans `internal/adminapi/`. Croiser les `OperationID` des fichiers
non-test avec les `operationId` du YAML **est** la mesure. Aucun des 103 n'est une souche.

**Ce que ça change pour le plan, et qui dépasse la correction d'un chiffre** : `M2` et `M5` cessent
d'être des jalons développés sur mock — les trois flux du hub WebSocket et les trois opérations du
CDR Explorer sont livrées —, et `M8` fond à la seule politique de contenu, les 17 opérations de
facturation (17, pas 13) et `gdpr-erase` étant livrées.

*Écart consigné et non corrigé : le BO consomme le contrat **4.0.2** quand la source publie **4.2.0**.
Aucune primitive ne touche une opération, et `CLAUDE.md` interdit de bumper au milieu d'une step.*

### Les mutations : trois ont rougi d'emblée, une était verte

| Mutation | Résultat |
|---|---|
| Retirer l'anneau de focus (`:focus-visible` de `base.css`) | **214 tests Vitest verts, `vite build` rc=0.** Seul le parcours Playwright rougit — le même défaut que step-008 avait mesuré à 137 tests, et la raison d'être de l'extension du parcours. |
| Dériver `breaker_state` de `link_status` | Rouge, 3 tests. |
| Retirer le repli `:root` d'`--anchor-width` | `vite build` rc=1 (« 1 token consommé sans être déclaré »), **et** le test de charte rouge. Deux gardes indépendantes. |
| Retirer `components.css` de `STYLED_FILES` | **Verte.** Les gardes de charte *parcourent* la liste : en retirer une entrée n'en fait échouer aucune, elles vérifient une feuille de moins en silence. La liste était nommée à la main mais rien n'exigeait qu'elle soit **complète**. Un test l'exige désormais, et la mutation rougit. |

### Ce que la vérification a corrigé, au-delà du périmètre annoncé

- **`CdrStatus` n'a pas six valeurs mais huit.** La v1.0 omettait `accepted` et `cancelled`, qui
  retombaient donc sur le repli gris et disparaissaient de l'œil de l'opérateur balayant la colonne à
  la recherche des rouges. `test/statuts-du-contrat.test.ts` lit désormais le YAML installé : une
  valeur qui apparaît, disparaît ou se renomme en amont fait rougir.
- **Le plafond de la feuille d'entrée mesurait le brut pour protéger le transfert.** Son commentaire
  annonçait lui-même que `components.css` mangerait sa marge. Plutôt qu'un cran arbitraire, il mesure
  les deux coûts sur leur objet : **~5 Ko compressés** (fenêtre de congestion initiale, borne
  14 336) et **~21 Ko bruts** (coût d'analyse, borne 32 768). *Ordre de grandeur et non chiffre
  exact, délibérément : la première rédaction écrivait « 4 967 / 21 202 », vrai le jour même et périmé
  par les deux commits suivants. Et l'instrument compte — `gzipSync`, `gzip -9` et le rapport de Vite
  rendent trois valeurs pour la même feuille.*
- **Le test qui comptait une ligne par paire de contraste comptait les lignes de la page entière.**
  Il a cessé d'être vrai dès qu'une `DataTable` est apparue sur `/_design` — et aurait pu devenir
  faux en restant vert si deux changements s'étaient compensés.
- **`required` n'est pas une prop du `Field`.** Le découpage `Field` + `Input` l'empêche de
  l'atteindre, et le déclarer des deux côtés recréait l'oubli que ce découpage ferme : l'astérisque
  aurait fini par affirmer le contraire de la sémantique. Il se pose sur le contrôle, la marque en
  découle par `:has()`. jsdom n'applique pas le CSS : cette marque-là se vérifie sur le parcours.

### Ce que step-040 héritera

**`@base-ui/react` n'est aujourd'hui que dans le chunk de `/_design`.** Mesuré sur le livré : le
chunk d'entrée ne bouge pas (~276 Ko), celui de `/_design` passe de 6 Ko à **~153 Ko** (~52
compressés). C'est correct — aucun écran de production ne consomme encore les primitives, et la page
de référence est chargée à la demande. **Le premier écran qui les branchera fera passer Base UI dans
le chunk d'entrée**, et c'est là que sa taille deviendra un sujet : la mesure est à refaire à ce
moment-là, pas à supposer d'après celle-ci.

### Ce que la revue a corrigé après coup

Trois relecteurs en lecture seule, et **quinze constats confirmés en rejouant chaque mutation
moi-même** plutôt qu'en les prenant au mot. Les quatre qui comptent :

1. **L'anneau de focus n'était pas gardé — par le test écrit pour le garder.** Repeint en `--n-700`
   (1,23:1 sur la page, invisible), les 214 tests, `vite build` **et le parcours Playwright**
   restaient verts : le test de charte résolvait `--teal-500` en dur sous un titre qui parlait de
   l'anneau, et l'assertion de bout en bout comptait les deux *couches* de l'ombre, jamais leur
   couleur. C'est la forme exacte du piège connu — une mutation mal construite se lit comme un succès.
2. **Le jeu de glyphes en portait 21, la charte en dessine 22.** `ellipsis-vertical` avait disparu
   entre la lecture du kit et l'écriture du module, et le test qui devait l'attraper recopiait le
   compte faux. Deux recopies de la même main, au même moment, ne font pas une vérification.
3. **Une classe renommée dans le CSS seul laissait toute la suite verte.** Les quarante assertions de
   classe relisaient la chaîne que le composant venait de construire, sans jamais traverser la
   feuille. La porte qui croise les deux a trouvé au passage `ui-table__head`, qu'aucun relecteur
   n'avait vue.
4. **`error=''` fabriquait un champ invalide muet** — bordure rouge, `aria-invalid`, message vide
   relié, aide effacée — sur `error={apiError ?? ''}`, le geste le plus naturel qui soit.

S'y ajoutent des affirmations qui ne tenaient pas devant leur source : « la seule animation en boucle
du système » (le spinner de cette step en est une), « les quatre autres primitives de saisie » (il y
en a une), deux renvois par numéro de ligne périmés — dont l'un dans le paragraphe même qui
expliquait qu'un numéro se périme.

### Ce qui n'est pas testé, et pourquoi

- **Les deux dettes de forme de step-008.** Le trou de portée du plugin (`@media print { :root }`)
  reste ouvert : le fermer demande un analyseur CSS complet là où le plugin fait 50 lignes.
  `design-reference.css` reste dans la feuille d'entrée — la cause est la génération de l'arbre de
  routes, pas les primitives, et le geste vaut sa propre mesure. Le coût est désormais **chiffré** au
  lieu d'être signalé : ~1,9 Ko servis à tous pour une page que seul un développeur visite.
- **La liste blanche des origines gagne une entrée**, `base-ui.com/production-error`. Vérifié sur le
  bundle livré : l'adresse est interpolée dans un message d'erreur, cible d'aucun `fetch` ni `src` —
  même mécanisme que `react.dev/errors`, déjà autorisé. `web/CLAUDE.md` le dit : « l'élargir n'est
  gardé que par la revue ».

## Hors périmètre
`Modal`, `Toast` et les cinq états de contenu → step-042. Le `Tooltip` → step-084 et le `Menu` → la
step qui le consomme ; step-042 écrit pourquoi aucun des deux n'est de ce jalon. `Badge`, `Tag`,
`Segmented`, `Card`, `IconButton`, `Checkbox`, `Switch`, `RadioGroup`, `Textarea`, `MetricTile`,
`KeyValueList`, `SpanBar`, `Pagination`, `Banner`, `BalanceCard`, `MaskedSecret` → la step qui les
consomme, chacune arrivant avec son écran plutôt qu'avec une bibliothèque devinée d'avance. La
virtualisation des grandes listes → `step-085` (M4), première à en avoir besoin. Tout appel réseau, et donc toute donnée réelle dans la
table → step-040.
