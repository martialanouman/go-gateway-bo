# step-003 — Design system : tokens de la charte + fondations de thème

> **Jalon :** M0 (§4.2) · **Statut :** À FAIRE
> **Dépend de :** step-000 · **Bloque :** step-040, step-041

## But
Installer la charte graphique v1.0 comme fondation CSS du produit, pour qu'aucun écran n'invente
plus jamais une couleur, un rayon ou une graisse.

## Périmètre (ce que fait CETTE PR)
- Copier les tokens de `.claude/skills/sms-gateway-design/tokens/` vers `src/styles/tokens/`
  (`base`, `colors`, `typography`, `spacing`, `radius`, `elevation`, `motion`, `layout`, `fonts`).
- Feuille racine : thème sombre par défaut, `color-scheme`, reset, focus visible conforme.
- Polices auto-hébergées (`src/styles/fonts.css`), `font-display: swap`, aucune requête tierce.
- Page de démonstration interne (route `/_design`, non liée dans la navigation) affichant l'échelle
  typographique, la palette, les statuts et les espacements — la référence visuelle du dépôt.

## Points d'implémentation clés
- **La charte prime** sur la spec technique en cas de désaccord visuel (README du design system).
- **Un seul accent** (teal) : il marque l'action et le vivant ; tout le reste reste neutre pour ne pas
  noyer les alertes.
- Le **mono est réservé aux valeurs machine** (identifiants, compteurs, MSISDN, états techniques),
  jamais au texte narratif.
- Contraste : viser WCAG 2.1 AA dès les tokens, pas en rattrapage (§1.2).
- Aucun framework CSS utilitaire : les tokens et le CSS de composant suffisent (décision de la step).

## Tests (écrits dans la même PR)
- Test de non-régression : les variables CSS attendues sont définies sur `:root`.
- Vérification automatisée du contraste des paires texte/fond principales.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] `/_design` rend la charte complète · aucune valeur codée en dur hors tokens

## Hors périmètre
Les composants eux-mêmes → step-041 et step-042. L'AppShell → step-040.
