# step-026 — Rendu UI par permission + écrans Login & MFA

> **Jalon :** M1 (§6.9, §6.10, §4.2) · **Statut :** À FAIRE
> **Dépend de :** step-025, step-041, step-042, step-040 · **Bloque :** step-027

> **Dépendances corrigées le 30/07/2026.** `step-040` s'ajoute : la garde de session se branche sur
> des routes non publiques, et celles-ci n'existent qu'avec l'AppShell (voir la note ‡ de
> `INDEX.md`). En sens inverse, `usePermission` / `PermissionGate` **passent à `step-040`**, dont le
> rail de navigation en a besoin dès sa naissance ; cette step les consomme et porte la règle de
> copie qui les accompagne. Voir la note † de `INDEX.md`.

## But
Rendre les permissions visibles et compréhensibles dans l'interface, et livrer la porte d'entrée du
produit conformément à la charte.

## Périmètre (ce que fait CETTE PR)
- **Règle de la charte appliquée partout** : un contrôle interdit est **désactivé et expliqué**,
  jamais silencieusement masqué (« Nécessite la permission `suppressions:delete` »). Le hook
  `usePermission(key)` et `PermissionGate` viennent de `step-040` ; c'est ici qu'on fige la copie du
  refus et qu'on la vérifie sur les écrans livrés.
- Écran de login (email + mot de passe) puis écran de challenge MFA (passkey d'abord, TOTP en repli),
  d'après `LoginScreen.jsx` du kit UI.
- **Branchement de la garde de session sur les routes** (reporté de step-022) : toute route non
  publique exige une session valide et **complète**, sinon redirection vers le login. La brique
  existe — `resolveSession()` de step-022 — mais elle attend une route à garder et une cible où
  rediriger, qui n'apparaissent qu'ici.
- États d'erreur d'authentification explicites : identifiants invalides, compte verrouillé (avec
  durée), MFA requis, facteur indisponible.

## Points d'implémentation clés
- Le rendu conditionnel est un **confort**, jamais une garde (invariant c) : un contrôle masqué dont
  la route n'est pas gardée reste une faille.
- Copie à la troisième personne, conséquence d'abord, et jamais le mot « sécurisé » comme promesse
  (fondamentaux de contenu du design system).
- Aucune information d'énumération dans les messages : « identifiants invalides », pas « email inconnu ».
- Navigation clavier complète et annonce des erreurs aux lecteurs d'écran dès cet écran.

## Tests (écrits dans la même PR)
- Sans la permission, le contrôle est rendu désactivé avec sa raison ; avec, il est actif.
- Une route protégée redirige un anonyme **et** un opérateur dont le MFA n'est pas passé (reporté de
  step-022).
- Parcours e2e : login → MFA (TOTP et passkey) → console.
- Compte verrouillé : message avec durée, aucune fuite d'existence de compte.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build) · `pnpm e2e` vert
- [ ] aucun contrôle silencieusement masqué · clavier et libellés conformes (WCAG 2.1 AA)

## Hors périmètre
La gestion des opérateurs et des rôles → step-027.
