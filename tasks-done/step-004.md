# step-004 — Harnais de test : Vitest, Testing Library, Playwright

> **Jalon :** M0 (§1.2) · **Statut :** À FAIRE
> **Dépend de :** step-000, step-001, step-002 · **Bloque :** toutes les steps suivantes

## But
Rendre la Definition of Done exécutable : unitaires rapides, tests de composant réalistes, un
parcours de bout en bout, tous branchés en CI.

## Périmètre (ce que fait CETTE PR)
- Vitest : environnement jsdom pour les composants, node pour le BFF ; couverture activée.
- Testing Library + `user-event` ; helpers de rendu (routeur, TanStack Query, thème).
- Playwright : configuration, un parcours de fumée (l'application démarre et rend la racine).
- Fabriques de données de test alimentées par les **types du contrat** (pas de forme inventée).
- Base de test jetable (Testcontainers ou service CI) pour les tests touchant Drizzle.
- CI : `typecheck`, `lint`, `test`, `build`, `e2e` ; artefacts Playwright en cas d'échec.

## Points d'implémentation clés
- **Pyramide** : beaucoup d'unitaires (logique BFF, permissions, mappings), des tests de composant,
  très peu de bout en bout. Le e2e couvre les parcours, pas les cas limites.
- Les tests d'écran tapent le **mock Prism**, jamais la vraie passerelle.
- Poser dès maintenant le test bloquant qui gardera l'**invariant (a)** : un utilitaire de scan qui
  échoue si un corps de message apparaît dans une trace, un log ou une URL. Il se remplira en step-103.
- Aucun test dépendant de l'horloge réelle ou d'un `sleep` ; horloge injectable.

## Tests (écrits dans la même PR)
- Le harnais lui-même : un test unitaire, un test de composant, un test e2e passent en CI.
- Le test d'invariant (a) échoue volontairement sur un cas fabriqué, puis passe une fois retiré.

## Definition of Done
- [ ] `pnpm check` + `pnpm e2e` verts en CI
- [ ] seuil de couverture posé (pas symbolique) et respecté

## Hors périmètre
L'audit d'accessibilité complet → step-185.
