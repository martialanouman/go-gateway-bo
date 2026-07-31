# step-028 — Écran d'enrôlement du second facteur

> **Jalon :** M1 (§6.9) · **Statut :** À FAIRE
> **Dépend de :** step-026 · **Bloque :** —

> **Step ajoutée le 31/07/2026, plan corrigé.** Elle manquait, et son absence rendait le produit
> inaccessible. La `step-025` a rendu le second facteur **obligatoire** — aucune permission d'écriture
> ni lecture de contenu sans lui — tandis que `installFirstAdministrator` (step-020) crée le premier
> administrateur **sans aucun facteur**. Les points d'entrée d'enrôlement existent depuis les
> step-023 et step-024 et acceptent une session partielle, mais rien dans l'interface ne les appelle :
> un opérateur se connectait, arrivait au challenge, n'avait ni passkey ni TOTP, et n'avait aucun
> moyen d'en obtenir un. La `step-026` traite ce cas par un état nommé qui renvoie ici ; c'est cette
> step qui le résout.

## But
Permettre à un opérateur sans second facteur d'en enrôler un lui-même, depuis sa session partielle,
sans passer par un administrateur ni par la ligne de commande.

## Périmètre (ce que fait CETTE PR)
- Écran d'enrôlement atteint depuis le challenge de la step-026 quand aucun facteur n'est enrôlé, et
  atteignable volontairement pour **ajouter** un facteur à une session complète.
- **TOTP** : QR code et secret en clair présentés une fois, saisie du code de confirmation, puis
  affichage des **codes de récupération — une seule fois** (invariant b : aucun réaffichage, aucune
  action « révéler »).
- **Passkey** : cérémonie d'enregistrement `navigator.credentials.create`, nommage de l'appareil,
  liste des appareils enregistrés.
- Retrait d'un appareil, avec le refus explicite du **dernier facteur** (`LAST_FACTOR_MESSAGE`).

## Points d'implémentation clés
- Le secret TOTP et les codes de récupération sont des **secrets au sens de l'invariant (b)** : jamais
  dans une URL, jamais dans un toast, jamais recopiés dans le cache Query après affichage.
- Une session partielle suffit pour enrôler — c'est déjà la règle des handlers — mais elle ne donne
  aucune permission : l'écran vit hors de la coquille, comme le login.
- La copie dit ce que le facteur protège et où s'arrête la frontière ; « sécurisé » n'est pas une
  promesse.

## Tests (écrits dans la même PR)
- Les codes de récupération apparaissent une fois et ne sont plus atteignables ensuite, y compris
  après un retour arrière du navigateur.
- Le secret TOTP n'apparaît dans aucune sérialisation persistée.
- Retirer le dernier facteur est refusé, avec sa raison.
- Parcours e2e : premier administrateur amorcé → login → enrôlement TOTP → console.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build) · `pnpm e2e` vert
- [ ] invariant (b) intact · clavier et libellés conformes (WCAG 2.1 AA)

## Hors périmètre
La réinitialisation d'un facteur **par un administrateur** pour un autre opérateur → step-027.
