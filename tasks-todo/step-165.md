# step-165 — Effacement du contenu seul (crypto-shred) + rotation de clé

> **Jalon :** M8 (§6.18) · **Statut :** À FAIRE
> **Dépend de :** step-164 · **Bloque :** step-166

## But
Offrir la destruction ciblée du contenu — irréversible, limitée au corps, et énoncée comme telle.

## Périmètre (ce que fait CETTE PR)
- Action **`erase-customer-content`** (permission `content:erase`) avec la conséquence en clair :
  « détruit la clé — contenu illisible, métadonnées conservées, irréversible ».
- Action **`rotate-content-key`** avec sa propre explication.
- Confirmation forte : saisie du nom du client pour valider, récapitulatif d'impact.
- Audit obligatoire.

## Points d'implémentation clés
- La distinction contenu / métadonnées est le cœur de l'écran : après un crypto-shred, les CDR
  restent, seuls les corps deviennent illisibles. Une copie floue ici produit des attentes fausses.
- **Irréversible** : la confirmation exige un geste délibéré (saisie), pas un simple clic.
- `content:erase` est distincte de `gdpr:erase` (§6.18) : deux actes, deux permissions, deux écrans.
- Après effacement, l'onglet Corps du CDR Explorer doit afficher l'état **« effacé »** (step-103), pas
  « non stocké » — vérifier la cohérence des deux écrans.

## Tests (écrits dans la même PR)
- Effacement sous `content:erase` uniquement ; confirmation par saisie requise.
- Après effacement, le corps d'un message concerné rend l'état « effacé ».
- Rotation de clé effectuée et auditée.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] cohérence avec l'état « effacé » de step-103 testée

## Hors périmètre
L'effacement RGPD complet → step-166.
