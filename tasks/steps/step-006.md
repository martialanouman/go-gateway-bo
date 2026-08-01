# step-006 — Catalogue de permissions : une source Go, un TypeScript généré

> **Jalon :** M0 (§3.1, §6.10) · **Statut :** À FAIRE
> **Dépend de :** step-000, step-001, step-004 · **Bloque :** step-020, step-040

## But
Le vocabulaire de l'autorisation — ~44 clés fixes, versionnées avec les releases, non éditables depuis
l'interface. Il vit en Go, et le TypeScript que consomme le client en est **généré**.

## Périmètre (ce que fait CETTE PR)
- `internal/permissions/` : les clés, leur catégorie et leur description en français, dans une
  structure Go immuable.
- Générateur → `web/src/lib/permissions.ts`, marqué comme généré et **commité**.
- Cible `make generate` étendue ; **test de divergence bloquant** en CI.
- Aucune garde, aucun rôle : seulement le vocabulaire.

## Points d'implémentation clés
- **C'est la seule couture que la bascule Go a créée.** La v1.0 avait un module TypeScript importé par
  les deux moitiés (7 imports côté client, 13 côté serveur) : la commodité disparaît quand le serveur
  change de langage. Deux catalogues maintenus à la main divergeraient en silence, et le client
  afficherait des contrôles que le serveur refuse — précisément ce que la charte interdit.
- **La direction de la génération n'est pas arbitraire.** La garde serveur est ce qui protège
  réellement ; le rendu client est un confort (invariant c). La source doit être du côté qui décide.
- Ajouter une clé reste **trois endroits dans la même PR** : le catalogue ici, la garde qui l'exige, le
  tableau des rôles par défaut (step-020). Une clé sans garde ne garde rien ; une garde sans clé refuse
  tout le monde ; une clé qu'aucun rôle ne détient est inaccessible à tous sauf `super_admin`. Les
  trois erreurs sont silencieuses.
- Le fichier généré est commité plutôt que produit au build : le client doit typechecker sans que la
  toolchain Go soit installée.

## Tests (écrits dans la même PR)
- **Test de divergence** : modifier le catalogue Go sans régénérer fait échouer la CI. C'est le test
  central de cette step ; il se mute en ajoutant une clé côté Go seulement.
- Les descriptions sont en français, les clés en anglais (§1.7) — vérifié sur la forme des clés
  (`domaine:action`, minuscules), pas sur la langue de la description, qui n'est pas testable.
- Aucune clé orpheline : chaque clé du catalogue appartient à au moins une catégorie connue.

## Definition of Done
- [ ] `make check` vert · `make generate` idempotent
- [ ] le fichier TypeScript porte un en-tête « généré — ne pas éditer » et le lint le respecte
- [ ] la mutation « éditer le TypeScript généré à la main » est détectée par la CI

## Hors périmètre
Les neuf rôles par défaut et le seed → step-020. `RequirePermission` → step-025. `usePermission` et
`PermissionGate` → step-040.
