# step-103 — Corps du message gardé par `content:read` + journal des accès

> **Jalon :** M5 (§6.4, §6.18) · **Statut :** À FAIRE
> **Dépend de :** step-101, step-025 · **Bloque :** —

## But
Rendre lisible la donnée la plus sensible du système — et faire que chaque lecture coûte une trace.
C'est l'écran où l'invariant (a) se gagne.

## Périmètre (ce que fait CETTE PR)
- Onglet « Corps » de la fiche message : affiché **uniquement si** (a) la politique du client stocke
  le contenu **et** (b) l'opérateur détient `content:read`.
- Sinon, un **état explicite** parmi : « non stocké », « expiré », « effacé », « non autorisé ».
  Jamais un blanc.
- Mention **« lecture journalisée »** à côté du bouton, avant le clic.
- Appel `get-message-content` (déchiffrement côté passerelle) → écriture d'audit `content.read`.
- **Journal des accès au contenu** : vue dédiée (qui, quel message, quand), filtrable.

## Points d'implémentation clés
- Le jeton machine du BFF porte `content:read` en permanence : **seul le BFF** empêche un opérateur
  non habilité de lire un corps (invariant c). La garde serveur est obligatoire, le rendu conditionnel
  ne suffit pas.
- **Invariant (a)** : le corps ne doit jamais atteindre un log, un toast, une URL, un message
  d'erreur, le cache Query persisté, ni un export. Il ne vit que dans le composant qui l'affiche.
- `support_readonly` n'a **jamais** `content:read`, et `compliance` ne l'a pas par défaut (§6.10) :
  vérifier ces deux cas explicitement.
- Honnêteté de la copie : le chiffrement protège le repos, `content:read` reste la frontière d'accès
  (§6.18). Ne jamais écrire « sécurisé » comme promesse.

## Tests (écrits dans la même PR)
- Sans `content:read` : état « non autorisé », aucun appel réseau au contenu.
- Avec : le corps s'affiche et **exactement une** ligne d'audit `content.read` est écrite.
- Les quatre états explicites sont couverts.
- Test bloquant : le corps n'apparaît dans aucun log, aucune URL, aucun payload d'export ni dans le
  cache persisté.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] **invariant (a)** couvert par un test bloquant · audit systématique vérifié

## Hors périmètre
La politique de contenu et l'effacement → step-164 à step-166.
