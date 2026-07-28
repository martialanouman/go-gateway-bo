# step-066 — Identifiants : deux cartes masquées, secret une fois, rotation avec grâce, révocation

> **Jalon :** M3 (§6.14) · **Statut :** À FAIRE
> **Dépend de :** step-064 · **Bloque :** —

## But
Gérer les secrets d'un compte sans jamais les exposer — l'écran où l'invariant (b) se gagne ou se perd.

## Périmètre (ce que fait CETTE PR)
- Écran Identifiants du compte (`credentials:read` / `credentials:write` / `credentials:rotate`).
- **Exactement deux cartes fixes** : « Identifiant SMPP » et « Clé API » — contrainte de schéma côté
  passerelle, **pas** une liste extensible.
- Affichage **toujours masqué** : type, 4 derniers caractères, statut, dernière utilisation, état de
  rotation. **Aucune action « révéler ».**
- Création (`create-credential`) : secret affiché **une seule fois** dans une modale non réaffichable,
  avec case « Je comprends que le nouveau secret ne sera affiché qu'une seule fois ».
- Rotation manuelle (`rotate-credential`) avec **fenêtre de grâce** mise en avant et avertissement
  variable : sans grâce, les binds vivants du client sont coupés.
- Révocation (`revoke-credential`, `update-credential-status`) indiquant le nombre de sessions
  vivantes déconnectées, et **diagnostic d'échec de bind** (échecs d'authentification récents).

## Points d'implémentation clés
- **Invariant (b)** : le secret ne transite qu'une fois, n'est jamais remis en cache, ni journalisé,
  ni placé dans une URL, ni conservé dans un état React après fermeture de la modale.
- La rotation sans grâce est l'action la plus destructrice de l'écran : l'avertissement change de ton
  selon la valeur saisie, et la confirmation chiffre l'impact.
- Le diagnostic d'échec de bind ne doit jamais afficher le secret tenté, seulement des métadonnées.
- Toutes ces actions sont auditées (`credentials.rotate`, `credentials.revoke`).

## Tests (écrits dans la même PR)
- Le secret apparaît exactement une fois ; après fermeture, il est introuvable dans le DOM, l'état,
  le cache Query et les logs.
- Rotation sans grâce → avertissement renforcé + impact chiffré ; avec grâce → message adapté.
- Révocation affiche le nombre de sessions déconnectées.
- Aucune action « révéler » n'existe dans l'écran (test de non-régression explicite).

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] **invariant (b)** couvert par un test bloquant · actions auditées

## Hors périmètre
La déconnexion forcée des sessions → step-086.
