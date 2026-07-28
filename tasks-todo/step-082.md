# step-082 — Trafic : ventilations connecteur/client/compte/groupe + drill-down CDR

> **Jalon :** M4 (§6.3) · **Statut :** À FAIRE
> **Dépend de :** step-081, step-060 · **Bloque :** step-100

## But
Passer de « il se passe quelque chose » à « voilà où » : ventiler le trafic sur les quatre axes du
domaine et pouvoir descendre au CDR d'un clic.

## Périmètre (ce que fait CETTE PR)
- `get-traffic-metrics?groupBy=` sur **connecteur**, **client**, **compte SMPP** et **groupe**.
- Tables de ventilation triables, avec part relative et tendance.
- Drill-down : une ligne renvoie vers le CDR Explorer avec les filtres correspondants pré-appliqués.
- Filtre par groupe réutilisant `GroupFilter` (step-060).

## Points d'implémentation clés
- **La ventilation par groupe somme les séries par compte** : le groupe n'est pas un label côté
  métriques (§6.3). Ne pas espérer un `groupBy=group` natif si le contrat ne l'expose pas — sommer
  côté BFF, et le documenter.
- Le drill-down doit produire une URL **partageable** portant les filtres (utile en incident), sans
  jamais y placer un corps de message (invariant a).
- Tri et part relative se calculent sur l'ensemble renvoyé, jamais sur une page partielle.

## Tests (écrits dans la même PR)
- Chaque axe de ventilation renvoie et rend les bonnes séries.
- La ventilation par groupe égale la somme des comptes membres.
- Le drill-down ouvre le CDR Explorer avec les filtres attendus dans l'URL.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] sommation par groupe testée · URL de drill-down partageable

## Hors périmètre
Le CDR Explorer lui-même → step-100.
