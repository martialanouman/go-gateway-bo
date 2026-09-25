# 056 — Le mot de passe de connexion reste cinq minutes dans le cache de mutation

> **Porteur :** step-039

## Ce qu'elle coûte si elle dure

`web/src/routes/login.tsx` passe l'adresse et le mot de passe en variables de `useMutation` sans
`gcTime`. Le `QueryClient` de `web/src/router.tsx` ne pose aucune option par défaut, donc la mutation
garde ces variables en clair cinq minutes après le départ de l'écran, à la portée de tout code qui
détient le `QueryClient` (`getMutationCache().findAll()`, comme le fait `access.test.tsx`).

Lu le 25/09/2026 dans `@tanstack/query-core` 5.101.4 (`build/modern/removable.js`) : sans valeur
explicite, `gcTime` vaut `5 * 60 * 1e3` hors serveur. Le correctif tient en une ligne, `gcTime: 0`,
comme `web/src/routes/access.tsx` le fait déjà pour le mot de passe choisi par le lien.
