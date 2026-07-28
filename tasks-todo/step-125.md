# step-125 — Scripts : versions, publication, retour arrière, portée, santé en direct

> **Jalon :** M6 (§6.2) · **Statut :** À FAIRE
> **Dépend de :** step-124 · **Bloque :** —

## But
Faire d'un script un artefact gouverné : versionné, publié par quelqu'un d'autre que son auteur,
révocable, et observable une fois en production.

## Périmètre (ce que fait CETTE PR)
- **Versions** (`list-routing-script-versions`) : historique, comparaison, **retour arrière**.
- **Publication** (`publish-routing-script`, permission `scripts:publish`) séparée de l'écriture.
- **Affectation de portée** (`assign-routing-script`) : sélecteur « ce compte » / « ce client » /
  « plateforme entière », avec la règle **un seul script actif par portée** appliquée à la publication.
- **Santé en direct** par script : invocations, latence p50/p99, taux de timeout et d'erreur.

## Points d'implémentation clés
- Le §6.2 dit **affectation, pas attachement** : un script existe indépendamment de sa portée. L'UI
  doit refléter cette séparation, sinon la règle « un seul actif par portée » devient incompréhensible.
- `script_author` n'a **pas** `scripts:publish` (§6.10) : la revue par `ops`/`super_admin` est le
  garde-fou. L'écran l'explique au lieu de simplement désactiver le bouton.
- Publier remplace le script actif de la portée : la confirmation nomme celui qui sera remplacé.
- La santé en direct est ce qui **boucle la boucle** du composant distinctif (§8) : la relier
  visuellement à la version publiée.

## Tests (écrits dans la même PR)
- Publication refusée sans `scripts:publish`, avec explication.
- Publier sur une portée déjà pourvue nomme le script remplacé et applique la règle d'unicité.
- Retour arrière restaure la version choisie ; la santé affiche les métriques de la version active.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] séparation écriture/publication testée · unicité par portée testée

## Hors périmètre
La réécriture de sender ID → step-126.
