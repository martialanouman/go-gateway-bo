# step-021 — Login email/mot de passe + anti-brute-force

> **Jalon :** M1 (§6.9) · **Statut :** À FAIRE
> **Dépend de :** step-020 · **Bloque :** step-022

## But
Authentifier un opérateur par email et mot de passe, côté serveur exclusivement, avec un coût
d'attaque par force brute qui monte vite.

## Périmètre (ce que fait CETTE PR)
- Fonction serveur `POST /auth/login` : vérification du mot de passe, retour d'un **challenge MFA**
  (jamais une session directe — la session n'existe qu'après MFA, step-023/024).
- Hachage **Argon2id** (paramètres explicites et documentés), vérification en temps constant.
- Anti-brute-force : compteur par identifiant **et** par IP, ralentissement progressif puis
  verrouillage temporaire ; l'énumération de comptes est impossible (message et temps de réponse
  identiques pour email inconnu et mot de passe faux).
- Définition et validation de la politique de mot de passe (longueur mini, rejet des mots de passe
  compromis courants).

## Points d'implémentation clés
- **Toute la logique sensible vit côté serveur** (§6.9) : le client ne voit qu'un formulaire.
- Le verrouillage doit résister au **multi-instance** : compteur partagé (Redis, step-044) ou
  transaction Postgres — jamais un compteur en mémoire de process.
- Ne jamais journaliser un mot de passe, un hash, ni l'email en clair dans un log d'échec répétable.
- Réponse d'échec **stable dans le temps** : ajouter un délai plancher pour ne pas trahir l'existence
  d'un compte par la latence.

## Tests (écrits dans la même PR)
- Mot de passe correct → challenge MFA ; incorrect → échec sans session.
- Email inconnu et mot de passe faux produisent la même réponse et la même latence approximative.
- Après N échecs, le compte est verrouillé pour la durée prévue, y compris depuis une autre instance.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] aucun secret journalisé · verrouillage effectif en multi-instance

## Hors périmètre
La session émise → step-022. Les facteurs MFA → step-023 et step-024.
