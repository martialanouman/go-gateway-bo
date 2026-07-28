# step-185 — Accessibilité WCAG 2.1 AA + parcours Playwright de bout en bout

> **Jalon :** M9 (§1.2) · **Statut :** À FAIRE
> **Dépend de :** tous les écrans (M1 à M8) · **Bloque :** step-186

## But
Vérifier sur le produit assemblé ce que chaque step a promis isolément : les parcours principaux sont
accessibles et fonctionnent de bout en bout.

## Périmètre (ce que fait CETTE PR)
- Audit **WCAG 2.1 AA** des parcours principaux (§1.2) : navigation clavier complète, ordre de focus,
  libellés et rôles, contraste, annonces d'erreurs et de mises à jour en direct.
- Contrôles automatisés (axe) intégrés à la CI sur les écrans clés, plus une revue manuelle du clavier.
- **Parcours Playwright de bout en bout** :
  1. login + MFA → console ;
  2. incident : trafic → drill-down CDR → fiche message → trace ;
  3. compte SMPP : rotation d'identifiant avec grâce → déconnexion de session ;
  4. routage : édition d'une route → simulation → publication d'un script ;
  5. conformité : vérification « pourquoi bloqué ? » → levée par un rôle `compliance`.
- Correction des écarts trouvés (dans cette PR, sans refonte).

## Points d'implémentation clés
- Les régions en direct (métriques, sessions) doivent être annoncées **sans bavardage** :
  `aria-live="polite"` sur un résumé, pas sur chaque cellule qui change.
- Le glisser-déposer des routes (step-120) et la virtualisation (step-085, step-100) sont les deux
  points de rupture d'accessibilité les plus probables : les tester en priorité.
- Un test e2e qui échoue par intermittence est pire qu'aucun test : pas d'attente arbitraire, uniquement
  des attentes sur état.
- Les parcours e2e tapent le mock, pas la passerelle réelle.

## Tests (écrits dans la même PR)
- Contrôles axe sans violation bloquante sur les écrans clés.
- Les cinq parcours passent en CI, sans attente arbitraire.
- Parcours clavier complet sur la table de routes et sur une liste virtualisée.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` · `pnpm e2e` verts
- [ ] aucune violation AA bloquante sur les parcours principaux

## Hors périmètre
Le déploiement → step-186.
